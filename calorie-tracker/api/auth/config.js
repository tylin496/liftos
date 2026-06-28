import { setCorsHeaders } from "../_cors.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || "";

  return res.status(200).json({
    ok: true,
    googleClientId
  });
}
