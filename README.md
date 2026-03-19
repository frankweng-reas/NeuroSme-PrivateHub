# NeuroSme 2.0

全端專案架構：前端 React + TypeScript + Tailwind CSS，後端 FastAPI + SQLAlchemy。

## 專案結構

```
NeuroSme2.0/
├── frontend/                 # 前端 (React + TypeScript + Tailwind)
│   ├── src/
│   │   ├── api/             # API 客戶端
│   │   ├── components/      # 共用元件
│   │   ├── pages/           # 頁面元件
│   │   ├── types/           # TypeScript 型別
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── backend/                  # 後端 (FastAPI + SQLAlchemy)
│   ├── app/
│   │   ├── api/             # API 路由
│   │   │   └── endpoints/
│   │   ├── core/            # 核心設定 (config, database)
│   │   ├── models/          # SQLAlchemy 模型
│   │   ├── schemas/         # Pydantic 結構
│   │   └── main.py
│   ├── alembic/             # 資料庫遷移
│   ├── requirements.txt
│   └── .env.example
│
└── README.md
```

## 快速開始

### PostgreSQL (Docker，僅 DB)

開發時 Docker 只跑 PostgreSQL，Backend / Frontend 皆本地執行：

```bash
cp .env.example .env   # 編輯 .env 設定 POSTGRES_PASSWORD
docker compose up -d   # 僅啟動 postgres-neurosme2
```

- 容器名稱：`neurosme2.0`
- Port：`5434`（避免與其他產品衝突）
- 資料庫：`neurosme2`

### 後端

```bash
cd backend
python -m venv venv
./venv/bin/pip install -r requirements.txt
cp .env.example .env      # 已預設 Docker 連線
./venv/bin/uvicorn app.main:app --reload --port 8000
# 若 8000 被佔用：port 8001，並在 frontend/.env 設 VITE_API_PORT=8001
```

API 文件：http://localhost:8000/docs

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端：http://localhost:5173

### LocalAuth 整合（登入功能）

登入由 [LocalAuth](https://github.com/REAS-ai-dev/localauth) 負責，需同時啟動：

1. **LocalAuth**（port 4000）：`cd localauth && docker compose up -d` 或 `npm run start:dev`
2. **NeuroSme2.0 後端**（port 8000）
3. **NeuroSme2.0 前端**（port 5173）

`backend/.env` 需設定 `JWT_SECRET`，且與 LocalAuth 一致。

**LocalAuth 在 Docker 時**：若登入出現「Failed to fetch」，在 `frontend/.env` 加上：
```
VITE_AUTH_API_URL=http://localhost:4000
```

**忘記密碼／註冊驗證信**：預設 `EMAIL_PROVIDER=console` 只會輸出到 log，不會寄信。要實際寄信請在 `localauth/.env` 設定：
- **Resend**：`EMAIL_PROVIDER=resend`、`RESEND_API_KEY=re_xxx`（見 [localauth/EMAIL_SETUP.md](../localauth/EMAIL_SETUP.md)）
- **SMTP**：`EMAIL_PROVIDER=smtp`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`

**重設密碼連結**：LocalAuth 寄出的重設連結會導向 `BASE_URL/auth/reset-password?token=xxx`。請在 `localauth/.env` 設定 `BASE_URL=http://localhost:5173`（開發）或正式環境的前端網址，讓使用者點擊後進入 NeuroSme 的重設密碼頁面。

### 資料庫遷移

```bash
cd backend
# 確保 Docker PostgreSQL 已啟動
./venv/bin/alembic revision --autogenerate -m "描述"
./venv/bin/alembic upgrade head
```

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | React 18, TypeScript, Vite, Tailwind CSS, React Router |
| 後端 | Python, FastAPI, SQLAlchemy, Pydantic |
| 資料庫 | PostgreSQL (可替換) |
