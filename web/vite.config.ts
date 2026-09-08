import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'http://127.0.0.1:7331';

/**
 * В разработке интерфейс живёт на своём порту, а данные берёт у нашего сервера
 * через прокси: так браузер видит один источник и вопрос CORS не возникает.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 7330,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        // Поток сенсоров — SSE: буферизация прокси убила бы живое обновление.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          });
        },
      },
    },
  },
});
