// Managed by Ambient Builder: the base path and host settings let the live
// preview be served through the Ambient Builder server (and its tunnel).
// Change plugins freely, but keep `base` and `server` as they are.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: process.env.AMBIENT_PREVIEW_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    allowedHosts: true,
  },
})
