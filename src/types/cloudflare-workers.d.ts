declare module 'cloudflare:workers' {
  /**
   * Astro's Cloudflare adapter resolves this runtime binding in development and
   * production. Keep the app-specific shape narrow so server secrets cannot be
   * mistaken for client-side environment variables.
   */
  export const env: {
    SOLZ_COLYSEUS_SERVER_URL?: string
    SOLZ_GAME_ORIGIN?: string
  }
}
