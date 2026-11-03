import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeModel, makeRes } from "./helpers/fakes.js";

// These tests need the real pdfjs-dist package to be resolvable (it is a dependency; run `npm install`).
let resolvable = true;
try { import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"); } catch { resolvable = false; }
const t = resolvable ? test : test.skip;

let pdfDoc;                       // what the fake pdf.js returns
let pdfError = null;
let llmCalls = 0;
let llmImpl;
const url = (p) => new URL(p, import.meta.url).href;
let analyseResume;
if (resolvable) {
  mock.module(url("../models/users.js"), { defaultExport: new FakeModel() });
  mock.module(url("../models/interview.model.js"), { defaultExport: new FakeModel() });
  mock.module(url("../services/openRouter.services.js"), { namedExports: { askAi: async (m) => { llmCalls++; return llmImpl(m); } } });
  mock.module("pdfjs-dist/legacy/build/pdf.mjs", {
    namedExports: { getDocument: () => ({ promise: pdfError ? Promise.reject(pdfError) : Promise.resolve(pdfDoc) }) },
  });
  ({ analyseResume } = await import("../controllers/interview.Controller.js"));
}

const makePdf = (pages) => ({ numPages: pages.length, getPage: async (n) => ({ getTextContent: async () => ({ items: pages[n - 1].map((str) => ({ str })) }) }) });
let tmp, file;
beforeEach(() => {
  llmCalls = 0; pdfError = null;
  pdfDoc = makePdf([["Asha Rao", "Backend Developer", "Node.js", "Express"]]);
  llmImpl = async () => '```json\n{"role":"Backend Developer","experience":"1 year","projects":["A","B"],"skills":["Node.js"]}\n```';
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "resume-test-"));
  file = path.join(tmp, "r.pdf"); fs.writeFileSync(file, "%PDF-fake");
});
const run = async (req = { file: { path: file } }) => { const res = makeRes(); await analyseResume(req, res); return res; };

t("a valid resume returns sanitised fields and the uploaded file is deleted", async () => {
  const res = await run();
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.role, res.body.experience], ["Backend Developer", "1 year"]);
  assert.deepEqual(res.body.projects, ["A", "B"]);
  assert.equal(res.body.resumeText, "Asha Rao Backend Developer Node.js Express");
  assert.equal(fs.existsSync(file), false);
});

t("LLM output is sanitised: wrong types and huge lists are cleaned", async () => {
  llmImpl = async () => JSON.stringify({ role: { x: 1 }, experience: "y".repeat(500),
    projects: ["ok", 7, null, ...Array(50).fill("p")], skills: "not-a-list" });
  const res = await run();
  assert.equal(res.body.role, "");
  assert.equal(res.body.experience.length, 100);
  assert.equal(res.body.projects.length, 20);
  assert.deepEqual(res.body.skills, []);
});

t("a resume with too many pages is rejected before the LLM and the file is removed", async () => {
  pdfDoc = makePdf(Array.from({ length: 11 }, () => ["page"]));
  const res = await run();
  assert.equal(res.statusCode, 400);
  assert.equal(llmCalls, 0);
  assert.equal(fs.existsSync(file), false);
});

t("a PDF with no extractable text (scanned image) is rejected", async () => {
  pdfDoc = makePdf([["   "], [""]]);
  const res = await run();
  assert.equal(res.statusCode, 400);
  assert.equal(llmCalls, 0);
  assert.equal(fs.existsSync(file), false);
});

t("very long resume text is truncated to 15,000 characters before it is sent to the LLM", async () => {
  pdfDoc = makePdf([["word ".repeat(10_000)]]);
  await run();
  assert.equal(llmCalls, 1);
});

t("a corrupt / non-PDF file gives a clear 400 and the file is removed", async () => {
  pdfError = Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" });
  const res = await run();
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /valid PDF/);
  assert.equal(fs.existsSync(file), false);
});

t("unparseable LLM output gives a generic 500 (no internals) and the file is removed", async () => {
  llmImpl = async () => "I am sorry <secret sk-or-v1-abc>";
  const res = await run();
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /sk-or|JSON|Unexpected/);
  assert.equal(fs.existsSync(file), false);
});

t("a request without a file is a 400", async () => {
  assert.equal((await run({})).statusCode, 400);
});
