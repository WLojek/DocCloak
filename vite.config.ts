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

// index.html carries the same version in its JSON-LD block (softwareVersion)
// through Vite's HTML env replacement (%VITE_APP_VERSION%), so the published
// structured data can never drift from package.json either.
process.env.VITE_APP_VERSION = appVersion

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
    server: {
      deps: {
        // Core is installed from a tarball in releases (dist JS under
        // node_modules) and linked to ../DocCloak.Core in dev checkouts.
        // Inlining it makes vi.mock of its dependencies (onnxruntime-web)
        // apply in both layouts.
        inline: ['@doccloak/core'],
      },
    },
  },
})
