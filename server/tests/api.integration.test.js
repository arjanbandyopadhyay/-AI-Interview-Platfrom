// End-to-end tests over real HTTP: real Express app, real routes and middleware (cookie auth, CORS,
// rate limiting, Multer uploads, pdf.js). Only the database, Firebase, Razorpay and the LLM are faked.
import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import { FakeModel, oid } from "./helpers/fakes.js";

process.env.JWT_SECRET = "integration-secret";
process.env.RAZORPAY_KEY_SECRET = "test_secret";
process.env.CLIENT_URL = "https://client.example";
delete process.env.TRUST_PROXY;                       // use the default: one trusted proxy

const User = new FakeModel({ defaults: { credits: 100 } });
const Interview = new FakeModel({ defaults: { status: "Incompleted", finalScore: 0 } });
const Payment = new FakeModel();
const claimsByToken = {};
let llmImpl;
const razorpayCalls = [];
const razorpay = { orders: { create: async (o) => { razorpayCalls.push(o); return { id: `order_${razorpayCalls.length}`, amount: o.amount, currency: "INR" }; } } };
const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../models/users.js"), { defaultExport: User });
mock.module(url("../models/interview.model.js"), { defaultExport: Interview });
mock.module(url("../models/payment.models.js"), { defaultExport: Payment });
mock.module(url("../config/firebaseAdmin.js"), {
  namedExports: { verifyFirebaseIdToken: async (t) => { if (!claimsByToken[t]) throw new Error("invalid token"); return claimsByToken[t]; } },
});
mock.module(url("../services/openRouter.services.js"), { namedExports: { askAi: async (m) => llmImpl(m) } });
mock.module(url("../services/razorpay.service.js"), { defaultExport: razorpay });

const limiters = await import("../middleware/limiters.js");
const { default: app } = await import("../app.js");

let server, base;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(() => {
  for (const l of Object.values(limiters)) l.reset();
  User.docs = []; User.seq = 0; Interview.docs = []; Interview.seq = 0; Payment.docs = []; Payment.seq = 0; razorpayCalls.length = 0;
});

