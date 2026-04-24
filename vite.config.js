import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Needed for deck.gl worker threads
  worker: {
    format: 'es'
  }
})
