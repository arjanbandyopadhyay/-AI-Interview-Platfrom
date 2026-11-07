#!/usr/bin/env node
// Dependency-free HTTP load generator for measuring latency and throughput of this API.
//
//   node scripts/loadtest.mjs --url https://your-api.onrender.com --path /health --connections 20 --duration 10
//   node scripts/loadtest.mjs --url http://localhost:5000 --path /api/user/current-user --cookie "token=<jwt>"
//   node scripts/loadtest.mjs --url ... --path /api/payment/order --method POST --body '{"planId":"basic"}' --cookie "token=..."
//
// Options: --url (required)  --path /  --method GET  --connections 10  --duration 10 (seconds)  --warmup 2 (seconds)
//          --cookie "name=value"  --header "Name: value" (repeatable)  --body '<json>'
//
// Closed loop: each connection sends its next request as soon as the previous one finishes, so the numbers show
// what the server sustains at that concurrency. Keep --connections small on rate-limited routes (they return 429).
import { performance } from "node:perf_hooks"
import { parseArgs } from "node:util"

const { values: o } = parseArgs({
  options: {
    url: { type: "string" }, path: { type: "string", default: "/" }, method: { type: "string", default: "GET" },
    connections: { type: "string", default: "10" }, duration: { type: "string", default: "10" }, warmup: { type: "string", default: "2" },
    cookie: { type: "string" }, header: { type: "string", multiple: true, default: [] }, body: { type: "string" },
  },
})
if (!o.url) { console.error("--url is required, e.g. --url http://localhost:5000"); process.exit(2) }

const headers = {}
for (const h of o.header) { const i = h.indexOf(":"); if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim() }
if (o.cookie) headers.cookie = o.cookie
if (o.body) headers["content-type"] ??= "application/json"
const target = new URL(o.path, o.url).href
const conns = Math.max(1, Number(o.connections)), seconds = Number(o.duration), warm = Number(o.warmup)

const latencies = [], statuses = new Map()
let errors = 0, measuring = false

async function worker(stopAt) {
  while (performance.now() < stopAt) {
    const t0 = performance.now()
    try {
      const res = await fetch(target, { method: o.method, headers, body: o.body })
      await res.arrayBuffer()                       // read the whole body, like a real client
      if (measuring) { latencies.push(performance.now() - t0); statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1) }
    } catch { if (measuring) errors++ }
  }
}

console.log(`${o.method} ${target}  connections=${conns}  warm-up=${warm}s  measure=${seconds}s`)
const start = performance.now()
const stopAt = start + (warm + seconds) * 1000
setTimeout(() => { measuring = true }, warm * 1000)
await Promise.all(Array.from({ length: conns }, () => worker(stopAt)))

latencies.sort((a, b) => a - b)
const pct = (p) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : NaN
const f = (n) => Number.isNaN(n) ? "n/a" : `${n.toFixed(1)} ms`
console.log(`requests: ${latencies.length}   errors: ${errors}   throughput: ${(latencies.length / seconds).toFixed(0)} req/s`)
console.log(`latency   p50 ${f(pct(0.5))}   p90 ${f(pct(0.9))}   p95 ${f(pct(0.95))}   p99 ${f(pct(0.99))}   max ${f(latencies.at(-1))}`)
console.log("status codes:", Object.fromEntries([...statuses].sort()))
if ([...statuses.keys()].includes(429)) console.log("note: 429 = the rate limiter answered; lower --connections or test a route without a tight limit.")
