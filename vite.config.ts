/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Renderer: iki giriş (ana pencere + overlay), file:// ile yüklendiği için base './'
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  test: { root: __dirname, include: ['tests/**/*.test.ts'], testTimeout: 600_000 },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/renderer/index.html'),
        overlay: path.resolve(__dirname, 'src/renderer/overlay.html'),
      },
    },
  },
});
