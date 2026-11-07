/**
 * Adds a `Server-Timing: total;dur=<ms>` header to every response (visible in the browser's DevTools
 * Network tab) and logs requests slower than `slowMs`, so real bottlenecks can be found in production.
 * Query strings are never logged.
 */
export function requestTiming({
  slowMs = Number(process.env.SLOW_REQUEST_MS ?? 3000),
  now = () => Number(process.hrtime.bigint()) / 1e6,
  log = console.warn,
} = {}) {
  return (req, res, next) => {
    const start = now()

    // Headers must be set before they are sent, so hook writeHead (Node calls it for res.end/res.json).
    const writeHead = res.writeHead
    res.writeHead = function (...args) {
      if (!res.headersSent) res.setHeader("Server-Timing", `total;dur=${(now() - start).toFixed(1)}`)
      return writeHead.apply(this, args)
    }

    res.on("finish", () => {
      const ms = now() - start
      if (ms >= slowMs) log(`SLOW ${req.method} ${String(req.originalUrl ?? req.url).split("?")[0]} ${res.statusCode} ${ms.toFixed(0)}ms`)
    })
    next()
  }
}
