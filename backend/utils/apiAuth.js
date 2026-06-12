const crypto = require("crypto");
const { env } = require("../config");

// Constant-time comparison against API_KEY
function keyMatches(provided) {
  if (!env.API_KEY || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.API_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// In-memory failed-auth rate limit per IP (requires trust proxy behind nginx)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 20;
const failures = new Map(); // ip -> { count, resetAt }

function authMiddleware(req, res, next) {
  if (!env.API_KEY) return res.status(403).json({ error: "API disabled" });
  const ip = req.ip;
  const now = Date.now();
  const rec = failures.get(ip);
  if (rec && now < rec.resetAt && rec.count >= MAX_FAILURES) {
    return res.status(429).json({ error: "too many attempts" });
  }
  if (keyMatches(req.headers["x-api-key"])) {
    if (rec) failures.delete(ip);
    return next();
  }
  if (!rec || now >= rec.resetAt) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count++;
  }
  return res.status(401).json({ error: "unauthorized" });
}

module.exports = { authMiddleware, keyMatches };
