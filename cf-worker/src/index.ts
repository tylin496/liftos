export interface Env {
  GITHUB_TOKEN: string;
  SUPABASE_URL: string;
  GITHUB_REPO: string;
  OWNER_EMAIL: string;
}

const ALLOWED_ORIGIN = "https://tylin496.github.io";
const ALLOWED_SPLITS = new Set(["push", "pull", "legs"]);
const SLUG_RE = /^[a-z0-9-]+$/;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ─── JWT verification (ES256, against the project's public JWKS) ───────────

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    b64url.length + ((4 - (b64url.length % 4)) % 4),
    "=",
  );
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// JWKS is small and rotates rarely; cache it for the life of the isolate.
let jwksCache: { keys: JsonWebKey[] } | null = null;

async function fetchJwks(supabaseUrl: string): Promise<{ keys: JsonWebKey[] }> {
  if (jwksCache) return jwksCache;
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  jwksCache = (await res.json()) as { keys: JsonWebKey[] };
  return jwksCache;
}

async function verifyES256(
  headerB64: string,
  payloadB64: string,
  signature: Uint8Array,
  kid: string | undefined,
  env: Env,
): Promise<boolean> {
  const { keys } = await fetchJwks(env.SUPABASE_URL);
  const jwk = keys.find((k) => (k as { kid?: string }).kid === kid) ?? keys[0];
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
}

// The project signs with asymmetric keys, so every token it issues is ES256 and
// is verified against the public JWKS. An HS256 fallback lived here for legacy
// shared-secret projects; it was unreachable once the project migrated, and a
// path that can only ever be entered by a token this project cannot mint is a
// way in, not a fallback. Anything not ES256 is rejected.
async function verifySupabaseJWT(
  token: string,
  env: Env,
): Promise<{ role?: string; email?: string; sub?: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  } catch {
    return null;
  }

  if (header.alg !== "ES256") return null;

  const signature = base64UrlToBytes(sigB64);
  let valid: boolean;
  try {
    valid = await verifyES256(headerB64, payloadB64, signature, header.kid, env);
  } catch {
    return null;
  }
  if (!valid) return null;

  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// ─── GitHub Contents API ────────────────────────────────────────────────────

async function githubPutFile(
  env: Env,
  path: string,
  contentBytes: ArrayBuffer,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const ghHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "liftos-image-upload-worker",
    Accept: "application/vnd.github+json",
  };

  let sha: string | undefined;
  const existing = await fetch(apiUrl, { headers: ghHeaders });
  if (existing.status === 200) {
    const data = (await existing.json()) as { sha: string };
    sha = data.sha;
  } else if (existing.status !== 404) {
    return { ok: false, error: `GitHub lookup failed: ${existing.status}` };
  }

  let binary = "";
  const bytes = new Uint8Array(contentBytes);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64Content = btoa(binary);

  const put = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: base64Content,
      sha,
      branch: "main",
    }),
  });

  if (!put.ok) {
    const text = await put.text();
    return { ok: false, error: `GitHub write failed: ${put.status} ${text}` };
  }
  return { ok: true };
}

// ─── Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing Authorization" }, 401);

    const payload = await verifySupabaseJWT(token, env);
    if (!payload) return json({ error: "Invalid or expired token" }, 401);
    if (payload.role !== "authenticated") return json({ error: "Not authenticated" }, 403);
    if ((payload.email ?? "").toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
      return json({ error: "Only the owner can upload exercise images" }, 403);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Expected multipart/form-data" }, 400);
    }

    const file = form.get("file");
    const split = String(form.get("split") ?? "");
    const slug = String(form.get("slug") ?? "");
    const kind = String(form.get("kind") ?? "exercise"); // "exercise" | "stretch"

    if (!(file instanceof File)) return json({ error: "Missing file" }, 400);
    if (!ALLOWED_SPLITS.has(split)) return json({ error: "Invalid split" }, 400);
    if (!SLUG_RE.test(slug)) return json({ error: "Invalid slug" }, 400);
    if (kind !== "exercise" && kind !== "stretch") return json({ error: "Invalid kind" }, 400);

    const path =
      kind === "stretch"
        ? `public/images/${split}/stretches/${slug}.png`
        : `public/images/${split}/${slug}.png`;

    const bytes = await file.arrayBuffer();
    const result = await githubPutFile(env, path, bytes, `chore(images): update ${slug} photo`);
    if (!result.ok) return json({ error: result.error }, 502);

    return json({ ok: true, path });
  },
};
