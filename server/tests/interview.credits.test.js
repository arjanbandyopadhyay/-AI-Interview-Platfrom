import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FakeModel, makeRes, oid } from "./helpers/fakes.js";

const User = new FakeModel({ defaults: { credits: 100 } });
const Interview = new FakeModel({ defaults: { status: "Incompleted" } });
let llmCalls = [];
const SIX = Array.from({ length: 6 }, (_, i) => `Question number ${i + 1}, explain how you would design and test this feature carefully?`).join("\n");
let llmImpl = async () => SIX;
const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../models/users.js"), { defaultExport: User });
mock.module(url("../models/interview.model.js"), { defaultExport: Interview });
mock.module(url("../services/openRouter.services.js"), {
  namedExports: { askAi: async (messages) => { llmCalls.push(messages); return llmImpl(messages); } },
});
const { generateQuestion } = await import("../controllers/interview.Controller.js");

const goodBody = { role: "Backend Developer", experience: "1 year", mode: "Technical", resumeText: "resume", projects: ["p1"], skills: ["js"] };
let user;
const seedUser = (credits) => { User.docs = []; User.seq = 0; user = User.seed({ name: "Asha", email: "a@example.com", credits }); };
const start = async (body = goodBody, userId = user._id) => { const res = makeRes(); await generateQuestion({ userId, body }, res); return res; };
const credits = () => User.docs[0].credits;

beforeEach(() => {
  Interview.docs = []; Interview.seq = 0; llmCalls = []; llmImpl = async () => SIX;
  seedUser(100);
});

test("a normal request charges 50 credits and returns six questions", async () => {
  const res = await start();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.creditsLeft, 50);
  assert.equal(res.body.userName, "Asha");
  assert.equal(res.body.questions.length, 6);
  assert.equal(credits(), 50);
  assert.equal(Interview.docs.length, 1);
});

test("RACE: 10 parallel requests with exactly 50 credits produce exactly one interview", async () => {
  seedUser(50);
  const results = await Promise.all(Array.from({ length: 10 }, () => start()));
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(results.filter((r) => r.statusCode === 400).length, 9);
  assert.equal(credits(), 0);
  assert.equal(Interview.docs.length, 1);
  assert.equal(llmCalls.length, 1, "the paid LLM is only called for the request that could pay");
});

test("RACE: 120 credits and 5 parallel requests allow exactly two interviews", async () => {
  seedUser(120);
  const results = await Promise.all(Array.from({ length: 5 }, () => start()));
  assert.equal(results.filter((r) => r.statusCode === 200).length, 2);
  assert.equal(credits(), 20);
  assert.equal(Interview.docs.length, 2);
});

test("not enough credits: 400, nothing charged, no LLM call", async () => {
  seedUser(49);
  const res = await start();
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Not enough Credits/);
  assert.equal(credits(), 49);
  assert.equal(llmCalls.length, 0);
});

test("unknown user gets 'User not Found'", async () => {
  const res = await start(goodBody, oid(999));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "User not Found");
});

test("if the LLM call fails the credits are refunded and no interview is stored", async () => {
  llmImpl = async () => { throw new Error("OpenRouter API Error"); };
  const res = await start();
  assert.equal(res.statusCode, 500);
  assert.match(res.body.message, /not charged/);
  assert.equal(credits(), 100);
  assert.equal(Interview.docs.length, 0);
});

test("an empty or blank LLM answer refunds the credits", async () => {
  for (const reply of ["", "   \n  "]) {
    seedUser(100); llmImpl = async () => reply;
    const res = await start();
    assert.equal(res.statusCode, 500);
    assert.equal(credits(), 100);
  }
});

test("if saving the interview fails the credits are refunded", async () => {
  const realCreate = Interview.create.bind(Interview);
  Interview.create = async () => { throw new Error("db down"); };
  const res = await start();
  Interview.create = realCreate;
  assert.equal(res.statusCode, 500);
  assert.equal(credits(), 100);
});

test("a failed refund is logged loudly and the user still gets an error response", async () => {
  llmImpl = async () => { throw new Error("boom"); };
  const realUpdate = User.updateOne.bind(User);
  User.updateOne = async () => { throw new Error("db down during refund"); };
  const logged = [];
  const realError = console.error; console.error = (...a) => logged.push(a.join(" "));
  const res = await start();
  console.error = realError; User.updateOne = realUpdate;
  assert.equal(res.statusCode, 500);
  assert.ok(logged.some((l) => l.includes("REFUND FAILED")), "an operator must be able to find unrefunded charges");
});

test("invalid input is rejected before any charge", async () => {
  const bad = [
    { ...goodBody, role: "" },
    { ...goodBody, experience: undefined },
    { ...goodBody, mode: "Hacker" },
    { ...goodBody, role: "x".repeat(101) },
    { ...goodBody, role: { $gt: "" } },            // non-string
    null,                                           // no body at all
    {},
  ];
  for (const body of bad) assert.equal((await start(body)).statusCode, 400, JSON.stringify(body));
  assert.equal(credits(), 100);
  assert.equal(llmCalls.length, 0);
});

test("resume text, projects and skills are capped before they reach the LLM", async () => {
  const body = { ...goodBody, resumeText: "R".repeat(50_000),
    projects: Array.from({ length: 50 }, (_, i) => `project-${i}-` + "x".repeat(500)), skills: ["ok", 5, null, {}, "  "] };
  const res = await start(body);
  assert.equal(res.statusCode, 200);
  const prompt = llmCalls[0].find((m) => m.role === "user").content;
  assert.ok((prompt.match(/R/g) ?? []).length <= 15_000 + 20, "resume truncated to 15,000 characters");
  assert.ok((prompt.match(/project-/g) ?? []).length <= 20, "at most 20 projects");
  assert.match(prompt, /Skills:ok\b/);
  assert.equal(Interview.docs[0].resumeText.length, 15_000);
});

test("error responses do not leak internal error text", async () => {
  llmImpl = async () => { throw new Error("401 invalid key sk-or-v1-SECRET"); };
  const res = await start();
  assert.doesNotMatch(JSON.stringify(res.body), /sk-or|SECRET|401/);
});
