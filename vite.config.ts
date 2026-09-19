import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { apiPlugin } from './src/server/vite-api-plugin.ts'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const runtimeEnvironment = loadEnv(mode, projectRoot, '')
  return {
    envPrefix: ['VITE_', 'PUBLIC_'],
    cacheDir: mode === 'production' ? 'node_modules/.vite-production' : 'node_modules/.vite-development',
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      apiPlugin(runtimeEnvironment),
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: { buffer: 'buffer/' },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      __SOLZ_GAME_ORIGIN__: JSON.stringify(runtimeEnvironment.SOLZ_GAME_ORIGIN ?? ''),
    },
    build: { sourcemap: true },
  }
})
