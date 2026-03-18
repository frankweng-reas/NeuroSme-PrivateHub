# 如何 Copy 登入註冊功能

本文件說明如何將 NeuroSme2.0 的登入／註冊功能複製並整合至其他專案。

---

## 一、架構概覽

登入註冊由 **LocalAuth** 外部服務負責，流程如下：

1. **前端** → 呼叫 LocalAuth `/auth/login`、`/auth/register`、`/auth/refresh`
2. **LocalAuth** → 回傳 JWT `access_token`、`refresh_token`、`user`
3. **後端** → 以 `JWT_SECRET` 驗證 token，並透過 `get_current_user` 取得使用者

---

## 二、需複製的檔案清單

### 前端（Frontend）

| 檔案路徑 | 說明 |
|---------|------|
| `frontend/src/contexts/AuthContext.tsx` | 認證 Context：登入、註冊、登出、token 管理 |
| `frontend/src/pages/LoginPage.tsx` | 登入頁 |
| `frontend/src/pages/RegisterPage.tsx` | 註冊頁 |
| `frontend/src/components/ProtectedRoute.tsx` | 需登入才能存取的路由守衛 |
| `frontend/src/api/client.ts` | API 客戶端：Bearer token、401 處理、refresh token |
| `frontend/src/api/users.ts` | 取得當前使用者（`getMe`）等 API |
| `frontend/vite.config.ts` 或 `frontend/vite.config.js` | Vite proxy：`/auth` → LocalAuth |
| `frontend/.env.example` | 環境變數範例 |

**依賴檔案（若專案無對應功能需一併複製或改寫）：**

- `frontend/src/components/Layout.tsx`：使用 `useAuth`、`getMe`、登出按鈕
- `frontend/src/App.tsx`：`AuthProvider`、`/login`、`/register` 路由
- `frontend/src/types/index.ts`：`User` 型別

### 後端（Backend）

| 檔案路徑 | 說明 |
|---------|------|
| `backend/app/core/security.py` | JWT 驗證、`get_current_user` |
| `backend/app/core/config.py` | 設定 `JWT_SECRET` |
| `backend/app/api/endpoints/users.py` | `/users/me` 等 API |
| `backend/app/models/user.py` | User ORM |
| `backend/app/models/tenant.py` | Tenant ORM（`get_current_user` 會用到） |
| `backend/app/schemas/user.py` | User Pydantic schemas |
| `backend/.env.example` | 環境變數範例 |

**依賴檔案：**

- `backend/app/core/database.py`：`get_db`
- `backend/app/api/__init__.py`：掛載 users router
- `backend/app/models/user_agent.py`：若使用 agent 權限功能

---

## 三、快速複製指令

```bash
# 假設目標專案結構與 NeuroSme2.0 類似

# 前端
cp frontend/src/contexts/AuthContext.tsx <目標>/frontend/src/contexts/
cp frontend/src/pages/LoginPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/RegisterPage.tsx <目標>/frontend/src/pages/
cp frontend/src/components/ProtectedRoute.tsx <目標>/frontend/src/components/
cp frontend/src/api/client.ts <目標>/frontend/src/api/
cp frontend/src/api/users.ts <目標>/frontend/src/api/
cp frontend/.env.example <目標>/frontend/

# 後端
cp backend/app/core/security.py <目標>/backend/app/core/
cp backend/app/core/config.py <目標>/backend/app/core/
cp backend/app/api/endpoints/users.py <目標>/backend/app/api/endpoints/
cp backend/app/models/user.py <目標>/backend/app/models/
cp backend/app/models/tenant.py <目標>/backend/app/models/
cp backend/app/schemas/user.py <目標>/backend/app/schemas/
cp backend/.env.example <目標>/backend/
```

---

## 四、整合步驟

### 4.1 部署 LocalAuth

登入／註冊由 [LocalAuth](https://github.com/REAS-ai-dev/localauth) 負責，需先部署：

```bash
cd localauth
docker compose up -d
# 或
npm run start:dev
```

預設 port：**4000**

### 4.2 後端設定

1. 複製 `.env.example` 為 `.env`
2. 設定 `JWT_SECRET`，**必須與 LocalAuth 一致**

```env
JWT_SECRET=your-secret-key-here
```

3. 確保資料庫有 `users`、`tenants` 表（執行 Alembic 遷移）
4. 在 API router 中掛載 users：

```python
router.include_router(users.router, prefix="/users", tags=["users"])
```

### 4.3 前端設定

1. 複製 `.env.example` 為 `.env`
2. 若 LocalAuth 在 Docker 或不同網域，設定完整 URL：

```env
VITE_AUTH_API_URL=http://localhost:4000
```

3. 在 `vite.config.ts` 加入 `/auth` proxy（開發環境）：

```ts
proxy: {
  '/api': { target: 'http://localhost:8000', changeOrigin: true },
  '/auth': { target: 'http://localhost:4000', changeOrigin: true },
}
```

4. 在 App 中包一層 `AuthProvider`，並設定路由：

```tsx
<AuthProvider>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
    {/* 其他需登入的路由用 ProtectedRoute 包起來 */}
  </Routes>
</AuthProvider>
```

### 4.4 依賴套件

**後端：**

- `PyJWT`：JWT 驗證

**前端：**

- `react-router-dom`：路由
- 若使用 `@/` 路徑別名，需在 `vite.config` 設定 `resolve.alias`

---

## 五、LocalAuth API 規格

若同事需自行實作認證服務，需符合以下規格：

### POST /auth/login

**Request：**
```json
{ "email": "user@example.com", "password": "123456" }
```

**Response：**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "xxx", "email": "user@example.com", "name": "User" }
}
```

### POST /auth/register

**Request：**
```json
{ "email": "user@example.com", "password": "123456", "name": "User" }
```

**Response：** 同 login

### POST /auth/refresh

**Request：**
```json
{ "refresh_token": "eyJ..." }
```

**Response：**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

JWT payload 需包含 `email` 欄位，後端以此驗證並建立/查詢使用者。

---

## 六、注意事項

1. **JWT_SECRET**：後端與 LocalAuth 必須使用相同 secret
2. **CORS**：若前後端不同網域，後端需允許前端 origin
3. **Token 儲存**：前端使用 `localStorage`（`neurosme_access_token`、`neurosme_refresh_token`、`neurosme_user`）
4. **首次登入同步**：`get_current_user` 會依 JWT 的 email 在 NeuroSme2.0 建立 User（若尚不存在），並歸入第一個 tenant
