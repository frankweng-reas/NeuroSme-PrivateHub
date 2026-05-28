#!/usr/bin/env bash
# update-demo.sh — 安全更新 demo 環境
#
# 流程：
#   1. 把目前 image 標記為 :prev（備份）
#   2. 重新 build 新 image
#   3. 啟動新容器
#   4. 健康檢查（30 秒內回應 /health）
#   5. 失敗則自動回滾到 :prev
#
# 使用方式：
#   ./update-demo.sh                  # 全部更新（backend + frontend）
#   ./update-demo.sh --backend-only
#   ./update-demo.sh --frontend-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export VITE_APP_VERSION="$(cat VERSION | tr -d '[:space:]')"

MODE="all"
case "${1:-}" in
  --backend-only)  MODE="backend" ;;
  --frontend-only) MODE="frontend" ;;
  "")              MODE="all" ;;
  *)
    echo "用法：$0 [--backend-only | --frontend-only]"
    exit 1
    ;;
esac

echo "=== NeuroSme Demo 更新（版本：${VITE_APP_VERSION}，模式：${MODE}）==="

# ── 健康檢查函式 ──────────────────────────────────────────────────────────────
wait_healthy() {
  local service="$1"
  local url="$2"
  local max_wait=30
  local elapsed=0

  echo "  → 等待 ${service} 健康（最多 ${max_wait} 秒）..."
  while [ $elapsed -lt $max_wait ]; do
    if curl -sf --max-time 3 "$url" > /dev/null 2>&1; then
      echo "  ✅ ${service} 健康確認"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo "  ... ${elapsed}s"
  done

  echo "  ❌ ${service} 在 ${max_wait} 秒內未回應"
  return 1
}

# ── 備份目前 image ─────────────────────────────────────────────────────────────
backup_image() {
  local image="$1"
  if docker image inspect "$image" > /dev/null 2>&1; then
    docker tag "$image" "${image}:prev" 2>/dev/null || true
    echo "  → 已備份目前 image 為 ${image}:prev"
  fi
}

# ── 回滾函式 ──────────────────────────────────────────────────────────────────
rollback() {
  local service="$1"
  local image="$2"
  echo ""
  echo "⚠️  偵測到問題，開始回滾 ${service}..."
  if docker image inspect "${image}:prev" > /dev/null 2>&1; then
    docker tag "${image}:prev" "$image"
    docker compose -f docker-compose.demo.yml up -d --force-recreate "$service"
    echo "✅ 已回滾到上一版 ${service}"
  else
    echo "⚠️  找不到備份 image，無法自動回滾，請手動處理"
  fi
}

# ── 更新 backend ──────────────────────────────────────────────────────────────
update_backend() {
  local IMAGE="neurosme20-demo-backend"

  echo ""
  echo "[backend] 備份目前 image..."
  backup_image "$IMAGE"

  echo "[backend] 重新 build..."
  docker compose -f docker-compose.demo.yml build --no-cache demo-backend

  echo "[backend] 啟動新容器..."
  docker compose -f docker-compose.demo.yml up -d --force-recreate demo-backend

  echo "[backend] 等待 entrypoint migration 完成..."
  local elapsed=0
  while [ $elapsed -lt 60 ]; do
    if docker compose -f docker-compose.demo.yml logs demo-backend 2>&1 | grep -q "Starting uvicorn"; then
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  if ! wait_healthy "demo-backend" "https://demo.ee.neurosme.ai/health" ; then
    rollback "demo-backend" "$IMAGE"
    return 1
  fi
}

# ── 更新 frontend ─────────────────────────────────────────────────────────────
update_frontend() {
  local IMAGE="neurosme20-demo-frontend"

  echo ""
  echo "[frontend] 備份目前 image..."
  backup_image "$IMAGE"

  echo "[frontend] 重新 build..."
  docker compose -f docker-compose.demo.yml build --no-cache demo-frontend

  echo "[frontend] 啟動新容器..."
  docker compose -f docker-compose.demo.yml up -d --force-recreate demo-frontend

  if ! wait_healthy "demo-frontend" "https://demo.ee.neurosme.ai" ; then
    rollback "demo-frontend" "$IMAGE"
    return 1
  fi
}

# ── 執行 ─────────────────────────────────────────────────────────────────────
FAILED=0

case "$MODE" in
  backend)
    update_backend || FAILED=1
    ;;
  frontend)
    update_frontend || FAILED=1
    ;;
  all)
    update_backend  || FAILED=1
    update_frontend || FAILED=1
    ;;
esac

echo ""
if [ $FAILED -eq 0 ]; then
  echo "✅ Demo 已更新：https://demo.ee.neurosme.ai"
  echo "   查看 log：docker compose -f docker-compose.demo.yml logs -f"
else
  echo "❌ 更新失敗，已嘗試回滾。請查看 log："
  echo "   docker compose -f docker-compose.demo.yml logs --tail=50"
  exit 1
fi
