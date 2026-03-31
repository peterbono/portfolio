import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'api'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    // Allow tests to import from api/ directory
    server: {
      deps: {
        inline: [/api\//],
      },
    },
  },
})
