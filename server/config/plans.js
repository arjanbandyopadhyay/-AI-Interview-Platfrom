// The only source of truth for what a purchase costs and what it gives.
// Prices and credits must never be taken from the client.
export const PLANS = Object.freeze({
    basic: Object.freeze({ name: "Starter Pack", amount: 100, credits: 200 }), // amount in rupees
    pro:   Object.freeze({ name: "Pro Pack",     amount: 500, credits: 700 }),
})

/** The paid plan for an id, or null for unknown ids (including "free", "__proto__", non-strings). */
export const getPaidPlan = (planId) =>
    typeof planId === "string" && Object.hasOwn(PLANS, planId) ? PLANS[planId] : null
