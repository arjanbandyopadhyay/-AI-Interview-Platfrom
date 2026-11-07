import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { requestTiming } from "../middleware/requestTiming.js";

function fakeRes() {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 200, headersSent: false, headers: {}, written: [] });
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (...args) => { res.written.push(args); res.headersSent = true; };
  return res;
}
function run(mw, req, res) { let called = false; mw(req, res, () => { called = true; }); return called; }
const clock = () => { let t = 100; const now = () => t; now.advance = (ms) => { t += ms; }; return now; };

test("adds a Server-Timing header with the elapsed time and passes the original arguments through", () => {
  const now = clock(), res = fakeRes();
  assert.equal(run(requestTiming({ now, log: () => {} }), { method: "GET", originalUrl: "/x" }, res), true);
  now.advance(42.26);
  res.writeHead(201, { "X-A": "1" });
  assert.equal(res.headers["Server-Timing"], "total;dur=42.3");
  assert.deepEqual(res.written, [[201, { "X-A": "1" }]]);
});

test("does not touch the headers when they were already sent", () => {
  const res = fakeRes(), mw = requestTiming({ now: clock(), log: () => {} });
  run(mw, { method: "GET", originalUrl: "/x" }, res);
  res.headersSent = true;
  res.writeHead(200);
  assert.equal(res.headers["Server-Timing"], undefined);
});

test("logs a request slower than the threshold, without its query string", () => {
  const now = clock(), res = fakeRes(), logs = [];
  run(requestTiming({ slowMs: 1000, now, log: (m) => logs.push(m) }), { method: "POST", originalUrl: "/api/interview/resume?token=SECRET" }, res);
  now.advance(2500); res.statusCode = 200; res.emit("finish");
  assert.deepEqual(logs, ["SLOW POST /api/interview/resume 200 2500ms"]);
});

test("stays quiet for fast requests", () => {
  const now = clock(), res = fakeRes(), logs = [];
  run(requestTiming({ slowMs: 1000, now, log: (m) => logs.push(m) }), { method: "GET", originalUrl: "/health" }, res);
  now.advance(5); res.emit("finish");
  assert.deepEqual(logs, []);
});
