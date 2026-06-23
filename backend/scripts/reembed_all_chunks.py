"""批次重新 Embedding 腳本

用途：migration 後將所有 embedding IS NULL 的 chunks 重新生成 1024 維向量。
執行前請確認：
  1. DB migration 001_embedding_dim_1024 已執行完成
  2. 後端環境變數已設定（或直接在 backend 目錄下執行）
  3. Ollama 服務正常，bge-m3 模型已載入

執行方式：
  cd /home/frank_weng/NeuroSme2.0/backend
  venv/bin/python scripts/reembed_all_chunks.py [--tenant TENANT_ID] [--batch 20] [--dry-run]
"""

import argparse
import sys
import time
from pathlib import Path

# 讓 Python 能找到 app 模組
sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.km_chunk import KmChunk
from app.models.tenant_config import TenantConfig


def get_embedding(content: str, api_base: str, model: str, api_key: str | None = None) -> list[float] | None:
    """呼叫 Ollama / OpenAI-compatible embedding API"""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Ollama 原生 embedding endpoint
    if "11434" in api_base or "ollama" in api_base.lower():
        url = api_base.rstrip("/") + "/api/embed"
        payload = {"model": model, "input": content}
    else:
        url = api_base.rstrip("/") + "/v1/embeddings"
        payload = {"model": model, "input": content}

    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        # Ollama 回傳格式
        if "embeddings" in data:
            return data["embeddings"][0]
        # OpenAI 格式
        if "data" in data:
            return data["data"][0]["embedding"]
    except Exception as e:
        print(f"  [ERROR] embedding 失敗: {e}")
    return None


def main():
    parser = argparse.ArgumentParser(description="批次重新 Embedding 所有 KB chunks")
    parser.add_argument("--tenant", help="只處理指定 tenant_id（不填則處理所有租戶）")
    parser.add_argument("--batch", type=int, default=20, help="每批處理幾個 chunks（預設 20）")
    parser.add_argument("--dry-run", action="store_true", help="試跑模式：不實際寫入 DB")
    parser.add_argument("--delay", type=float, default=0.1, help="每個 chunk 之間的延遲秒數（預設 0.1）")
    args = parser.parse_args()

    engine = create_engine(settings.DATABASE_URL)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # 查詢需要 re-embed 的 chunks
        query = db.query(KmChunk).filter(KmChunk.embedding.is_(None))

        total = query.count()
        print(f"需要重新 embed 的 chunks：{total} 筆")

        if total == 0:
            print("沒有需要處理的 chunks，結束。")
            return

        # 取得 tenant embedding 設定（使用第一個有設定的 tenant，或指定 tenant）
        tc_query = db.query(TenantConfig).filter(
            TenantConfig.embedding_model.isnot(None),
            TenantConfig.embedding_provider.isnot(None),
        )
        if args.tenant:
            tc_query = tc_query.filter(TenantConfig.tenant_id == args.tenant)

        tenant_cfg = tc_query.first()
        if not tenant_cfg:
            print("[ERROR] 找不到 embedding 設定，請先在 LLM 設定頁面設定 embedding model")
            return

        print(f"使用 tenant: {tenant_cfg.tenant_id}")
        print(f"Embedding provider: {tenant_cfg.embedding_provider}")
        print(f"Embedding model: {tenant_cfg.embedding_model}")

        # 從 llm_provider_config 取得 api_base
        from app.models.llm_provider_config import LLMProviderConfig
        provider_cfg = db.query(LLMProviderConfig).filter(
            LLMProviderConfig.tenant_id == tenant_cfg.tenant_id,
            LLMProviderConfig.provider == tenant_cfg.embedding_provider,
            LLMProviderConfig.is_active.is_(True),
        ).first()

        if not provider_cfg or not provider_cfg.api_base_url:
            print("[ERROR] 找不到對應的 provider 設定或 API Base URL 未設定")
            return

        api_base = provider_cfg.api_base_url
        api_key = None
        if provider_cfg.api_key_encrypted:
            from app.core.encryption import decrypt_api_key
            try:
                api_key = decrypt_api_key(provider_cfg.api_key_encrypted)
            except Exception:
                pass

        print(f"API Base URL: {api_base}")
        print(f"Dry run: {args.dry_run}")
        print("-" * 60)

        # 測試 embedding API
        test_vec = get_embedding("test", api_base, tenant_cfg.embedding_model, api_key)
        if test_vec is None:
            print("[ERROR] embedding API 測試失敗，請確認服務正常")
            return
        print(f"API 測試成功，向量維度：{len(test_vec)}")
        if len(test_vec) != 1024:
            print(f"[WARNING] 向量維度不是 1024（得到 {len(test_vec)}），請確認 model 設定")
        print("-" * 60)

        # 批次處理
        chunks = query.all()
        success = 0
        fail = 0

        for i, chunk in enumerate(chunks, start=1):
            print(f"[{i}/{total}] chunk_id={chunk.id} ...", end=" ", flush=True)

            vec = get_embedding(chunk.content, api_base, tenant_cfg.embedding_model, api_key)
            if vec is None:
                print("FAIL")
                fail += 1
                continue

            if not args.dry_run:
                chunk.embedding = vec
                if i % args.batch == 0:
                    db.commit()
                    print(f"OK (committed batch)")
                else:
                    print("OK")
            else:
                print(f"OK (dry-run, dim={len(vec)})")

            success += 1
            if args.delay > 0:
                time.sleep(args.delay)

        # 最後 commit
        if not args.dry_run:
            db.commit()

        print("-" * 60)
        print(f"完成：成功 {success} 筆，失敗 {fail} 筆")

    finally:
        db.close()


if __name__ == "__main__":
    main()
