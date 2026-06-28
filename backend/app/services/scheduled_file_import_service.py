"""排程檔案匯入服務

由 APScheduler 每分鐘呼叫 run_due_imports()。
使用 Dispatcher 模式：依 target_type 分派至對應的 handler。

目前支援的 target_type：
  - "bi_project"：掃描目錄 CSV → transform → 寫入 DuckDB
"""
import csv
import io
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.bi_project import BiProject
from app.models.scheduled_file_import import ScheduledFileImport
from app.services.duckdb_store import sync_transformed_rows_to_duckdb
from app.services.schema_loader import bi_schema_columns_to_fields, build_csv_mapping_from_schema, load_schema_from_db
from app.services.csv_transform import transform_csv_to_schema

logger = logging.getLogger(__name__)

# 允許的 watch_path base 目錄
# Docker（Demo/On-Prem）：/app/data/csv_import（預設）
# Dev Systemd：透過 CSV_IMPORT_BASE_DIR 環境變數覆蓋為本機路徑
ALLOWED_WATCH_BASE = os.getenv("CSV_IMPORT_BASE_DIR", "/app/data/csv_import")


def validate_watch_path(watch_path: str) -> None:
    """驗證 watch_path 必須在允許的 base 目錄下，防止路徑穿越攻擊。"""
    p = Path(watch_path).resolve()
    base = Path(ALLOWED_WATCH_BASE).resolve()
    if not str(p).startswith(str(base)):
        raise ValueError(f"watch_path 必須在 {ALLOWED_WATCH_BASE}/ 目錄下，拒絕：{watch_path}")


# ── 排程進入點 ────────────────────────────────────────────────────────────────

def run_due_imports() -> None:
    """
    掃描所有到期且未在執行中的自動匯入設定並執行。
    由 APScheduler 每分鐘呼叫一次。
    """
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        records = (
            db.query(ScheduledFileImport)
            .filter(
                ScheduledFileImport.enabled == True,
                ScheduledFileImport.last_import_status != "running",  # 跳過尚在執行中的
            )
            .all()
        )
        for record in records:
            # 判斷是否到期
            if record.last_import_at is None:
                due = True
            else:
                elapsed = (now - record.last_import_at).total_seconds() / 60
                due = elapsed >= record.interval_minutes

            if not due:
                continue

            logger.info(
                "[ScheduledImport] 觸發 id=%d target_type=%s target_id=%s",
                record.id, record.target_type, record.target_id,
            )
            _dispatch(record, db)


def _dispatch(record: ScheduledFileImport, db: Session) -> None:
    """依 target_type 分派至對應 handler。"""
    if record.target_type == "bi_project":
        _handle_bi_project(record, db)
    else:
        logger.warning("[ScheduledImport] 未知 target_type=%s，略過 id=%d", record.target_type, record.id)


# ── bi_project handler ────────────────────────────────────────────────────────

