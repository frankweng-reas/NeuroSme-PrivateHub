import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.VITE_API_PORT || '8000'
  const localAuthPort = env.VITE_LOCALAUTH_PORT || '4000'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      headers: {
        "Cache-Control": "no-cache",
      },
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/auth': {
          target: `http://localhost:${localAuthPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
