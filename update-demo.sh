#!/usr/bin/env bash
# update-demo.sh — NeuroSme Demo 環境更新腳本
#
# 兩階段部署（推薦，停機時間最短）：
#   Step 1（慢，demo 不中斷）：
#     ./update-demo.sh --prepare              # build → :next，demo 繼續運行
#
#   Step 2（秒級切換）：
#     ./update-demo.sh --apply                # :next → 正式，重啟容器，健康檢查
#
# 一次完成（舊版相容）：
#   ./update-demo.sh                          # build + deploy（中途 demo 短暫停機）
#   ./update-demo.sh --backend-only
#   ./update-demo.sh --frontend-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export VITE_APP_VERSION="$(cat VERSION | tr -d '[:space:]')"

BACKEND_IMAGE="neurosme20-demo-backend"
FRONTEND_IMAGE="neurosme20-demo-frontend"

MODE="all"
case "${1:-}" in
  --prepare)       MODE="prepare" ;;
  --apply)         MODE="apply" ;;
  --backend-only)  MODE="backend" ;;
  --frontend-only) MODE="frontend" ;;
  "")              MODE="all" ;;
  *)
    echo "用法："
    echo "  $0 --prepare              # 預先 build（不影響 demo）"
    echo "  $0 --apply                # 套用預建 image（快速切換）"
    echo "  $0                        # 一次完成 build + deploy"
    echo "  $0 --backend-only"
    echo "  $0 --frontend-only"
    exit 1
    ;;
esac

echo "=== NeuroSme Demo 更新（版本：${VITE_APP_VERSION}，模式：${MODE}）==="

# ── 健康檢查 ──────────────────────────────────────────────────────────────────
wait_healthy() {
  local service="$1"
  local url="$2"
  local max_wait="${3:-30}"
  local elapsed=0

  echo "  → 等待 ${service} 健康（最多 ${max_wait} 秒）..."
  while [ $elapsed -lt $max_wait ]; do
    if curl -sf --max-time 3 "$url" > /dev/null 2>&1; then
      echo "  ✅ ${service} 健康確認"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo "     ... ${elapsed}s"
  done
  echo "  ❌ ${service} 在 ${max_wait} 秒內未回應"
  return 1
}

# ── 回滾 ──────────────────────────────────────────────────────────────────────
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
    echo "⚠️  找不到備份 image（:prev），無法自動回滾，請手動處理"
  fi
}

# ── PREPARE：build → :next（demo 不中斷） ─────────────────────────────────────
prepare_backend() {
  echo ""
  echo "[backend] 預先 build → ${BACKEND_IMAGE}:next ..."
  if ! docker build \
    -t "${BACKEND_IMAGE}:next" \
    ./backend; then
    echo "  ❌ backend build 失敗"
    return 1
  fi
  echo "  ✅ build 完成：${BACKEND_IMAGE}:next"
}

# ── PREPARE：build → :next（demo 不中斷） ─────────────────────────────────────
prepare_frontend() {
  echo ""
  echo "[frontend] 預先 build → ${FRONTEND_IMAGE}:next ..."
  if ! docker build \
    --build-arg VITE_APP_NAME=NeuroSme \
    --build-arg VITE_APP_VERSION="${VITE_APP_VERSION}" \
    --build-arg VITE_AUTH_ALLOW_REGISTER=true \
    --build-arg VITE_AUTH_ALLOW_FORGOT_PASSWORD=true \
    -t "${FRONTEND_IMAGE}:next" \
    ./frontend; then
    echo "  ❌ frontend build 失敗"
    return 1
  fi
  echo "  ✅ build 完成：${FRONTEND_IMAGE}:next"
}

# ── APPLY：:next → 正式，重啟（秒級） ────────────────────────────────────────
apply_backend() {
  echo ""

  # 確認 :next 存在
  if ! docker image inspect "${BACKEND_IMAGE}:next" > /dev/null 2>&1; then
    echo "  ❌ 找不到 ${BACKEND_IMAGE}:next，請先執行 --prepare"
    return 1
  fi

  # 備份現有
  if docker image inspect "${BACKEND_IMAGE}" > /dev/null 2>&1; then
    docker tag "${BACKEND_IMAGE}" "${BACKEND_IMAGE}:prev"
    echo "  → 備份現有 image 為 ${BACKEND_IMAGE}:prev"
  fi

  # 套用 :next
  docker tag "${BACKEND_IMAGE}:next" "${BACKEND_IMAGE}"
  echo "  → ${BACKEND_IMAGE}:next → 正式 image"

  echo "[backend] 重啟容器..."
  docker compose -f docker-compose.demo.yml up -d --force-recreate demo-backend

  # 等 migration/uvicorn 啟動
  echo "  → 等待 uvicorn 啟動..."
  local elapsed=0
  while [ $elapsed -lt 60 ]; do
    if docker compose -f docker-compose.demo.yml logs demo-backend 2>&1 | grep -q "Starting uvicorn"; then
      break
    fi
    sleep 2; elapsed=$((elapsed + 2))
  done

  if ! wait_healthy "demo-backend" "https://demo.ee.neurosme.ai/health" 30; then
    rollback "demo-backend" "${BACKEND_IMAGE}"
    return 1
  fi

  # 清理 :next tag
  docker rmi "${BACKEND_IMAGE}:next" 2>/dev/null || true
}

