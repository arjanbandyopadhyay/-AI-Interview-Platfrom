import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FakeModel, makeRes, oid } from "./helpers/fakes.js";

const User = new FakeModel({ defaults: { credits: 100 } });
const Interview = new FakeModel({ defaults: { status: "Incompleted", finalScore: 0 } });
let llmCalls = [];
let llmReply = JSON.stringify({ confidence: 7, communication: 8, correctness: 9, finalScore: 8, feedback: "Solid answer overall." });
const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../models/users.js"), { defaultExport: User });
mock.module(url("../models/interview.model.js"), { defaultExport: Interview });
mock.module(url("../services/openRouter.services.js"), {
  namedExports: { askAi: async (messages) => { llmCalls.push(messages); return typeof llmReply === "function" ? llmReply() : llmReply; } },
});
const { submitAnswer, finishInterview, getInterviewReport } = await import("../controllers/interview.Controller.js");

const OWNER = oid(1), STRANGER = oid(2);
const blankQuestion = (q, timeLimit = 60) => ({ question: q, difficulty: "easy", timeLimit, answer: "", feedback: "", score: 0, confidence: 0, communication: 0, correctness: 0 });
let interview;
beforeEach(() => {
  Interview.docs = []; Interview.seq = 0; User.docs = []; llmCalls = [];
  llmReply = JSON.stringify({ confidence: 7, communication: 8, correctness: 9, finalScore: 8, feedback: "Solid answer overall." });
  interview = Interview.seed({ userId: OWNER, role: "Dev", experience: "1y", mode: "Technical",
    questions: [blankQuestion("Q1"), blankQuestion("Q2"), blankQuestion("Q3")] });
});
const submit = async (userId, body) => { const res = makeRes(); await submitAnswer({ userId, body }, res); return res; };
const stored = () => Interview.docs[0];

test("the owner can answer a question and the evaluation is stored", async () => {
  const res = await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "  My answer  ", timeTaken: 20 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.feedback, "Solid answer overall.");
  assert.equal(stored().questions[0].answer, "My answer");
  assert.equal(stored().questions[0].score, 8);
  assert.equal(llmCalls.length, 1);
});

test("IDOR: another user cannot answer, so they cannot spend LLM calls or alter the interview", async () => {
  const res = await submit(STRANGER, { interviewId: interview._id, questionIndex: 0, answer: "hacked", timeTaken: 5 });
  assert.equal(res.statusCode, 404);
  assert.equal(llmCalls.length, 0);
  assert.equal(stored().questions[0].answer, "");
});

test("IDOR: another user cannot finish or read someone else's interview", async () => {
  const fin = makeRes(); await finishInterview({ userId: STRANGER, body: { interviewId: interview._id } }, fin);
  const rep = makeRes(); await getInterviewReport({ userId: STRANGER, params: { id: interview._id } }, rep);
  assert.equal(fin.statusCode, 404); assert.equal(rep.statusCode, 404);
  assert.equal(stored().status, "Incompleted", "must not be marked completed by a stranger");
});

test("the owner can finish and read the report", async () => {
  await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "a", timeTaken: 1 });
  const fin = makeRes(); await finishInterview({ userId: OWNER, body: { interviewId: interview._id } }, fin);
  assert.equal(fin.statusCode, 200);
  assert.equal(fin.body.finalScore, 2.7);               // (8 + 0 + 0) / 3
  assert.equal(stored().status, "completed");
  const rep = makeRes(); await getInterviewReport({ userId: OWNER, params: { id: interview._id } }, rep);
  assert.equal(rep.statusCode, 200);
  assert.equal(rep.body.questionWiseScore[0].answer, "a");
});

test("submitting the same question again returns the stored feedback and makes no new LLM call", async () => {
  const body = { interviewId: interview._id, questionIndex: 1, answer: "first", timeTaken: 10 };
  const a = await submit(OWNER, body);
  llmReply = JSON.stringify({ confidence: 1, communication: 1, correctness: 1, finalScore: 1, feedback: "Different feedback now." });
  const b = await submit(OWNER, { ...body, answer: "a better second try" });
  assert.equal(b.body.feedback, a.body.feedback);
  assert.equal(llmCalls.length, 1);
  assert.equal(stored().questions[1].answer, "first");
});

test("no more answers are accepted after the interview is completed", async () => {
  await finishInterview({ userId: OWNER, body: { interviewId: interview._id } }, makeRes());
  const res = await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "late", timeTaken: 1 });
  assert.equal(res.statusCode, 409);
  assert.equal(llmCalls.length, 0);
});

test("malformed ids and indexes are rejected with 400 (no 500s)", async () => {
  const cases = [
    { interviewId: "not-an-id", questionIndex: 0, answer: "x" },
    { interviewId: { $ne: null }, questionIndex: 0, answer: "x" },          // NoSQL-operator injection attempt
    { interviewId: interview._id, questionIndex: -1, answer: "x" },
    { interviewId: interview._id, questionIndex: 1.5, answer: "x" },
    { interviewId: interview._id, questionIndex: "abc", answer: "x" },
    { interviewId: interview._id, questionIndex: 99, answer: "x" },
    undefined,
  ];
  for (const body of cases) assert.equal((await submit(OWNER, body)).statusCode, 400, JSON.stringify(body));
  assert.equal(llmCalls.length, 0);
});

test("an oversized answer is rejected before any LLM call", async () => {
  const res = await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "x".repeat(3001), timeTaken: 1 });
  assert.equal(res.statusCode, 400);
  assert.equal(llmCalls.length, 0);
});

test("an empty answer or one that exceeds the time limit scores 0 without an LLM call", async () => {
  const empty = await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "   ", timeTaken: 1 });
  const late = await submit(OWNER, { interviewId: interview._id, questionIndex: 1, answer: "text", timeTaken: 999 });
  assert.equal(empty.body.feedback, "You did not submit an answer");
  assert.equal(late.body.feedback, "Time limit exceeded. Answer not evaluated.");
  assert.equal(llmCalls.length, 0);
});

test("a non-string answer (object/array) is treated as no answer, not passed to the LLM", async () => {
  const res = await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: { toString: "x" }, timeTaken: 1 });
  assert.equal(res.body.feedback, "You did not submit an answer");
  assert.equal(llmCalls.length, 0);
});

test("unparseable LLM output gives a generic 500 and stores nothing", async () => {
  llmReply = "Sorry, I cannot help with that <stack trace sk-or-v1-secret>";
  const res = await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "x", timeTaken: 1 });
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /sk-or|Unexpected token|JSON/);
  assert.equal(stored().questions[0].feedback, "", "the question stays answerable so the user can retry");
});

test("scores returned by the LLM are clamped to 0-10", async () => {
  llmReply = JSON.stringify({ confidence: 99, communication: -5, correctness: "abc", finalScore: 1000, feedback: "ok" });
  await submit(OWNER, { interviewId: interview._id, questionIndex: 0, answer: "x", timeTaken: 1 });
  const q = stored().questions[0];
  assert.deepEqual([q.confidence, q.communication, q.correctness, q.score], [10, 0, 0, 10]);
});
