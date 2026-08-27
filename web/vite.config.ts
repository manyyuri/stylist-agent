import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4290',
      '/workspace': 'http://localhost:4290',
    },
    // 允许 import 项目根的 shared/types.ts
    fs: { allow: [resolve(__dirname, '..')] },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
