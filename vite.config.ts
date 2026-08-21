/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync } from 'fs'

// Versions baked in at build time so the footer can never drift from what
// was actually bundled. Core's version matters independently: it determines
// detection behavior, which is what bug reports need.
const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version as string
const coreVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, 'node_modules/@doccloak/core/package.json'), 'utf8'),
).version as string

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __CORE_VERSION__: JSON.stringify(coreVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
