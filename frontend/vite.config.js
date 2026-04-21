import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var apiPort = env.VITE_API_PORT || '8000';
    var localAuthPort = env.VITE_LOCALAUTH_PORT || '4000';
    return {
        plugins: [
            react(),
            VitePWA({
                registerType: 'autoUpdate',
                // 只對 /widget/* 啟用 Service Worker
                scope: '/widget/',
                includeAssets: ['favicon.ico', 'icons/*.png'],
                manifest: {
                    name: 'NeuroSme Widget',
                    short_name: 'Widget',
                    description: 'NeuroSme 客服 Chatbot Widget',
                    theme_color: '#1A3A52',
                    background_color: '#ffffff',
                    display: 'standalone',
                    orientation: 'portrait',
                    start_url: '/widget/',
                    scope: '/widget/',
                    icons: [
                        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                    ],
                },
                workbox: {
                    // 預快取 widget 相關資源
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                    navigateFallback: '/index.html',
                    navigateFallbackDenylist: [/^\/api/, /^\/auth/],
                    runtimeCaching: [
                        {
                            // Widget API 不快取，每次即時請求
                            urlPattern: /^\/api\/v1\/widget\//,
                            handler: 'NetworkOnly',
                        },
                    ],
                },
            }),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            port: 5173,
            allowedHosts: ['ee.neurosme.ai'],
            headers: {
                "Cache-Control": "no-cache",
            },
            proxy: {
                '/api': {
                    target: "http://localhost:".concat(apiPort),
                    changeOrigin: true,
                },
                '/auth': {
                    target: "http://localhost:".concat(localAuthPort),
                    changeOrigin: true,
                    bypass: function (req) {
                        var _a, _b;
                        // 重設密碼頁面由 NeuroSme SPA 提供，僅對 page load (Accept: text/html) 不 proxy
                        var isPageLoad = (_a = req.headers.accept) === null || _a === void 0 ? void 0 : _a.includes('text/html');
                        if (isPageLoad && ((_b = req.url) === null || _b === void 0 ? void 0 : _b.startsWith('/auth/reset-password'))) {
                            return '/index.html';
                        }
                    },
                },
            },
        },
    };
});
