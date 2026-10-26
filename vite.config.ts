import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: { '/ws': { target: 'ws://127.0.0.1:3001', ws: true }, '^/social$': { target: 'ws://127.0.0.1:3001', ws: true } },
  },
});