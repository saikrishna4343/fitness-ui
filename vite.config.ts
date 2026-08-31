import { fileURLToPath } from 'node:url'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), './src'),
    },
  },
  server: {
    port: 5173,
    // Bind both stacks. Vite's default host is "localhost", which Node 17+ resolves
    // without reordering to IPv4 — on a machine where localhost resolves to ::1 only,
    // the server binds [::1] alone and http://127.0.0.1:5173 dies with
    // ERR_CONNECTION_REFUSED before any request is sent. `true` listens on :: in
    // dual-stack mode, so both 127.0.0.1 and [::1] work.
    host: true,
  },
})
