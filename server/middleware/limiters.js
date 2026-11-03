import { createRateLimiter, userKeyGenerator } from "./rateLimit.js"

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

// Per client IP. Generous on purpose (many students can share one network); the expensive
// routes below have their own, much tighter per-user limits.
export const globalLimiter = createRateLimiter({ windowMs: 15 * MINUTE, limit: 600, message: "Too many requests." })
export const authLimiter = createRateLimiter({ windowMs: 15 * MINUTE, limit: 30, message: "Too many sign-in attempts." })

// Per logged-in user (these run after isAuth). They protect the paid LLM calls and payments.
export const resumeLimiter = createRateLimiter({ windowMs: 10 * MINUTE, limit: 5, keyGenerator: userKeyGenerator, message: "You are uploading resumes too quickly." })
export const generateLimiter = createRateLimiter({ windowMs: HOUR, limit: 10, keyGenerator: userKeyGenerator, message: "You are starting interviews too quickly." })
export const answerLimiter = createRateLimiter({ windowMs: MINUTE, limit: 15, keyGenerator: userKeyGenerator, message: "You are submitting answers too quickly." })
export const paymentLimiter = createRateLimiter({ windowMs: HOUR, limit: 10, keyGenerator: userKeyGenerator, message: "Too many payment attempts." })
