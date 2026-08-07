import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.js') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index:     resolve(__dirname, 'src/preload/index.ts'),
          extension: resolve(__dirname, 'src/preload/extension.js'),
          keeper:    resolve(__dirname, 'src/preload/keeper.js')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    server: {
      fs: { allow: [resolve(__dirname)] }
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: {
          menu:          resolve(__dirname, 'src/renderer/menu/index.html'),
          appstore:      resolve(__dirname, 'src/renderer/appstore/index.html'),
          settings:      resolve(__dirname, 'src/renderer/settings/index.html'),
          window:        resolve(__dirname, 'src/renderer/window/index.html'),
          settingsPanel: resolve(__dirname, 'src/renderer/settingsPanel/index.html')
        }
      }
    }
  }
})
