# AI Interview Platform

A full-stack, AI-powered mock interview platform that helps users practice technical interviews with voice-based questions, per-answer AI evaluation, and a saved history of their performance.

**[Live Demo](https://ai-interview-platfrom-client.onrender.com/)**

> The demo is hosted on a free tier, so the first load after a period of inactivity can take up to a minute while the server wakes up.

<!-- Add a screenshot or GIF of the interview flow here, e.g. ![Interview screen](./screenshots/interview.png) -->

## Features

- **AI evaluation engine:** every answer is scored on confidence, communication and correctness, with written feedback.
- **Defensive LLM parsing:** model responses are validated and parsed defensively, so malformed or unexpected output doesn't break the interview flow.
- **Voice-driven interviews:** questions are narrated by the AI and answers are captured with real-time speech-to-text using the Web Speech API, synced with a video avatar and auto-submit timers.
- **Credit-based payments:** Razorpay integration lets users buy interview credits, with server-side HMAC-SHA256 signature verification before any credits are added.
- **Secure authentication:** Firebase Auth for sign-in and JWT-protected API routes.
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

- **Payment verification happens on the server.** The Razorpay signature is checked with HMAC-SHA256 on the backend before credits are added, so a client can't grant itself credits by faking a success response.
- **LLM output is treated as untrusted.** Responses are parsed and validated before use, with fallbacks for missing or malformed fields.
- **Routes are protected with JWT.** Only authenticated users can start sessions, submit answers, or view history.

## Getting Started

### Prerequisites

- Node.js 18 or later
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
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
OPENROUTER_API_KEY=your_openrouter_api_key
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

Create a `.env` file in `client/`:

```env
VITE_API_URL=http://localhost:5000
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
VITE_RAZORPAY_KEY_ID=your_razorpay_key_id
```

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

## Project Structure

```
.
├── client/    # React frontend
└── server/    # Express API, MongoDB models, AI and payment logic
```

## Browser Support

Voice features rely on the Web Speech API, which works best in Chrome and other Chromium-based browsers.

## Roadmap

- Rate limiting on AI and payment endpoints
- Automated tests for scoring and payment verification
- Streaming AI responses for faster feedback
- Role-specific question sets (frontend, backend, DSA)

## Author

**Arjan Bandyopadhyay**
[GitHub](https://github.com/arjanbandyopadhyay) | [LinkedIn](https://www.linkedin.com/in/arjan-bandyopadhyay-627941418/) | [LeetCode](https://leetcode.com/u/Arjan_001/)
