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
    // Astro and Dynamic both consume React as a peer; one resolved identity keeps every hook on the renderer's dispatcher.
    resolve: {
      dedupe: ['react', 'react-dom']
    },
    // Cloudflare consumes local .env values as worker bindings before Vite builds the browser island, so explicitly publish only Dynamic's public VITE identifier.
    define: {
      'import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID': JSON.stringify(publicEnvironment.VITE_DYNAMIC_ENVIRONMENT_ID ?? '')
    }
  }
});
