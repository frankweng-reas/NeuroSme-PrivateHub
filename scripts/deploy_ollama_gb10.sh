#!/bin/bash
# DGX Spark GB10 — 單一 Ollama LLM Server（gemma4:26b）
# 用法: bash deploy_ollama_gb10.sh
set -e

echo "=== DGX Spark GB10 Ollama 部署 ==="

# 停用多實例
sudo systemctl stop ollama2 ollama3 2>/dev/null || true
sudo systemctl disable ollama2 ollama3 2>/dev/null || true
sudo rm -rf /etc/systemd/system/ollama2.service* /etc/systemd/system/ollama3.service* 2>/dev/null || true
sudo rm -f /etc/nginx/conf.d/ollama-lb.conf 2>/dev/null || true

# GB10 最佳化設定
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << EOF
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_LLM_LIBRARY=cuda_v13"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=3"
Environment="OLLAMA_REQUEST_TIMEOUT=600"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
EOF

sudo systemctl daemon-reload
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable --now ollama

echo "等待 Ollama 啟動..."
sleep 3
curl -s http://127.0.0.1:11434/api/version

echo ""
echo "下載 gemma4:26b..."
sudo -u ollama ollama pull gemma4:26b

echo ""
echo "=== 完成 ==="
echo "API: http://$(tailscale ip -4 2>/dev/null || hostname -I | awk '{print $1}'):11434"
sudo -u ollama ollama list
