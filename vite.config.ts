import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { apiPlugin } from './src/server/vite-api-plugin.ts'
import { brand } from './src/components/solz/brand.ts'

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Writes the active brand into index.html's static <head>, so the first paint
 *  and link previews match the app. src/components/solz/brand.ts is the switch. */
const brandHead = (): Plugin => ({
  name: 'brand-head',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => Object.entries({
      BRAND_TITLE: brand.title,
      BRAND_DESCRIPTION: brand.description,
      BRAND_FAVICON: brand.favicon.href,
      BRAND_FAVICON_TYPE: brand.favicon.type,
      BRAND_OG_IMAGE: brand.ogImage,
      BRAND_OG_IMAGE_ALT: brand.ogImageAlt,
    }).reduce((page, [key, value]) => page.replaceAll(`%${key}%`, attribute(value)), html),
  },
})

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const runtimeEnvironment = loadEnv(mode, projectRoot, '')
  return {
    envPrefix: ['VITE_', 'PUBLIC_'],
    // 4321 is this app's documented port in docs/GENESIS_AGENT_IDENTITY.md.
    // strictPort makes a clash fail loudly instead of drifting to 5174.
    server: { port: 4321, strictPort: true },
    preview: { port: 4321, strictPort: true },
    cacheDir: mode === 'production' ? 'node_modules/.vite-production' : 'node_modules/.vite-development',
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      brandHead(),
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
