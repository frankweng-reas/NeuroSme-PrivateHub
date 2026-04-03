# 如何 Copy 登入註冊功能

本文件說明如何將 NeuroSme2.0 的登入／註冊與密碼管理功能複製並整合至其他專案。

---

## 一、架構概覽

登入註冊與密碼管理由 **LocalAuth** 外部服務負責，流程如下：

1. **前端** → 呼叫 LocalAuth `/auth/login`、`/auth/register`、`/auth/refresh`、`/auth/password`、`/auth/forgot-password`、`/auth/reset-password`、`/auth/change-password-expired`
2. **LocalAuth** → 回傳 JWT `access_token`、`refresh_token`、`user`
3. **後端** → 以 `JWT_SECRET` 驗證 token，並透過 `get_current_user` 取得使用者

---

## 二、需複製的檔案清單

### 前端（Frontend）

| 檔案路徑 | 說明 |
|---------|------|
| `frontend/src/contexts/AuthContext.tsx` | 認證 Context：登入、註冊、登出、修改密碼、忘記密碼、重設密碼、token 管理 |
| `frontend/src/pages/LoginPage.tsx` | 登入頁 |
| `frontend/src/pages/RegisterPage.tsx` | 註冊頁 |
| `frontend/src/pages/ForgotPasswordPage.tsx` | 忘記密碼頁（輸入 email 寄送重設連結） |
| `frontend/src/pages/ResetPasswordPage.tsx` | 重設密碼頁（從 Email 連結進入，以 token 設定新密碼） |
| `frontend/src/pages/ChangePasswordPage.tsx` | 修改密碼頁（已登入時使用） |
| `frontend/src/pages/ChangePasswordExpiredPage.tsx` | 密碼過期更換頁（未登入時更換密碼） |
| `frontend/src/components/ProtectedRoute.tsx` | 需登入才能存取的路由守衛 |
| `frontend/src/api/client.ts` | API 客戶端：Bearer token、401 處理、refresh token |
| `frontend/src/api/users.ts` | 取得當前使用者（`getMe`）等 API |
| `frontend/vite.config.ts` 或 `frontend/vite.config.js` | Vite proxy：`/auth` → LocalAuth（含 reset-password 頁面 bypass） |
| `frontend/.env.example` | 環境變數範例 |

**依賴檔案（若專案無對應功能需一併複製或改寫）：**

- `frontend/src/components/Layout.tsx`：使用 `useAuth`、`getMe`、登出按鈕
- `frontend/src/App.tsx`：`AuthProvider`、`/login`、`/register`、密碼相關路由
- `frontend/src/contexts/ToastContext.tsx`：`ChangePasswordPage` 成功訊息需 `useToast`
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
cp frontend/src/pages/ForgotPasswordPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ResetPasswordPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ChangePasswordPage.tsx <目標>/frontend/src/pages/
cp frontend/src/pages/ChangePasswordExpiredPage.tsx <目標>/frontend/src/pages/
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
2. 環境變數（可選）：
   - `VITE_AUTH_API_URL`：若 LocalAuth 在 Docker 或不同網域，設定完整 URL（如 `http://localhost:4000`）
   - `VITE_LOCALAUTH_PORT`：Vite proxy 用，預設 4000
   - `VITE_API_PORT`：後端 API port，預設 8000

3. 在 `vite.config.ts` 加入 `/auth` proxy（開發環境）。重設密碼頁面由 SPA 提供，需對 page load 做 bypass：

```ts
proxy: {
  '/api': { target: 'http://localhost:8000', changeOrigin: true },
  '/auth': {
    target: 'http://localhost:4000',
    changeOrigin: true,
    bypass(req) {
      // 重設密碼頁面由 SPA 提供，僅對 page load (Accept: text/html) 不 proxy
      const isPageLoad = req.headers.accept?.includes('text/html')
      if (isPageLoad && req.url?.startsWith('/auth/reset-password')) {
        return '/index.html'
      }
    },
  },
}
```

4. 在 App 中包一層 `AuthProvider`，並設定路由：

