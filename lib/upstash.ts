// Server-only Upstash REST client. Never import this module from client components.
type RedisArgument = string | number;

function credentials(): { url: string; token: string } | null {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!rawUrl && !token) return null;
  if (!rawUrl || !token) throw new Error("Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("UPSTASH_REDIS_REST_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("UPSTASH_REDIS_REST_URL must be a valid HTTPS URL.");
  }
  return { url: url.toString().replace(/\/$/, ""), token };
}

export function hasUpstash(): boolean {
  return credentials() !== null;
}

/** Send one Redis command using Upstash's POST JSON-array REST protocol. */
export async function upstashCommand<T>(command: RedisArgument[]): Promise<T> {
  const config = credentials();
  if (!config) throw new Error("Upstash Redis is not configured.");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Upstash Redis request failed (${response.status}).`);

  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("Upstash Redis returned an invalid response.");
  if ("error" in body) throw new Error("Upstash Redis command failed.");
  if (!("result" in body)) throw new Error("Upstash Redis returned an invalid response.");
  return body.result as T;
}
