import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Test configuration lives in vitest.config.ts (which extends this file).
export default defineConfig({
  plugins: [react()],
})
