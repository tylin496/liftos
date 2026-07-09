export interface Env {
  GITHUB_TOKEN: string;
  SUPABASE_JWT_SECRET: string;
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

// ─── JWT verification (HS256, matches Supabase's project JWT secret) ───────

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

async function verifySupabaseJWT(
  token: string,
  secret: string,
): Promise<{ role?: string; email?: string; sub?: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = base64UrlToBytes(sigB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify("HMAC", key, signature, data);
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

    const payload = await verifySupabaseJWT(token, env.SUPABASE_JWT_SECRET);
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
