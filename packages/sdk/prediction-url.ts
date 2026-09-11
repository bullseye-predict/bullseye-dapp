/** Resolve an API path without discarding a deployment's same-origin proxy prefix. */
export function predictionUrl(path: string, baseUrl: string): URL {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), base);
}
