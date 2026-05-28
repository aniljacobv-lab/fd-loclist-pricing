import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keep /api in the path so dev and production behave identically —
      // the API mounts all routes under /api in src/server.ts.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
