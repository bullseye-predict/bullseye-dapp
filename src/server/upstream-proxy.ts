type RuntimeEnv = Record<string, unknown>;
type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const hopByHopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const decodedResponseHeaders = ["content-encoding", "content-length"];

function predictionOrigin(runtime: RuntimeEnv) {
  return String(
    runtime.PUBLIC_PREDICTION_API_URL ??
      (typeof process !== "undefined"
        ? process.env.PUBLIC_PREDICTION_API_URL
        : undefined) ??
      import.meta.env.PUBLIC_PREDICTION_API_URL ??
      "",
  )
    .trim()
    .replace(/\/+$/, "");
}

function validOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.pathname.replaceAll("/", "") &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

/** Routes browser HTTP calls through the Astro host so a missing build-time
 * public variable can never silently expose the six-market simulation as live. */
export async function proxyPrediction(
  request: Request,
  path: string | undefined,
  runtime: RuntimeEnv,
  fetcher: Fetcher = fetch,
) {
  const origin = predictionOrigin(runtime);
  if (!validOrigin(origin))
    return Response.json(
      { error: "PUBLIC_PREDICTION_API_URL is unset or invalid in solz-prediction-market. Refusing to guess an upstream." },
      { status: 503 },
    );
  const target = new URL(`/${path ?? ""}`, `${origin}/`);
  target.search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  headers.delete("host");
  headers.delete("content-length");
  try {
    const response = await fetcher(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      ...(request.body ? { duplex: "half" as never } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const responseHeaders = new Headers(response.headers);
    for (const header of hopByHopHeaders) responseHeaders.delete(header);
    // Fetch decodes gzip/br before exposing response.body. Forwarding the
    // upstream encoding or byte length would make browsers decode JSON twice.
    for (const header of decodedResponseHeaders) responseHeaders.delete(header);
    responseHeaders.set("cache-control", "no-store");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "Prediction API is temporarily unavailable." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export function runtimeEnvironment(locals: unknown): RuntimeEnv {
  return (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env ?? {};
}
