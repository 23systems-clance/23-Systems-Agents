import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://prod-slp-alb-2025872532.us-east-1.elb.amazonaws.com',
        changeOrigin: true,
        // Strip Secure flag from cookies so they work over HTTP localhost.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map(
                (cookie) => cookie.replace(/;\s*Secure/gi, '')
              );
            }
          });
        },
      },
    },
  },
})