async function api(path, { method = "GET", body, cookie, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload = raw;
  if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
}
async function login(email, name = "Test User") {
  claimsByToken[`tok-${email}`] = { email, name, email_verified: true };
  const res = await api("/api/auth/google", { method: "POST", body: { idToken: `tok-${email}` } });
  assert.equal(res.status, 200, "login should succeed");
  const cookie = res.headers.getSetCookie()[0].split(";")[0];
  return { cookie, user: res.json };
}
const SIX = Array.from({ length: 6 }, (_, i) => `Question ${i + 1}: how would you design and test this carefully?`).join("\n");
const EVAL = JSON.stringify({ confidence: 7, communication: 8, correctness: 9, finalScore: 8, feedback: "Solid answer." });
const questionsThenEvals = () => { let n = 0; return async () => (n++ === 0 ? SIX : EVAL); };
async function startInterview(cookie) {
  llmImpl = questionsThenEvals();
  return api("/api/interview/generate-questions", { method: "POST", cookie, body: { role: "Dev", experience: "1y", mode: "Technical" } });
}

test("full journey: login, interview, answer, finish, report", async () => {
  const { cookie } = await login("asha@example.com");
  const me = await api("/api/user/current-user", { cookie });
  assert.equal(me.json.email, "asha@example.com");
  const gen = await startInterview(cookie);
  assert.equal(gen.status, 200);
  assert.equal(gen.json.creditsLeft, 50);
  const id = gen.json.interviewId;
  const ans = await api("/api/interview/submit-answer", { method: "POST", cookie, body: { interviewId: id, questionIndex: 0, answer: "my answer", timeTaken: 10 } });
  assert.equal(ans.json.feedback, "Solid answer.");
  const fin = await api("/api/interview/finish", { method: "POST", cookie, body: { interviewId: id } });
  assert.equal(fin.status, 200);
  const rep = await api(`/api/interview/report/${id}`, { cookie });
  assert.equal(rep.status, 200);
  assert.equal(rep.json.questionWiseScore[0].answer, "my answer");
});

test("every protected route needs a valid session cookie", async () => {
  const forged = "token=" + jwt.sign({ userId: oid(1) }, "wrong-secret");
  const calls = [
    ["GET", "/api/user/current-user"], ["POST", "/api/interview/resume"], ["POST", "/api/interview/generate-questions"],
    ["POST", "/api/interview/submit-answer"], ["POST", "/api/interview/finish"], ["GET", `/api/interview/report/${oid(1)}`],
    ["POST", "/api/payment/order"], ["POST", "/api/payment/verify"],
  ];
  for (const [method, path] of calls) {
    const body = method === "GET" ? undefined : {};
    assert.equal((await api(path, { method, body })).status, 401, `${method} ${path} without cookie`);
    assert.equal((await api(path, { method, body, cookie: forged })).status, 401, `${method} ${path} with forged cookie`);
  }
});

test("the old login attack fails over HTTP: no token, no session", async () => {
  User.seed({ name: "Victim", email: "victim@example.com" });
  const res = await api("/api/auth/google", { method: "POST", body: { name: "Victim", email: "victim@example.com" } });
  assert.equal(res.status, 400);
  assert.equal(res.headers.getSetCookie().length, 0);
});

test("a stranger cannot read, answer or finish another user's interview", async () => {
  const owner = await login("owner@example.com"); const stranger = await login("stranger@example.com");
  const id = (await startInterview(owner.cookie)).json.interviewId;
  const calls = [
    api(`/api/interview/report/${id}`, { cookie: stranger.cookie }),
    api("/api/interview/submit-answer", { method: "POST", cookie: stranger.cookie, body: { interviewId: id, questionIndex: 0, answer: "x", timeTaken: 1 } }),
    api("/api/interview/finish", { method: "POST", cookie: stranger.cookie, body: { interviewId: id } }),
  ];
  for (const r of await Promise.all(calls)) assert.equal(r.status, 404);
});

test("price tampering over HTTP: the real price and credits are used", async () => {
  const { cookie } = await login("buyer@example.com");
  const res = await api("/api/payment/order", { method: "POST", cookie, body: { planId: "pro", amount: 1, credits: 99999 } });
  assert.equal(res.status, 200);
  assert.equal(razorpayCalls[0].amount, 50000);
  assert.equal(Payment.docs[0].credits, 700);
  assert.equal((await api("/api/payment/order", { method: "POST", cookie, body: { planId: "free" } })).status, 400);
});

test("rate limit: the 16th answer in a minute gets 429 JSON with Retry-After, and CORS headers", async () => {
  const { cookie } = await login("fast@example.com");
  const bad = { interviewId: oid(5), questionIndex: 0, answer: "x" };
  let last;
  for (let i = 1; i <= 16; i++) {
    last = await api("/api/interview/submit-answer", { method: "POST", cookie, body: bad, headers: { origin: "https://client.example" } });
    if (i <= 15) assert.equal(last.status, 404, `request ${i} should reach the controller`);
  }
  assert.equal(last.status, 429);
  assert.match(last.json.message, /too quickly/);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
  assert.equal(last.headers.get("ratelimit-remaining"), "0");
  assert.equal(last.headers.get("access-control-allow-origin"), "https://client.example", "the browser must be able to read the 429");
});

test("per-user limits are isolated: another user on the same IP is unaffected", async () => {
  const a = await login("a@example.com"); const b = await login("b@example.com");
  const body = { interviewId: oid(5), questionIndex: 0, answer: "x" };
  for (let i = 0; i < 16; i++) await api("/api/interview/submit-answer", { method: "POST", cookie: a.cookie, body });
  assert.equal((await api("/api/interview/submit-answer", { method: "POST", cookie: a.cookie, body })).status, 429);
  assert.equal((await api("/api/interview/submit-answer", { method: "POST", cookie: b.cookie, body })).status, 404);
});

test("behind a proxy clients are told apart by X-Forwarded-For, and a spoofed prefix does not help", async () => {
  const hit = (xff) => api("/api/auth/google", { method: "POST", body: {}, headers: { "x-forwarded-for": xff } });
  for (let i = 0; i < 30; i++) assert.equal((await hit("1.1.1.1")).status, 400);
  assert.equal((await hit("1.1.1.1")).status, 429, "31st request from the same client is limited");
  assert.equal((await hit("2.2.2.2")).status, 400, "a different client is not");
  assert.equal((await hit("9.9.9.9, 1.1.1.1")).status, 429, "forging extra addresses in front must not create a new bucket");
});

test("oversized and malformed JSON get clean JSON errors without stack traces", async () => {
  const { cookie } = await login("j@example.com");
  const big = await api("/api/payment/order", { method: "POST", cookie, body: { planId: "pro", pad: "x".repeat(150_000) } });
  assert.equal(big.status, 413); assert.ok(big.json?.message);
  const bad = await api("/api/payment/order", { method: "POST", cookie, headers: { "content-type": "application/json" }, raw: "{not json" });
  assert.equal(bad.status, 400); assert.ok(bad.json?.message);
  for (const r of [big, bad]) assert.doesNotMatch(r.text, /node_modules|at .*\(|SyntaxError/);
});

test("unknown routes return JSON 404", async () => {
  const r = await api("/api/nope"); assert.equal(r.status, 404); assert.equal(r.json.message, "Not found");
});

test("CORS: the configured origin is allowed with credentials; other sites are never echoed back", async () => {
  const ok = await api("/api/user/current-user", { headers: { origin: "https://client.example" } });
  const evil = await api("/api/user/current-user", { headers: { origin: "https://evil.example" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://client.example");
  assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
  // the header always names the configured origin, so a browser on evil.example cannot read the response
  assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example");
  assert.notEqual(evil.headers.get("access-control-allow-origin"), "*");
});

test("interview history lists only the caller's own interviews", async () => {
  const a = await login("hist-a@example.com"); const b = await login("hist-b@example.com");
  await startInterview(a.cookie); await startInterview(b.cookie); await startInterview(b.cookie);
  const mine = await api("/api/interview/get-interview", { cookie: a.cookie });
  const theirs = await api("/api/interview/get-interview", { cookie: b.cookie });
  assert.equal(mine.json.length, 1);
  assert.equal(theirs.json.length, 2);
});

// ---------- resume upload (real Multer + real pdf.js) ----------
function makePdf(text) {
  const stream = `BT /F1 14 Tf 20 100 Td (${text}) Tj ET`;
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  let out = "%PDF-1.4\n"; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
const upload = (cookie, bytes, { name = "resume.pdf", type = "application/pdf", field = "resume" } = {}) => {
  const fd = new FormData(); fd.append(field, new Blob([bytes], { type }), name);
  return api("/api/interview/resume", { method: "POST", cookie, raw: fd });
};
const filesInPublic = () => fs.readdirSync("public").filter((f) => f !== ".gitkeep").length;

test("upload: a real PDF is parsed, analysed and the temp file is removed", async () => {
  const { cookie } = await login("u@example.com");
  llmImpl = async () => '{"role":"Backend Developer","experience":"1 year","projects":["Redis clone"],"skills":["C++","Node.js"]}';
  const before = filesInPublic();
  const res = await upload(cookie, makePdf("Asha Rao Backend Developer C++ Node.js"));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.role, "Backend Developer");
  assert.deepEqual(res.json.skills, ["C++", "Node.js"]);
  assert.match(res.json.resumeText, /Asha Rao Backend Developer/);
  assert.equal(filesInPublic(), before, "uploaded file must be deleted");
});

test("upload: non-PDF files are rejected with a JSON 400 and never written to disk", async () => {
  const { cookie } = await login("u2@example.com");
  const before = filesInPublic();
  const exe = await upload(cookie, Buffer.from("MZ..."), { name: "evil.exe", type: "application/octet-stream" });
  const fake = await upload(cookie, Buffer.from("hello"), { name: "notes.txt", type: "application/pdf" });
  for (const r of [exe, fake]) { assert.equal(r.status, 400); assert.match(r.json.message, /PDF/); }
  assert.equal(filesInPublic(), before);
});

test("upload: files over 5 MB are rejected with a JSON 400", async () => {
  const { cookie } = await login("u3@example.com");
  const before = filesInPublic();
  const res = await upload(cookie, Buffer.alloc(5 * 1024 * 1024 + 10, 0x20));
  assert.equal(res.status, 400); assert.match(res.json.message, /5 MB/);
  assert.equal(filesInPublic(), before);
});

test("upload: a corrupt PDF gives a clear 400 and leaves no file behind", async () => {
  const { cookie } = await login("u4@example.com");
  const before = filesInPublic();
  const res = await upload(cookie, Buffer.from("%PDF-1.4 this is not really a pdf"));
  assert.equal(res.status, 400); assert.match(res.json.message, /valid PDF/);
  assert.equal(filesInPublic(), before);
});

test("upload: the limiter runs before the file is stored (6th upload in 10 minutes is refused)", async () => {
  const { cookie } = await login("u5@example.com");
  const before = filesInPublic();
  for (let i = 0; i < 5; i++) assert.equal((await upload(cookie, Buffer.from("x"), { name: "a.txt", type: "text/plain" })).status, 400);
  const sixth = await upload(cookie, makePdf("Late upload"));
  assert.equal(sixth.status, 429);
  assert.equal(filesInPublic(), before);
});
