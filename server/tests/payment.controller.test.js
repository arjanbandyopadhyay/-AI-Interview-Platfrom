import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { FakeModel, makeRes } from "./helpers/fakes.js";

process.env.RAZORPAY_KEY_SECRET = "test_secret";
const User = new FakeModel({ defaults: { credits: 100 } });
const Payment = new FakeModel();
const razorpayCalls = [];
const razorpay = {
  orders: {
    create: async (opts) => { razorpayCalls.push(opts); return { id: `order_${razorpayCalls.length}`, amount: opts.amount, currency: "INR" }; },
  },
};
const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../models/users.js"), { defaultExport: User });
mock.module(url("../models/payment.models.js"), { defaultExport: Payment });
mock.module(url("../services/razorpay.service.js"), { defaultExport: razorpay });
const { createOrder, verifyPayment } = await import("../controllers/payment.controller.js");

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", "test_secret").update(`${orderId}|${paymentId}`).digest("hex");
const verifyBody = (orderId, paymentId = "pay_1") => ({
  razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId),
});
let user;
beforeEach(() => {
  User.docs = []; User.seq = 0; Payment.docs = []; Payment.seq = 0; razorpayCalls.length = 0;
  user = User.seed({ name: "U", email: "u@example.com", credits: 100 });
});
async function placeOrder(planId = "pro", userId = user._id) {
  const res = makeRes();
  await createOrder({ userId, body: { planId } }, res);
  return res;
}

test("price tampering: client-sent amount and credits are ignored", async () => {
  const res = makeRes();
  // the attack: pay Rs 1 and ask for 99,999 credits
  await createOrder({ userId: user._id, body: { planId: "pro", amount: 1, credits: 99999 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(razorpayCalls[0].amount, 500 * 100, "Razorpay order is for the real price (in paise)");
  assert.equal(Payment.docs[0].amount, 500);
  assert.equal(Payment.docs[0].credits, 700, "credits come from the plan table");
});

test("unknown, free and missing plans are rejected without creating an order", async () => {
  for (const planId of ["free", "gold", null, 7, "__proto__"]) {
    const res = await placeOrder(planId);
    assert.equal(res.statusCode, 400);
  }
  const noPlan = makeRes();
  await createOrder({ userId: user._id, body: {} }, noPlan);          // planId missing entirely
  assert.equal(noPlan.statusCode, 400);
  assert.equal(razorpayCalls.length, 0);
  assert.equal(Payment.docs.length, 0);
});

test("a verified payment adds the plan's credits once and keeps the order id", async () => {
  const order = (await placeOrder("basic")).body;
  const res = makeRes();
  await verifyPayment({ userId: user._id, body: verifyBody(order.id) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.credits, 100 + 200);
  assert.equal(Payment.docs[0].status, "paid");
  assert.equal(Payment.docs[0].razorpayOrderId, order.id, "order id must not be overwritten");
  assert.equal(Payment.docs[0].razorpayPaymentId, "pay_1");
});

test("verifying the same payment again does not add credits twice", async () => {
  const order = (await placeOrder("pro")).body;
  await verifyPayment({ userId: user._id, body: verifyBody(order.id) }, makeRes());
  const second = makeRes();
  await verifyPayment({ userId: user._id, body: verifyBody(order.id) }, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.message, "Already Processed");
  assert.ok(second.body.user, "returns the user so the client does not lose its session state");
  assert.equal(User.docs[0].credits, 100 + 700);
});

test("race: five parallel verify requests credit the user exactly once", async () => {
  const order = (await placeOrder("pro")).body;
  await Promise.all(Array.from({ length: 5 }, () =>
    verifyPayment({ userId: user._id, body: verifyBody(order.id) }, makeRes())));
  assert.equal(User.docs[0].credits, 100 + 700);
});

test("a bad, tampered or padded signature is rejected and credits nothing", async () => {
  const order = (await placeOrder("pro")).body;
  const good = verifyBody(order.id);
  const bad = [
    { ...good, razorpay_signature: "0".repeat(64) },
    { ...good, razorpay_signature: good.razorpay_signature + "0" },
    { ...good, razorpay_signature: good.razorpay_signature.slice(0, -2) },
    { ...good, razorpay_signature: "not-hex!" },
    { ...good, razorpay_payment_id: "pay_other" },
  ];
  for (const body of bad) {
    const res = makeRes();
    await verifyPayment({ userId: user._id, body }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(User.docs[0].credits, 100);
  assert.equal(Payment.docs[0].status, "created");
});

test("missing or non-string fields are rejected", async () => {
  for (const body of [undefined, {}, { razorpay_order_id: "o" }, { razorpay_order_id: {}, razorpay_payment_id: "p", razorpay_signature: "s" }]) {
    const res = makeRes();
    await verifyPayment({ userId: user._id, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test("a user cannot redeem someone else's order", async () => {
  const other = User.seed({ name: "O", email: "o@example.com", credits: 100 });
  const order = (await placeOrder("pro", other._id)).body;
  const res = makeRes();
  await verifyPayment({ userId: user._id, body: verifyBody(order.id) }, res); // valid signature, wrong user
  assert.equal(res.statusCode, 404);
  assert.equal(User.docs.find((d) => d._id === user._id).credits, 100);
  assert.equal(User.docs.find((d) => d._id === other._id).credits, 100);
  assert.equal(Payment.docs[0].status, "created", "the real owner can still verify later");
});

test("if adding credits fails, the payment is released so a retry works", async () => {
  const order = (await placeOrder("pro")).body;
  User.failNextUpdate = true;
  const first = makeRes();
  await verifyPayment({ userId: user._id, body: verifyBody(order.id) }, first);
  assert.equal(first.statusCode, 500);
  assert.equal(Payment.docs[0].status, "created");
  const retry = makeRes();
  await verifyPayment({ userId: user._id, body: verifyBody(order.id) }, retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(User.docs[0].credits, 100 + 700);
});

test("server errors do not leak internal details", async () => {
  const orig = razorpay.orders.create;
  razorpay.orders.create = async () => { throw new Error("secret key rzp_live_abc invalid"); };
  const res = await placeOrder("pro");
  razorpay.orders.create = orig;
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /rzp_live/);
});
