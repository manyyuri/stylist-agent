import { defineConfig } from 'vite';
import { flue } from '@flue/vite';

export default defineConfig({
  plugins: [flue()],
  server: { port: 4291 },
});
