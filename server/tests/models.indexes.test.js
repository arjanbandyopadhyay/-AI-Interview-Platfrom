// Guards the indexes that the hot queries depend on. Uses the real Mongoose schemas (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import Interview from "../models/interview.model.js";
import Payment from "../models/payment.models.js";
import User from "../models/users.js";

const keys = (Model) => Model.schema.indexes().map(([fields]) => JSON.stringify(fields));

test("Interview: { userId, createdAt desc } backs the 'my interviews' list", () => {
  assert.ok(keys(Interview).includes(JSON.stringify({ userId: 1, createdAt: -1 })));
});

test("Payment: razorpayOrderId is indexed for payment verification", () => {
  assert.ok(keys(Payment).includes(JSON.stringify({ razorpayOrderId: 1 })));
});

test("User: email stays unique (login looks users up by email)", () => {
  const unique = User.schema.indexes().find(([fields]) => fields.email === 1);
  assert.ok(unique && unique[1].unique === true);
});

test("the controller queries that these indexes serve are still written the way the indexes expect", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../controllers/interview.Controller.js", import.meta.url), "utf8");
  assert.match(src, /Interview\.find\(\{ *userId[^)]*\}\)\s*\.sort\(\{ *createdAt: *-1 *\}\)/);
  const pay = fs.readFileSync(new URL("../controllers/payment.controller.js", import.meta.url), "utf8");
  assert.match(pay, /razorpayOrderId: ?razorpay_order_id/);
});
