import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          auth: ['@clerk/clerk-react'],
          charts: ['recharts'],
          motion: ['framer-motion', '@hello-pangea/dnd'],
        },
      },
    },
  },
})
