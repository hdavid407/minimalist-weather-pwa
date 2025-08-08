import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// For GitHub Pages, set VITE_BASE to '/<your-repo>/' before building
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Minimalist Weather',
        short_name: 'Weather',
  start_url: base,
  scope: base,
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: ({url}) => url.origin.includes('open-meteo.com'),
            handler: 'NetworkFirst',
            options: { cacheName: 'open-meteo', expiration: { maxEntries: 100, maxAgeSeconds: 3600 } }
          },
          {
            urlPattern: ({url}) => url.origin.includes('farmsense') || url.origin.includes('your-farmsense'),
            handler: 'NetworkFirst',
            options: { cacheName: 'farmsense', expiration: { maxEntries: 60, maxAgeSeconds: 3600 } }
          }
        ]
      }
    })
  ]
})
