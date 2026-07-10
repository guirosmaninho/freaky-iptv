import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    cssMinify: false
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
