import { setCorsHeaders } from "../_cors.js";
import { isAuthorized } from "../_auth.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = isAuthorized(req);
  if (!session) {
    return res.status(401).json({ error: "Not signed in" });
  }

  return res.status(200).json({
    ok: true,
    user: {
      email: session.email,
      name: session.name,
      picture: session.picture
    }
  });
}
