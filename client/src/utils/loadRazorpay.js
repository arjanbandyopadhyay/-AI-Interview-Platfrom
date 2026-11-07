// Razorpay's checkout script is only needed on the Pricing page, so it is loaded on demand
// instead of blocking the first paint of every page through a <script> tag in index.html.
const CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js"
let pending = null

/** Resolves with window.Razorpay once the checkout script is available (loads it at most once). */
export function loadRazorpay() {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(window.Razorpay)
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = CHECKOUT_URL
    script.async = true
    script.onload = () => resolve(window.Razorpay)
    script.onerror = () => {
      pending = null // allow a retry (for example after the network comes back)
      script.remove?.()
      reject(new Error("Could not load the payment window. Check your connection and try again."))
    }
    document.body.appendChild(script)
  })
  return pending
}

/** Test helper: forget the cached promise. */
export const _resetForTests = () => { pending = null }
