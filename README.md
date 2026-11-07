# AI Interview Platform

A full-stack, AI-powered mock interview platform that helps users practice technical interviews with voice-based questions, per-answer AI evaluation, and a saved history of their performance.

**[Live Demo](https://ai-interview-platfrom-client.onrender.com/)**

> The demo is hosted on a free tier, so the first load after a period of inactivity can take up to a minute while the server wakes up.

<!-- Add a screenshot or GIF of the interview flow here, e.g. ![Interview screen](./screenshots/interview.png) -->

## Features

- **AI evaluation engine:** every answer is scored on confidence, communication and correctness, with written feedback.
- **Defensive LLM parsing:** model responses are validated and parsed defensively, so malformed or unexpected output doesn't break the interview flow.
- **Voice-driven interviews:** questions are narrated by the AI and answers are captured with real-time speech-to-text using the Web Speech API, synced with a video avatar and auto-submit timers.
- **Credit-based payments:** Razorpay integration lets users buy interview credits. Prices and credit amounts are defined on the server, and the HMAC-SHA256 signature is verified before any credits are added.
- **Secure authentication:** Firebase Auth for sign-in. The server verifies the Firebase ID token itself before issuing an httpOnly JWT session cookie, and the API routes are JWT-protected.
- **Interview history:** complete interview sessions are stored in MongoDB so users can review their performance across attempts.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Axios, Web Speech API, PDF.js |
| Backend | Node.js, Express.js, JWT |
| Database | MongoDB |
| Auth | Firebase Auth |
| AI | OpenRouter (LLM API) |
| Payments | Razorpay |

## How It Works

1. The user signs in and starts an interview session.
2. The backend generates questions through the LLM, and the frontend narrates them.
3. The user answers by voice; speech is transcribed in the browser and submitted manually or by the auto-submit timer.
4. The backend sends each answer to the LLM for scoring, validates the response, and stores the result.
5. At the end, the user sees scores and feedback, and the full session is saved to their history.

## Key Design Decisions

- **The server decides prices and credits.** The client only sends a plan id; the amount and credits come from a server-side plan table, and the Razorpay signature is verified before credits are added, so a client can't grant itself credits.
- **Credits are reserved atomically before the paid LLM call** (one conditional update that also checks the balance) and refunded if the call fails, so parallel requests can't overspend a balance.
- **Identity comes from a verified token, not from the request body.** The server checks the Firebase ID token's signature, issuer, audience and expiry before it creates a session.
- **Every interview query includes the owner's user id,** so one user can never read or change another user's interview.
- **LLM output is treated as untrusted.** Responses are parsed and validated before use, with fallbacks for missing or malformed fields; inputs sent to the LLM are length-capped.
- **The paid endpoints are rate limited** per user (and the API per IP), and the app is configured to see the real client IP behind Render's proxy.

## Getting Started

### Prerequisites

- Node.js 18 or later (22.3 or later to run the test suite)
- A MongoDB database (local or MongoDB Atlas)
- API keys for OpenRouter, Razorpay (test mode) and a Firebase project

### Installation

```bash
git clone https://github.com/arjanbandyopadhyay/-AI-Interview-Platfrom.git
cd -AI-Interview-Platfrom
```

Install dependencies for both parts of the app:

```bash
cd server && npm install
cd ../client && npm install
```

### Environment Variables

Create a `.env` file in `server/`:

```env
PORT=5000
MONGODB=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
OPENROUTER_API_KEY=your_openrouter_api_key
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
CLIENT_URL=http://localhost:5173
```

`CLIENT_URL` is the browser origin allowed by CORS (it defaults to the deployed client). Optional: `FIREBASE_PROJECT_ID` (defaults to this app's project) and `TRUST_PROXY` (number of reverse proxies in front of the server, default `1`). A ready-to-copy template is in [`server/.env.example`](server/.env.example).

Create a `.env` file in `client/` (template: [`client/.env.example`](client/.env.example)):

```env
VITE_API_URL=http://localhost:5000
VITE_FIREBASE_APIKEY=your_firebase_web_api_key
VITE_RAZORPAY_KEY_ID=your_razorpay_key_id
```

The other Firebase settings are public values stored in `client/src/utils/firebase.js`.

### Run Locally

```bash
# Terminal 1 - backend
cd server
npm run dev

# Terminal 2 - frontend
cd client
npm run dev
```

The app will be available at `http://localhost:5173`.

## Security

| Protection | Where |
| --- | --- |
| Firebase ID token verified server-side before a session is issued | `server/controllers/auth.controller.js` |
| Server-side plan table; atomic payment verification; payment belongs to the logged-in user | `server/config/plans.js`, `server/controllers/payment.controller.js` |
| Atomic credit reservation with refund on failure | `server/controllers/interview.Controller.js` |
| Ownership check on every interview read/write | `server/controllers/interview.Controller.js` |
| Per-user and per-IP rate limits (HTTP 429 with `Retry-After`) | `server/middleware/rateLimit.js`, `server/middleware/limiters.js` |
| Input length caps, PDF-only uploads (5 MB, 10 pages), LLM timeout and token cap | `server/config/limits.js`, `server/middleware/multer.js`, `server/services/openRouter.services.js` |
| Clean JSON errors (no stack traces or internal messages) | `server/app.js` |

| Route | Limit |
| --- | --- |
| Whole API | 600 requests / 15 min per IP |
| `/api/auth/*` | 30 / 15 min per IP |
| `/api/interview/resume` | 5 / 10 min per user |
| `/api/interview/generate-questions` | 10 / hour per user |
| `/api/interview/submit-answer` | 15 / minute per user |
| `/api/payment/order`, `/api/payment/verify` | 10 / hour per user |

The rate limiter keeps its counters in memory, which is correct for a single server instance; a shared store such as Redis would be needed to run several instances.

## Testing

```bash
cd server
npm test
```

The suite (Node's built-in test runner, no extra dependencies, Node 22.3+) has tests for login, payments, credits, ownership, rate limiting and uploads. Most call the controllers directly against an in-memory fake of the database that behaves like MongoDB's atomic updates; `tests/api.integration.test.js` runs the real Express app over HTTP (real cookies, CORS, rate limiter, Multer and pdf.js) with only the database, Firebase, Razorpay and the LLM faked. The tests cover the specific attacks that were fixed (forged login, price tampering, double credit, reading someone else's interview, racing the credit check).

## Performance

I measured before changing anything, and the results decided what to work on.

**What is *not* the bottleneck**

| Measured | Result |
| --- | --- |
| PDF parsing (pdf.js, 1 / 2 / 5-page resumes) | 20-77 ms each; the event loop stalled at most ~31 ms. Resumes are limited to 5 per 10 minutes per user, so moving it to a worker thread would add complexity for no gain. Left as is. |
| Server overhead per request (real Express app with JWT auth, rate limiter and a fake instant database, load generator on the same single vCPU) | ~0.6 ms p50 for one connection; ~2,000-3,000 requests/s at 20 connections. The Express layer is far faster than anything the database or the LLM allows. |

So end-to-end latency is dominated by things outside the Node code: LLM calls (seconds), the free-hosting cold start, and how much the browser has to download before the page works.

**What changed**

| Change | Effect |
| --- | --- |
| Landing-page images PNG -> WebP, mode icons resized to 2x display size, `loading="lazy"` | **974 KB -> 89 KB (-91 %)**, no visible difference |
| Favicon 612x408 -> 128x128 | **152 KB -> 12.5 KB** (fetched on every page) |
| Interview avatar videos 1280x720 -> 960x540, no unused audio track, `faststart` | **1,124 KB -> 162 KB** (male) and **1,309 KB -> 234 KB** (female); SSIM 0.99. The index is now at the start of the file, so playback begins while the rest downloads (before, the whole file had to arrive first) |
| Razorpay checkout script no longer blocks every page load | Loaded only when the Pricing page opens (it starts downloading on arrival, so Pay still opens instantly). Before, every first paint waited for a third-party script |
| Routes are code-split (`React.lazy`); jsPDF loaded only on "Download PDF"; report charts prefetched during the interview | Smaller first-load JavaScript: a visitor to the landing page no longer downloads recharts, jsPDF, Firebase or the interview UI |
| `preconnect` to the API plus an early `/health` request from `index.html` | The TLS handshake and (on free hosting) the cold-start wake-up overlap with the bundle download |
| MongoDB indexes `{ userId, createdAt }` on interviews and `{ razorpayOrderId }` on payments | History list and payment verification stay fast as the collections grow (no collection scan / in-memory sort) |
| `GET /health`, `Server-Timing` header, `SLOW ...` request log, `LLM call ok in Nms` log | Production latency is now observable instead of guessed |

**Measure it yourself**

- *Bundle size:* run `cd client && npm run build`; Vite prints the size of every chunk. Compare with the build of the commit before these changes.
- *Page load:* Chrome DevTools > Network, tick "Disable cache" and throttle to "Fast 3G", or run a Lighthouse report on the deployed site.
- *Per-request time:* every API response has a `Server-Timing` header (DevTools > Network > Timing). The server logs each LLM call's duration and every request slower than `SLOW_REQUEST_MS`.
- *Throughput and latency under load:* `cd server && npm run loadtest -- --url https://your-api.example.com --path /health --connections 20 --duration 10`. It prints requests/s and p50/p90/p95/p99 latency, and accepts `--cookie`, `--method` and `--body` for authenticated routes. Run it against `/health` for the framework baseline and against a read route to include the database.

**Cold starts.** Free hosting usually spins a service down after about 15 minutes without traffic, and the next request waits for it to start again. The client already wakes the backend while the page loads; to avoid the wait entirely, point a free uptime monitor (UptimeRobot, cron-job.org) at `https://<your-api>/health` every 10 minutes.

## Project Structure

```
.
├── client/    # React frontend (npm test: unit tests for the Razorpay loader)
└── server/    # Express API, MongoDB models, AI and payment logic
    ├── app.js, index.js    # the Express app / the process that starts it
    ├── middleware/         # auth, rate limiting, request timing, uploads
    ├── scripts/loadtest.mjs  # dependency-free load generator (npm run loadtest)
    └── tests/              # npm test
```

## Browser Support

Voice features rely on the Web Speech API, which works best in Chrome and other Chromium-based browsers.

## Roadmap

- Razorpay webhook, so credits are added even if the user closes the tab before the browser calls `/verify`
- Shared rate-limit store (e.g. Redis) before running more than one server instance
- Streaming AI responses for faster feedback
- Role-specific question sets (frontend, backend, DSA)

## Author

**Arjan Bandyopadhyay**
[GitHub](https://github.com/arjanbandyopadhyay) | [LinkedIn](https://www.linkedin.com/in/arjan-bandyopadhyay-627941418/) | [LeetCode](https://leetcode.com/u/Arjan_001/)
