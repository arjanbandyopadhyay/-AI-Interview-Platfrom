import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const calls = [];
let reply;
mock.module("axios", { defaultExport: { post: async (...args) => { calls.push(args); return reply(); } } });
const { askAi } = await import("../services/openRouter.services.js");

beforeEach(() => { calls.length = 0; reply = async () => ({ data: { choices: [{ message: { content: "hello" } }] } }); process.env.OPENROUTER_API_KEY = "sk-test"; });
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test("every call has a timeout and a token cap, and sends the API key as a bearer token", async () => {
  assert.equal(await askAi([{ role: "user", content: "hi" }]), "hello");
  const [, body, config] = calls[0];
  assert.equal(config.timeout, 30000);
  assert.equal(body.max_tokens, 1000);
  assert.equal(config.headers.Authorization, "Bearer sk-test");
});

test("an empty or missing message array is rejected before any network call", async () => {
  for (const bad of [[], undefined, null, "text"]) await assert.rejects(quiet(() => askAi(bad)), /OpenRouter API Error/);
  assert.equal(calls.length, 0, "no paid request is made for an empty prompt");
});

test("an empty completion is treated as an error", async () => {
  reply = async () => ({ data: { choices: [{ message: { content: "   " } }] } });
  await assert.rejects(quiet(() => askAi([{ role: "user", content: "hi" }])), /OpenRouter API Error/);
});

test("upstream failures surface a generic error (the API key and response never leak)", async () => {
  reply = async () => { const e = new Error("401"); e.response = { data: { error: "bad key sk-test" } }; throw e; };
  await assert.rejects(quiet(() => askAi([{ role: "user", content: "hi" }])), (err) => err.message === "OpenRouter API Error" && !/sk-test/.test(err.message));
});
