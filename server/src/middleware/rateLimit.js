/**
 * Rate limiting
 * -------------
 * `POST /v1/incidents` is payment-gated, so abuse there costs the abuser
 * money. The read endpoints aren't, and `/v1/status` makes two upstream
 * facilitator calls per request — so unthrottled it's both a way to burn
 * Encode's facilitator quota and a small amplification vector.
 *
 * Fixed-window counter in memory. That's the honest scope: it resets on
 * restart and doesn't coordinate across instances. It's enough for one
 * container serving a hackathon-scale service, and pretending otherwise
 * would be worse than saying so.
 */

const WINDOW_MS = 60_000;
const buckets = new Map(); // key -> { count, resetAt }

/** Trust the platform's proxy header, but only the first hop. */
function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Unbounded growth under a spray of distinct IPs would be its own problem.
function sweep(now) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit({ max, windowMs = WINDOW_MS, name = 'default' }) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${name}:${clientKey(req)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
      sweep(now);
    }

    bucket.count++;
    const remaining = Math.max(0, max - bucket.count);

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: retryAfter });
    }

    next();
  };
}
