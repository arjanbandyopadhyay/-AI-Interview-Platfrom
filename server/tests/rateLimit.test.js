import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, normalizeIp, expandIPv6, ipKeyGenerator, userKeyGenerator } from "../middleware/rateLimit.js";
import { makeRes } from "./helpers/fakes.js";

const clock = (start = 1_000_000) => { let t = start; const now = () => t; now.advance = (ms) => { t += ms; }; return now; };
function hit(limiter, req) {
  const res = makeRes(); let passed = false;
  limiter(req, res, () => { passed = true; });
  return { passed, res };
}

test("requests up to the limit pass, the next one gets 429 with Retry-After", () => {
  const now = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, limit: 3, now, message: "Slow down." });
  const req = { ip: "1.2.3.4" };
  for (let i = 0; i < 3; i++) assert.equal(hit(limiter, req).passed, true);
  const blocked = hit(limiter, req);
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.headers["Retry-After"], "60");
  assert.match(blocked.res.body.message, /Slow down\. Please try again in 60 seconds\./);
  assert.equal(blocked.res.body.retryAfter, 60);
  limiter.reset();
});

test("rate-limit headers report the remaining budget", () => {
  const now = clock();
  const limiter = createRateLimiter({ windowMs: 10_000, limit: 5, now });
  const a = hit(limiter, { ip: "9.9.9.9" }); now.advance(4_000);
  const b = hit(limiter, { ip: "9.9.9.9" });
  assert.equal(a.res.headers["RateLimit-Limit"], "5");
  assert.equal(a.res.headers["RateLimit-Remaining"], "4");
  assert.equal(b.res.headers["RateLimit-Remaining"], "3");
  assert.equal(b.res.headers["RateLimit-Reset"], "6");
  limiter.reset();
});

test("the budget resets when the window ends", () => {
  const now = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, limit: 1, now });
  const req = { ip: "5.5.5.5" };
  assert.equal(hit(limiter, req).passed, true);
  assert.equal(hit(limiter, req).passed, false);
  now.advance(59_999); assert.equal(hit(limiter, req).passed, false);
  now.advance(1);      assert.equal(hit(limiter, req).passed, true);
  limiter.reset();
});

test("different clients and different users have separate budgets", () => {
  const byIp = createRateLimiter({ windowMs: 60_000, limit: 1 });
  assert.equal(hit(byIp, { ip: "1.1.1.1" }).passed, true);
  assert.equal(hit(byIp, { ip: "2.2.2.2" }).passed, true);
  assert.equal(hit(byIp, { ip: "1.1.1.1" }).passed, false);
  const byUser = createRateLimiter({ windowMs: 60_000, limit: 1, keyGenerator: userKeyGenerator });
  assert.equal(hit(byUser, { ip: "1.1.1.1", userId: "alice" }).passed, true);
  assert.equal(hit(byUser, { ip: "1.1.1.1", userId: "bob" }).passed, true, "same IP, other user: own budget");
  assert.equal(hit(byUser, { ip: "7.7.7.7", userId: "alice" }).passed, false, "same user from another IP: same budget");
  byIp.reset(); byUser.reset();
});

test("each limiter instance keeps its own counters", () => {
  const a = createRateLimiter({ windowMs: 60_000, limit: 1 });
  const b = createRateLimiter({ windowMs: 60_000, limit: 1 });
  assert.equal(hit(a, { ip: "1.1.1.1" }).passed, true);
  assert.equal(hit(b, { ip: "1.1.1.1" }).passed, true);
  a.reset(); b.reset();
});

test("userKeyGenerator falls back to the IP when there is no logged-in user", () => {
  assert.equal(userKeyGenerator({ ip: "3.3.3.3" }), "ip:3.3.3.3");
  assert.equal(userKeyGenerator({ ip: "3.3.3.3", userId: "u1" }), "user:u1");
});

test("memory is bounded: with maxKeys=3 the oldest key is evicted", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, limit: 1, maxKeys: 3 });
  for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"]) hit(limiter, { ip });
  assert.equal(limiter.size(), 3);
  assert.equal(hit(limiter, { ip: "1.1.1.1" }).passed, true, "evicted client starts a fresh window (fails open, never crashes)");
  limiter.reset();
});

test("prune() removes expired entries", () => {
  const now = clock();
  const limiter = createRateLimiter({ windowMs: 1_000, limit: 5, now });
  hit(limiter, { ip: "1.1.1.1" }); hit(limiter, { ip: "2.2.2.2" });
  assert.equal(limiter.size(), 2);
  now.advance(1_500); limiter.prune();
  assert.equal(limiter.size(), 0);
});

test("invalid configuration is rejected at start-up", () => {
  assert.throws(() => createRateLimiter({}), /positive/);
  assert.throws(() => createRateLimiter({ windowMs: 0, limit: 5 }), /positive/);
  assert.throws(() => createRateLimiter({ windowMs: 1000, limit: -1 }), /positive/);
});

test("normalizeIp: IPv4 unchanged, IPv4-mapped IPv6 becomes IPv4", () => {
  assert.equal(normalizeIp("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIp("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIp("::FFFF:cb00:7109"), "203.0.113.9");        // hex form of the same address
});

test("normalizeIp: IPv6 addresses of the same /64 share one key, different /64s do not", () => {
  const a = normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
  const b = normalizeIp("2001:DB8:1:2::1");
  const c = normalizeIp("2001:db8:1:3::1");
  assert.equal(a, "2001:db8:1:2::/64");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(normalizeIp("::1"), "0:0:0:0::/64");
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80:0:0:0::/64");
});

test("normalizeIp: missing or unparseable values never throw", () => {
  assert.equal(normalizeIp(undefined), "unknown");
  assert.equal(normalizeIp(""), "unknown");
  assert.equal(normalizeIp("not an ip"), "not an ip");
  assert.equal(expandIPv6("1.2.3.4"), null);
  assert.equal(ipKeyGenerator({}), "ip:unknown");
});

test("an IPv6 client cannot dodge the limit by changing its interface id", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, limit: 1 });
  assert.equal(hit(limiter, { ip: "2001:db8:aaaa:1::1" }).passed, true);
  assert.equal(hit(limiter, { ip: "2001:db8:aaaa:1:ffff::9" }).passed, false);
  limiter.reset();
});
