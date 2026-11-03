import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FakeModel, makeRes } from "./helpers/fakes.js";

const User = new FakeModel({ defaults: { credits: 100 } });
let verifier = async () => { throw new Error("verifier not set for this test"); };

mock.module(new URL("../models/users.js", import.meta.url).href, { defaultExport: User });
mock.module(new URL("../config/Token.js", import.meta.url).href, { defaultExport: async (id) => `jwt:${id}` });
mock.module(new URL("../config/firebaseAdmin.js", import.meta.url).href, {
  namedExports: { verifyFirebaseIdToken: (t) => verifier(t) },
});
const { googleAuth } = await import("../controllers/auth.controller.js");

const TOKEN = "header.payload.signature-of-a-real-firebase-token";
beforeEach(() => { User.docs = []; User.seq = 0; verifier = async () => { throw new Error("verifier not set"); }; });

test("the old attack no longer works: a bare {name, email} body is rejected", async () => {
  User.seed({ name: "Victim", email: "victim@example.com" });
  const res = makeRes();
  await googleAuth({ body: { name: "Victim", email: "victim@example.com" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.cookies, {}, "no session cookie must be issued");
});

test("a forged / expired token is rejected and creates no account", async () => {
  verifier = async () => { throw new Error("Firebase ID token has invalid signature"); };
  const res = makeRes();
  await googleAuth({ body: { idToken: TOKEN } }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.cookies, {});
  assert.equal(User.docs.length, 0);
});

test("identity comes from the verified token, not from the body", async () => {
  const victim = User.seed({ name: "Victim", email: "victim@example.com", credits: 500 });
  verifier = async () => ({ email: "attacker@example.com", name: "Attacker", email_verified: true });
  const res = makeRes();
  // attacker holds a valid token for their own account but claims to be the victim in the body
  await googleAuth({ body: { idToken: TOKEN, email: "victim@example.com", name: "Victim" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email, "attacker@example.com");
  assert.notEqual(res.cookies.token.value, `jwt:${victim._id}`, "must not receive the victim's session");
  assert.equal(User.docs.find((d) => d._id === victim._id).credits, 500, "victim untouched");
});

test("first login creates a user with the default credits; second login reuses it", async () => {
  verifier = async () => ({ email: "new@example.com", name: "New User", email_verified: true });
  const a = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, a);
  const b = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, b);
  assert.equal(User.docs.length, 1);
  assert.equal(a.body.credits, 100);
  assert.equal(a.cookies.token.value, b.cookies.token.value);
});

test("an existing user keeps their credits when logging in", async () => {
  User.seed({ name: "Old", email: "old@example.com", credits: 350 });
  verifier = async () => ({ email: "old@example.com", name: "Old", email_verified: true });
  const res = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, res);
  assert.equal(res.body.credits, 350);
  assert.equal(User.docs.length, 1);
});

test("an unverified email or a token without an email is rejected", async () => {
  verifier = async () => ({ email: "x@example.com", email_verified: false });
  const a = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, a);
  verifier = async () => ({ name: "No Email" });
  const b = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, b);
  assert.equal(a.statusCode, 401); assert.equal(b.statusCode, 401);
  assert.equal(User.docs.length, 0);
});

test("two simultaneous first logins do not crash (duplicate-key race)", async () => {
  verifier = async () => ({ email: "race@example.com", name: "Race", email_verified: true });
  const realCreate = User.create.bind(User);
  let first = true;
  User.create = async (doc) => {
    if (first) { first = false; User.seed(doc); const e = new Error("E11000 duplicate key"); e.code = 11000; throw e; }
    return realCreate(doc);
  };
  const res = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, res);
  User.create = realCreate;
  assert.equal(res.statusCode, 200);
  assert.equal(User.docs.length, 1);
});

test("the session cookie is httpOnly, secure and cross-site capable", async () => {
  verifier = async () => ({ email: "c@example.com", name: "C", email_verified: true });
  const res = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, res);
  const o = res.cookies.token.options;
  assert.equal(o.httpOnly, true); assert.equal(o.secure, true); assert.equal(o.sameSite, "none");
});

test("a missing name falls back to the part of the email before the @", async () => {
  verifier = async () => ({ email: "noname@example.com", email_verified: true });
  const res = makeRes(); await googleAuth({ body: { idToken: TOKEN } }, res);
  assert.equal(res.body.name, "noname");
});
