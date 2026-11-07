import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { loadRazorpay, _resetForTests } from "../src/utils/loadRazorpay.js"

let scripts
beforeEach(() => {
  _resetForTests(); scripts = []
  globalThis.window = {}
  globalThis.document = {
    createElement: () => ({ remove() { this.removed = true } }),
    body: { appendChild: (s) => scripts.push(s) },
  }
})

test("does nothing when Razorpay is already on the page", async () => {
  window.Razorpay = function Fake() {}
  assert.equal(await loadRazorpay(), window.Razorpay)
  assert.equal(scripts.length, 0)
})

test("injects the checkout script once, even for concurrent callers", async () => {
  const a = loadRazorpay(), b = loadRazorpay()
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].src, "https://checkout.razorpay.com/v1/checkout.js")
  assert.equal(scripts[0].async, true)
  window.Razorpay = function Fake() {}
  scripts[0].onload()
  assert.equal(await a, window.Razorpay); assert.equal(await b, window.Razorpay)
})

test("a failed download rejects with a friendly message and can be retried", async () => {
  const first = loadRazorpay()
  scripts[0].onerror()
  await assert.rejects(first, /payment window/)
  assert.equal(scripts[0].removed, true)
  const second = loadRazorpay()
  assert.equal(scripts.length, 2, "a retry creates a fresh script tag")
  window.Razorpay = function Fake() {}
  scripts[1].onload()
  assert.equal(await second, window.Razorpay)
})
