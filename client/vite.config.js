import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Exposes the server on local network (Wi-Fi) for phones, MacBooks, laptops
    // During development, any fetch('/api/...') in React is forwarded
    // to the Express backend running on port 5000.
    // This avoids CORS issues and means you never hardcode the server URL.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})

