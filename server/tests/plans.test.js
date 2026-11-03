import { test } from "node:test";
import assert from "node:assert/strict";
import { getPaidPlan, PLANS } from "../config/plans.js";

test("known paid plans resolve to server-defined price and credits", () => {
  assert.deepEqual({ ...getPaidPlan("basic") }, { name: "Starter Pack", amount: 100, credits: 200 });
  assert.deepEqual({ ...getPaidPlan("pro") }, { name: "Pro Pack", amount: 500, credits: 700 });
});

test("free, unknown and non-string ids are not purchasable", () => {
  for (const bad of ["free", "gold", "", "__proto__", "constructor", "toString", undefined, null, 5, {}, ["pro"]]) {
    assert.equal(getPaidPlan(bad), null, `should reject ${String(bad)}`);
  }
});

test("the plan table cannot be modified at runtime", () => {
  assert.throws(() => { "use strict"; PLANS.pro.credits = 999999; }, TypeError);
  assert.throws(() => { "use strict"; PLANS.extra = {}; }, TypeError);
});
