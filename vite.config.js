import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  base: '/app/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: '',
  },
  server: {
    port: 5173,
  },
})
