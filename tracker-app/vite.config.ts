/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Heavy charting lib (~519KB) — lazy-loaded via InsightsView
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'recharts'
          }
          // Supabase auth/DB client (~171KB)
          if (id.includes('node_modules/@supabase')) {
            return 'supabase'
          }
          // Icon library
          if (id.includes('node_modules/lucide-react')) {
            return 'icons'
          }
          // Date utilities
          if (id.includes('node_modules/date-fns')) {
            return 'date-fns'
          }
          // Table engine — used by TableView (inside lazy ApplicationsView)
          if (id.includes('node_modules/@tanstack/react-table')) {
            return 'react-table'
          }
          // Canvas confetti
          if (id.includes('node_modules/canvas-confetti')) {
            return 'confetti'
          }
          // Stripe — loaded on pricing page
          if (id.includes('node_modules/@stripe')) {
            return 'stripe'
          }
          // React core + scheduler — long-term cached
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler')
          ) {
            return 'react-vendor'
          }
          // Router
          if (id.includes('node_modules/react-router')) {
            return 'router'
          }
          // clsx / tiny utilities — group into a shared vendor chunk
          if (
            id.includes('node_modules/clsx') ||
            id.includes('node_modules/classnames')
          ) {
            return 'utils-vendor'
          }
        },
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
