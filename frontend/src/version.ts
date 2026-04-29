/**
 * Release label：Docker/on-prem 於 build 時設定 VITE_APP_VERSION；
 * 本地 `npm run dev` / build 時由 vite.config 自 repo 根目錄 VERSION 填入（見該檔）。
 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION.trim()
