import crypto from "crypto";

export const SESSION_COOKIE = "ct_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function getSessionSecret() {
  return process.env.SESSION_SECRET || "";
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function createSessionToken({ email, sub, name, picture }) {
  const secret = getSessionSecret();
  if (!secret) return null;

  const payload = {
    email,
    sub,
    name: name || "",
    picture: picture || "",
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000
  };
  const data = encodeBase64Url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySessionToken(token) {
  const secret = getSessionSecret();
  if (!secret || !token) return null;

  const [data, sig] = token.split(".");
  if (!data || !sig) return null;

  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(data));
    if (!payload?.email || !payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAllowedEmails() {
  const raw = process.env.ALLOWED_GOOGLE_EMAILS || "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email) {
  const allowed = getAllowedEmails();
  if (!allowed.length) return false;
  return allowed.includes(String(email || "").trim().toLowerCase());
}

export async function verifyGoogleAccessToken(accessToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !accessToken) return null;

  const tokenInfoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!tokenInfoRes.ok) return null;

  const tokenInfo = await tokenInfoRes.json();
  const audience = tokenInfo.aud || tokenInfo.azp;
  if (audience !== clientId) return null;
  if (Number(tokenInfo.exp) * 1000 < Date.now()) return null;

  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!userRes.ok) return null;

  const data = await userRes.json();
  if (!data.email) return null;

  return {
    email: data.email,
    sub: data.sub || data.id || tokenInfo.sub,
    name: data.name || "",
    picture: data.picture || ""
  };
}

export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !idToken) return null;

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (!response.ok) return null;

  const data = await response.json();
  if (data.aud !== clientId) return null;
  if (Number(data.exp) * 1000 < Date.now()) return null;
  if (!data.email || data.email_verified !== "true") return null;

  return {
    email: data.email,
    sub: data.sub,
    name: data.name || "",
    picture: data.picture || ""
  };
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getDevBypassSession(req) {
  if (process.env.DEV_BYPASS_AUTH !== "1") return null;
  // Only honor on localhost requests so a misconfigured prod deploy can never bypass auth.
  const host = String(req.headers.host || "").toLowerCase();
  const isLocalHost = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  if (!isLocalHost) return null;
  return {
    email: process.env.DEV_BYPASS_EMAIL || "dev@local",
    sub: "dev-local",
    name: "Dev (local)",
    picture: ""
  };
}

export function getSessionFromRequest(req) {
  const dev = getDevBypassSession(req);
  if (dev) return dev;
  const bearer = getBearerToken(req);
  if (bearer) {
    const fromBearer = verifySessionToken(bearer);
    if (fromBearer) return fromBearer;
  }
  const cookies = parseCookies(req.headers.cookie || "");
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

export function isAuthorized(req) {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  if (getDevBypassSession(req)) return session;
  return isEmailAllowed(session.email) ? session : null;
}

export function buildSessionCookie(token, req) {
  const isSecure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
    "HttpOnly",
    isSecure ? "Secure" : "",
    isSecure ? "SameSite=None" : "SameSite=Lax"
  ].filter(Boolean);

  return parts.join("; ");
}

export function buildClearSessionCookie(req) {
  const isSecure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    isSecure ? "Secure" : "",
    isSecure ? "SameSite=None" : "SameSite=Lax"
  ].filter(Boolean);

  return parts.join("; ");
}
