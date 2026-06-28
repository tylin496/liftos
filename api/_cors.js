const PRODUCTION_ORIGIN = "https://tylin496.github.io";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function setCorsHeaders(req, res, methods = "GET, POST, OPTIONS") {
  const origin = req.headers.origin;
  const allowOrigin =
    origin && (origin === PRODUCTION_ORIGIN || LOCAL_ORIGIN.test(origin))
      ? origin
      : PRODUCTION_ORIGIN;

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}
