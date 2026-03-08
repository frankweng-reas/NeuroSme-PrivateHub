#!/usr/bin/env python3
"""測試台智雲 Conversation API 連線。執行：python -m scripts.test_twcc"""
import os
import sys

# 載入 .env
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

api_key = os.getenv("TWCC_API_KEY")
api_base = os.getenv("TWCC_API_BASE", "https://api-ams.twcc.ai/api/models/conversation")
if not api_key:
    print("請在 .env 設定 TWCC_API_KEY")
    sys.exit(1)

import urllib.request
import json

url = api_base.rstrip("/")
payload = {
    "model": "llama3.1-ffm-8b-32k-chat",
    "messages": [
        {"role": "user", "content": "人口最多的國家是?"},
        {"role": "assistant", "content": "人口最多的國家是印度。"},
        {"role": "user", "content": "主要宗教為?"},
    ],
    "parameters": {
        "max_new_tokens": 2000,
        "temperature": 0.3,
        "top_k": 40,
        "top_p": 0.9,
        "frequency_penalty": 1.2,
    },
}
headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}

print(f"POST {url}")
print("model:", payload["model"])
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode(),
    headers=headers,
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read().decode())
content = data.get("generated_text", "")
print("成功:", content[:200] if content else "(無 generated_text)")
if "total_tokens" in data:
    print("tokens:", data.get("total_tokens"))
