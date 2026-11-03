// Static checks of how the limiters are wired. They read the source text because the routes
// need Express to run; they guard the two mistakes that silently disable or break rate limiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const routeLines = (src) => src.split("\n").filter((l) => /Router\.(post|get)\(/.test(l));

test("per-user limiters run after isAuth (they need req.userId) and before file upload", () => {
  const lines = [...routeLines(read("../routes/interview.route.js")), ...routeLines(read("../routes/payment.route.js"))];
  const limited = lines.filter((l) => /Limiter/.test(l));
  assert.ok(limited.length >= 5, "resume, generate, answer, order, verify are limited");
  for (const l of limited) {
    assert.ok(l.indexOf("isAuth") !== -1 && l.indexOf("isAuth") < l.indexOf("Limiter"), `isAuth before limiter: ${l.trim()}`);
    if (l.includes("uploadResume")) assert.ok(l.indexOf("Limiter") < l.indexOf("uploadResume"), "limit before the file is written to disk");
  }
});

test("every paid LLM / payment route has a limiter", () => {
  const src = read("../routes/interview.route.js") + read("../routes/payment.route.js");
  for (const route of ["/resume", "/generate-questions", "/submit-answer", "/order", "/verify"]) {
    const line = routeLines(src).find((l) => l.includes(`"${route}"`) || l.includes(`'${route}'`));
    assert.ok(line && /Limiter/.test(line), `${route} must be rate limited`);
  }
});

test("app: trust proxy is set before the limiters, and the limiter comes after cors()", () => {
  const src = read("../app.js");
  const at = (s) => src.indexOf(s);
  assert.ok(at('app.set("trust proxy"') !== -1 && at('app.set("trust proxy"') < at("app.use(globalLimiter)"));
  assert.ok(at("app.use(cors(") !== -1 && at("app.use(cors(") < at("app.use(globalLimiter)"), "429s must carry CORS headers");
  assert.ok(/app\.use\("\/api\/auth"\s*,authLimiter/.test(src), "auth routes are limited per IP");
});
