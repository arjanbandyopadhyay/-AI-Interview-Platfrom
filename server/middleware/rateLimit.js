import net from "node:net"

/**
 * Expand an IPv6 address into its 8 groups (lower-case, no leading zeros).
 * Returns null when the text is not a valid IPv6 address.
 */
export function expandIPv6(ip) {
  const addr0 = String(ip).split("%")[0]            // drop a zone id such as %eth0
  if (!net.isIPv6(addr0)) return null
  let addr = addr0
  const lastColon = addr.lastIndexOf(":")
  const tail = addr.slice(lastColon + 1)
  if (tail.includes(".")) {                          // embedded IPv4, e.g. ::ffff:1.2.3.4
    const p = tail.split(".").map(Number)
    addr = addr.slice(0, lastColon + 1) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16)
  }
  const [head, rest] = addr.split("::")
  const h = head ? head.split(":") : []
  const t = rest === undefined ? [] : (rest ? rest.split(":") : [])
  const fill = rest === undefined ? 0 : 8 - h.length - t.length
  const groups = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...t]
  if (groups.length !== 8) return null
  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
}

/**
 * Turn a client address into a rate-limit key.
 * IPv4 is used as is; IPv4-mapped IPv6 becomes plain IPv4; other IPv6 addresses are
 * grouped by their /64 prefix (one household/device owns a whole /64, so a client cannot
 * dodge a limit by rotating through the addresses of its own network).
 */
export function normalizeIp(ip) {
  if (typeof ip !== "string" || !ip) return "unknown"
  if (net.isIPv4(ip)) return ip
  const g = expandIPv6(ip)
  if (!g) return ip
  if (g.slice(0, 5).every((x) => x === "0") && g[5] === "ffff") {
    const a = parseInt(g[6], 16), b = parseInt(g[7], 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return `${g.slice(0, 4).join(":")}::/64`
}

export const ipKeyGenerator = (req) => `ip:${normalizeIp(req.ip)}`
/** One bucket per logged-in user (use after isAuth); falls back to the IP address. */
export const userKeyGenerator = (req) => (req.userId ? `user:${String(req.userId)}` : ipKeyGenerator(req))

/**
 * Fixed-window rate limiter middleware, kept in memory (fine for a single server instance;
 * use a shared store such as Redis if the app is ever scaled to several instances).
 *
 *   windowMs      length of the window in milliseconds
 *   limit         requests allowed per key per window
 *   keyGenerator  (req) => string, defaults to the client IP
 *   maxKeys       upper bound on tracked keys, so memory cannot grow without limit
 *   now           clock function (injectable for tests)
 */
export function createRateLimiter({
  windowMs,
  limit,
  keyGenerator = ipKeyGenerator,
  message = "Too many requests.",
  maxKeys = 100_000,
  now = Date.now,
} = {}) {
  if (!(windowMs > 0) || !(limit > 0)) throw new Error("createRateLimiter needs a positive windowMs and limit")

  const hits = new Map() // key -> { count, resetAt }

  const prune = () => {
    const t = now()
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key)
  }
  const timer = setInterval(prune, Math.min(windowMs, 60_000))
  timer.unref?.() // never keep the process alive just for housekeeping

  const middleware = (req, res, next) => {
    const t = now()
    const key = keyGenerator(req)
    let entry = hits.get(key)

    if (!entry || entry.resetAt <= t) {
      if (!entry && hits.size >= maxKeys) {
        prune()
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value) // evict the oldest key
      }
      entry = { count: 0, resetAt: t + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1

    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - t) / 1000))
    res.set("RateLimit-Limit", String(limit))
    res.set("RateLimit-Remaining", String(Math.max(0, limit - entry.count)))
    res.set("RateLimit-Reset", String(resetSeconds))

    if (entry.count > limit) {
      res.set("Retry-After", String(resetSeconds))
      return res.status(429).json({ message: `${message} Please try again in ${resetSeconds} seconds.`, retryAfter: resetSeconds })
    }
    next()
  }

  middleware.prune = prune
  middleware.size = () => hits.size
  middleware.reset = () => hits.clear()
  return middleware
}