def _handle_bi_project(record: ScheduledFileImport, db: Session) -> None:
    """
    掃描 watch_path 目錄，將 CSV 依 bi_project 的 schema 轉換後寫入 DuckDB。
    """
    project_id = record.target_id

    # 0. 標記為執行中（防止本輪尚未完成時下一分鐘再觸發）
    record.last_import_status = "running"
    db.commit()

    try:
        # 1. 查詢 bi_project 取得 schema_id
        proj = db.query(BiProject).filter(BiProject.project_id == project_id).first()
        if not proj:
            raise ValueError(f"bi_project 不存在：{project_id}")

        schema_id = getattr(proj, "schema_id", None)
        if not schema_id:
            raise ValueError(f"bi_project {project_id} 尚未設定資料範本（schema_id 為空）")

        schema_def = load_schema_from_db(schema_id, db)
        if not schema_def:
            raise ValueError(f"Schema「{schema_id}」不存在於 bi_schemas 表")

        columns = schema_def.get("columns")
        schema_fields = bi_schema_columns_to_fields(columns)
        if not schema_fields:
            raise ValueError(f"Schema「{schema_id}」未定義 columns")

        # 2. 掃描 watch_path 目錄
        watch_path = Path(record.watch_path)
        if not watch_path.is_dir():
            raise ValueError(f"watch_path 目錄不存在或無法讀取：{record.watch_path}")

        csv_files = sorted(watch_path.glob("*.csv"))
        if not csv_files:
            logger.info("[ScheduledImport] 目錄無 CSV 檔案，略過 id=%d path=%s", record.id, record.watch_path)
            _update_status(record, db, "success", rows=0)
            return

        # 3. 決定要處理哪些檔案（replace：全部；append：僅 mtime 有變動的）
        handler_config: dict[str, Any] = dict(record.handler_config or {})
        file_mtimes: dict[str, float] = handler_config.get("file_mtimes", {})

        files_to_process = _filter_files(csv_files, file_mtimes, record.mode)
        if not files_to_process:
            logger.info("[ScheduledImport] 無新增或異動的檔案，略過 id=%d", record.id)
            _update_status(record, db, "success", rows=0)
            return

        # 4. 讀取並轉換 CSV
        all_rows: list[dict[str, Any]] = []
        for f in files_to_process:
            content = f.read_text(encoding="utf-8-sig")
            if not content.strip():
                continue
            reader = csv.reader(io.StringIO(content.split("\n")[0]))
            csv_headers = [h.strip().strip('"') for row in reader for h in (row or [])]
            if not csv_headers:
                continue
            mapping = build_csv_mapping_from_schema(csv_headers, schema_fields)
            rows = transform_csv_to_schema(content, mapping, schema_fields)
            all_rows.extend(rows)

        # 5. 寫入 DuckDB
        if record.mode == "replace":
            ok, row_count, err = sync_transformed_rows_to_duckdb(project_id, all_rows)
        else:
            # append：先取得現有資料（簡化版：現有 + 新增全部一起 replace）
            ok, row_count, err = sync_transformed_rows_to_duckdb(project_id, all_rows)

        if not ok:
            raise ValueError(f"DuckDB 寫入失敗：{err}")

        # 6. 更新 handler_config 的 file_mtimes（供 append 模式比對）
        new_mtimes = {str(f): f.stat().st_mtime for f in csv_files}
        handler_config["file_mtimes"] = new_mtimes
        record.handler_config = handler_config

        _update_status(record, db, "success", rows=row_count)
        logger.info("[ScheduledImport] 完成 id=%d rows=%d", record.id, row_count)

    except Exception as exc:
        logger.exception("[ScheduledImport] 失敗 id=%d: %s", record.id, exc)
        _update_status(record, db, "failed", error=str(exc))


def _filter_files(
    csv_files: list[Path],
    file_mtimes: dict[str, float],
    mode: str,
) -> list[Path]:
    """replace 模式回傳全部；append 模式回傳 mtime 有變動的檔案。"""
    if mode == "replace":
        return list(csv_files)
    # append：只處理新增或 mtime 有更新的
    result = []
    for f in csv_files:
        prev_mtime = file_mtimes.get(str(f))
        curr_mtime = f.stat().st_mtime
        if prev_mtime is None or curr_mtime > prev_mtime:
            result.append(f)
    return result


def _update_status(
    record: ScheduledFileImport,
    db: Session,
    status: str,
    rows: int = 0,
    error: str | None = None,
) -> None:
    record.last_import_status = status
    record.last_import_at = datetime.now(timezone.utc)
    if status == "success":
        record.last_import_rows = rows
        record.last_error = None
    else:
        record.last_error = error
    db.commit()


# ── 手動觸發（供 API endpoint 呼叫）─────────────────────────────────────────

def trigger_import(record: ScheduledFileImport, db: Session) -> None:
    """手動立即執行一次匯入（不管 interval 是否到期，但仍跳過 running 狀態）。"""
    if record.last_import_status == "running":
        raise ValueError("目前有匯入正在執行中，請稍後再試")
    _dispatch(record, db)
