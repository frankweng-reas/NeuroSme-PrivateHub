#!/bin/sh
set -e

echo "[entrypoint] Running Alembic migrations..."
# 若 DB 存有舊 revision ID（squash 前的 001-013 或更早的 initial001），
# alembic upgrade 會因找不到對應檔案而失敗。
# 這時用 stamp --purge 將版本指標強制更新為現行 head（000_initial），
# 再跑 upgrade head（schema 已完整，不會有任何新操作）。
if ! alembic upgrade head 2>&1; then
    echo "[entrypoint] Legacy revision detected, re-stamping to 000_initial..."
    alembic stamp --purge 000_initial
    alembic upgrade head
fi

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