apply_frontend() {
  echo ""

  if ! docker image inspect "${FRONTEND_IMAGE}:next" > /dev/null 2>&1; then
    echo "  ❌ 找不到 ${FRONTEND_IMAGE}:next，請先執行 --prepare"
    return 1
  fi

  if docker image inspect "${FRONTEND_IMAGE}" > /dev/null 2>&1; then
    docker tag "${FRONTEND_IMAGE}" "${FRONTEND_IMAGE}:prev"
    echo "  → 備份現有 image 為 ${FRONTEND_IMAGE}:prev"
  fi

  docker tag "${FRONTEND_IMAGE}:next" "${FRONTEND_IMAGE}"
  echo "  → ${FRONTEND_IMAGE}:next → 正式 image"

  echo "[frontend] 重啟容器..."
  docker compose -f docker-compose.demo.yml up -d --force-recreate demo-frontend

  if ! wait_healthy "demo-frontend" "https://demo.ee.neurosme.ai" 30; then
    rollback "demo-frontend" "${FRONTEND_IMAGE}"
    return 1
  fi

  docker rmi "${FRONTEND_IMAGE}:next" 2>/dev/null || true
}

# ── 舊版相容：build + deploy 一次完成 ────────────────────────────────────────
update_backend() {
  echo ""
  echo "[backend] 備份目前 image..."
  if docker image inspect "${BACKEND_IMAGE}" > /dev/null 2>&1; then
    docker tag "${BACKEND_IMAGE}" "${BACKEND_IMAGE}:prev"
  fi

  echo "[backend] Build..."
  docker compose -f docker-compose.demo.yml build --no-cache demo-backend

  echo "[backend] 重啟容器..."
  docker compose -f docker-compose.demo.yml up -d --force-recreate demo-backend

  local elapsed=0
  while [ $elapsed -lt 60 ]; do
    if docker compose -f docker-compose.demo.yml logs demo-backend 2>&1 | grep -q "Starting uvicorn"; then break; fi
    sleep 2; elapsed=$((elapsed + 2))
  done

  if ! wait_healthy "demo-backend" "https://demo.ee.neurosme.ai/health" 30; then
    rollback "demo-backend" "${BACKEND_IMAGE}"; return 1
  fi
}

update_frontend() {
  echo ""
  echo "[frontend] 備份目前 image..."
  if docker image inspect "${FRONTEND_IMAGE}" > /dev/null 2>&1; then
    docker tag "${FRONTEND_IMAGE}" "${FRONTEND_IMAGE}:prev"
  fi

  echo "[frontend] Build..."
  docker compose -f docker-compose.demo.yml build --no-cache demo-frontend

  echo "[frontend] 重啟容器..."
  docker compose -f docker-compose.demo.yml up -d --force-recreate demo-frontend

  if ! wait_healthy "demo-frontend" "https://demo.ee.neurosme.ai" 30; then
    rollback "demo-frontend" "${FRONTEND_IMAGE}"; return 1
  fi
}

# ── 執行 ─────────────────────────────────────────────────────────────────────
FAILED=0

case "$MODE" in
  prepare)
    prepare_backend  || FAILED=1
    prepare_frontend || FAILED=1
    if [ $FAILED -eq 0 ]; then
      echo ""
      echo "✅ Build 完成，demo 仍在運行中"
      echo "   確認無誤後執行：./update-demo.sh --apply"
    fi
    ;;
  apply)
    apply_backend  || FAILED=1
    apply_frontend || FAILED=1
    ;;
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
if [ $FAILED -eq 0 ] && [ "$MODE" != "prepare" ]; then
  echo "✅ Demo 已更新：https://demo.ee.neurosme.ai"
  echo "   查看 log：docker compose -f docker-compose.demo.yml logs -f"
elif [ $FAILED -ne 0 ]; then
  echo "❌ 更新失敗，已嘗試回滾。請查看 log："
  echo "   docker compose -f docker-compose.demo.yml logs --tail=50"
  exit 1
fi
