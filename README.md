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

## Project Structure

```
.
├── client/    # React frontend
└── server/    # Express API, MongoDB models, AI and payment logic
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
