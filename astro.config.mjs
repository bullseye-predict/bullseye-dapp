// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

import vercel from '@astrojs/vercel';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicEnvironment = loadEnv(process.env.NODE_ENV === 'production' ? 'production' : 'development', projectRoot, 'VITE_');

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  adapter: vercel(),
  output: 'server',
  vite: {
    // Keep build optimization from replacing the dev server's JSX runtime.
    cacheDir: process.env.NODE_ENV === 'production' ? 'node_modules/.vite-production' : 'node_modules/.vite-development',
    // Astro and Dynamic both consume React as a peer; one resolved identity keeps every hook on the renderer's dispatcher.
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: { buffer: 'buffer/' }
    },
    // Cloudflare consumes local .env values as worker bindings before Vite builds
    // the browser island, so the island's env is published here explicitly rather
    // than inherited. It used to name a single key, which meant any other VITE_
    // value was simply absent in the browser however correctly it was configured -
    // VITE_SOLANA_RPC_ENDPOINT read as unset and the wallet refused to connect.
    // `loadEnv(..., 'VITE_')` already returns only VITE_-prefixed keys, which are
    // public by that prefix's convention, so every one of them is published.
    define: {
      // Rolldown may optimize React and React DOM in separate passes. Pin both to the
      // same mode so a development island cannot load a production renderer.
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV === 'production' ? 'production' : 'development'),
      ...Object.fromEntries(
        Object.entries(publicEnvironment).map(([key, value]) => [
          `import.meta.env.${key}`,
          JSON.stringify(value ?? '')
        ])
      )
    }
  }
});