```tsx
<AuthProvider>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/change-password-expired" element={<ChangePasswordExpiredPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
    <Route path="/" element={<Layout />}>
      <Route index element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
      {/* 其他需登入的路由用 ProtectedRoute 包起來 */}
    </Route>
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

## 五、On-Prem 部署控制

On-prem 環境通常無法寄信（無 SMTP），且不開放自助註冊，需在 `localauth/.env` 調整以下開關：

| LocalAuth 環境變數 | 預設值 | On-Prem 建議值 | 說明 |
|---|---|---|---|
| `REQUIRE_EMAIL_VERIFICATION` | `true` | `false` | 跳過 Email 驗證，註冊後直接可登入 |
| `REGISTRATION_DISABLED` | `false` | `true` | 禁止自助註冊，僅限 Admin API 建帳 |
| `FORGOT_PASSWORD_ENABLED` | `true` | `false` | 停用「忘記密碼」寄信（無 SMTP 時建議關閉） |
| `ADMIN_API_KEY` | （必填） | 32+ 字元隨機字串 | 保護 `/admin/*`，可用 `openssl rand -hex 32` 產生 |
| `EMAIL_PROVIDER` | `console` | `console` 或 `smtp` | 無寄信需求維持 console；有需求改 smtp |

**對應前端開關**（`frontend/.env`）：

| 前端環境變數 | On-Prem 建議值 | 說明 |
|---|---|---|
| `VITE_AUTH_ALLOW_REGISTER` | `false` | 隱藏登入頁「前往註冊」連結 |
| `VITE_AUTH_ALLOW_FORGOT_PASSWORD` | `false` | 隱藏登入頁「忘記密碼」連結 |

> LocalAuth 端的設定控制「是否真的接受 API 請求」；前端開關控制「UI 是否顯示入口」。兩者應保持一致。

---

## 六、LocalAuth API 規格

JWT payload 包含 `sub`（user id）與 `email`，後端以 `email` 驗證並建立/查詢使用者。

### `/auth` 端點（公開或需 JWT）

#### POST /auth/login

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

**錯誤：**
- `401` 帳密錯誤，或 email 未驗證（`REQUIRE_EMAIL_VERIFICATION=true`）
- `403` 密碼已過期（需導向 `/change-password-expired`）

---

#### POST /auth/register

> 若 `REGISTRATION_DISABLED=true` 回傳 `403`。

**Request：**
```json
{ "email": "user@example.com", "password": "123456", "name": "User" }
```

**Response（`REQUIRE_EMAIL_VERIFICATION=true`，預設）：**
```json
{ "message": "Registration successful. Please check your email to verify your account." }
```

**Response（`REQUIRE_EMAIL_VERIFICATION=false`，on-prem）：**
```json
{ "message": "Registration successful. You can now log in." }
```

---

#### POST /auth/refresh

**Request：**
```json
{ "refresh_token": "eyJ..." }
```

**Response：**
```json
{ "access_token": "eyJ...", "refresh_token": "eyJ..." }
```

---

#### POST /auth/validate-token

驗證 token 是否有效（供後端或其他服務呼叫）。

**Request：**
```json
{ "token": "eyJ..." }
```

**Response：**
```json
{ "valid": true, "userId": "xxx", "email": "user@example.com", "name": "User" }
```

---

#### GET /auth/profile（需 JWT）

取得當前登入使用者資訊。

**Response：** `{ "id", "email", "name" }`

---

#### GET /auth/userinfo（需 JWT）

OIDC 相容格式，含 `email_verified`。

**Response：** `{ "sub", "email", "name", "email_verified" }`

---

#### PATCH /auth/password（需 JWT，已登入改密碼）

**Request：**
```json
{ "old_password": "舊密碼", "new_password": "新密碼" }
```

**Response：** `{ "message": "Password updated successfully" }`

---

#### POST /auth/change-password-expired（密碼過期，未登入）

**Request：**
```json
{ "email": "user@example.com", "old_password": "舊密碼", "new_password": "新密碼" }
```

**Response：** `{ "message": "Password updated successfully" }`

---

#### POST /auth/logout（需 JWT）

撤銷目前 refresh token。

**Response：** `{ "message": "Logged out successfully" }`

---

#### POST /auth/revoke-all-sessions（需 JWT）

撤銷所有 session（重設密碼/安全事件時使用）。

**Response：** `{ "message": "All sessions revoked successfully" }`

---

#### POST /auth/forgot-password

> 若 `FORGOT_PASSWORD_ENABLED=false` 回傳 `503`。  
> 為防 email 枚舉，無論 email 是否存在皆回傳成功。

**Request：** `{ "email": "user@example.com" }`

**Response：** `{ "message": "若該信箱已註冊，您將收到密碼重設郵件" }`

LocalAuth 寄出的連結導向 `{BASE_URL}/auth/reset-password?token=xxx`（在 `localauth/.env` 設 `BASE_URL` 為前端網址）。

---

#### POST /auth/reset-password（以 token 重設密碼）

**Request：** `{ "token": "重設連結中的 token", "new_password": "新密碼" }`

**Response：** `{ "message": "密碼已重設成功，請使用新密碼登入" }`

---

#### GET /auth/reset-password?token=xxx

回傳重設密碼 HTML 表單（LocalAuth 自帶，不走 SPA）。  
⚠️ Vite proxy 需對此路徑的 page load（`Accept: text/html`）做 bypass，讓 SPA 的 `/auth/reset-password` 頁面優先提供（見 4.3 proxy 設定）。

---

#### POST /auth/verify-email

**Request：** `{ "token": "驗證碼" }`

**Response：** `{ "message": "Email verified successfully", "email": "..." }`

---

#### GET /auth/verify-email?token=xxx

回傳驗證結果 HTML 頁面（LocalAuth 自帶）。

---

#### POST /auth/resend-verification

重新寄送驗證信（僅適用 `REQUIRE_EMAIL_VERIFICATION=true`）。

**Request：** `{ "email": "user@example.com" }`

---

### `/admin` 端點（需 `x-admin-api-key` header）

所有 `/admin/*` 端點需在 request header 帶：

```
x-admin-api-key: <ADMIN_API_KEY>
```

#### GET /admin/users

列出所有使用者。

---

#### POST /admin/users

由管理員建立使用者（適合 on-prem 禁止自助註冊的場景）。

**Request：**
```json
{
  "email": "user@example.com",
  "password": "初始密碼",
  "name": "王小明",
  "mustChangePassword": true
}
```

- `mustChangePassword: true`：使用者首次登入時會被強制要求更換密碼（密碼過期機制）。

**Response：**
```json
{ "id": "xxx", "email": "...", "name": "...", "mustChangePassword": true }
```

---

#### DELETE /admin/users/:id

刪除指定使用者（`204 No Content`）。

---

## 七、注意事項

1. **JWT_SECRET**：後端與 LocalAuth 必須使用相同 secret
2. **CORS**：若前後端不同網域，後端需允許前端 origin
3. **Token 儲存**：前端使用 `localStorage`（`neurosme_access_token`、`neurosme_refresh_token`、`neurosme_user`）
4. **首次登入同步**：`get_current_user` 會依 JWT 的 email 在 NeuroSme2.0 建立 User（若尚不存在），並歸入第一個 tenant
5. **重設密碼流程**：忘記密碼 → LocalAuth 寄送 Email 連結（`/auth/reset-password?token=xxx`）→ 使用者點擊進入 SPA 重設密碼頁。Vite proxy 需對 `/auth/reset-password` 的 page load 做 bypass，讓 SPA 提供頁面
6. **密碼過期**：登入時若 LocalAuth 回傳密碼過期（403），前端導向 `/change-password-expired`，以 `location.state` 傳遞 `email`、`password`
7. **On-Prem 帳號建立流程**：`REGISTRATION_DISABLED=true` → 管理員呼叫 `POST /admin/users`（帶 `ADMIN_API_KEY`）建立帳號 → 通知使用者初始密碼 → 使用者登入後被要求改密碼（若 `mustChangePassword: true`）
8. **AD 整合**：設定 `AD_ENABLED=true` 後，AD 使用者可用 AD 帳密登入，但無法在 LocalAuth 修改或重設密碼（需由 AD 管理）
