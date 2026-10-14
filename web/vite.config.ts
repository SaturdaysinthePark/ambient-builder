import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev -w web` for UI work: proxies to the server on :4317.
const target = 'http://127.0.0.1:4317'
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': target,
      '/preview': { target, ws: true },
      '/ws': { target, ws: true },
    },
  },
})
