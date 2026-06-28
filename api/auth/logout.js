import { setCorsHeaders } from "../_cors.js";
import { buildClearSessionCookie } from "../_auth.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Set-Cookie", buildClearSessionCookie(req));
  return res.status(200).json({ ok: true });
}
