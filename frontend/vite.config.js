import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var apiPort = env.VITE_API_PORT || '8000';
    var localAuthPort = env.VITE_LOCALAUTH_PORT || '4000';
    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            port: 5173,
            proxy: {
                '/api': {
                    target: "http://localhost:".concat(apiPort),
                    changeOrigin: true,
                },
                '/auth': {
                    target: "http://localhost:".concat(localAuthPort),
                    changeOrigin: true,
                },
            },
        },
    };
});
