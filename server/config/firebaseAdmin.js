import { initializeApp, getApps, getApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"

// The Firebase project ID is public (it is also in the client's Firebase config).
// verifyIdToken only needs the project ID: it checks the token's signature, issuer,
// audience and expiry against Google's public keys, so no service-account secret is required.
// Read lazily so values from .env are available (dotenv runs after the imports are evaluated).
const projectId = () => process.env.FIREBASE_PROJECT_ID || "interviewiq-f0eb6"

const getAdminApp = () => (getApps().length ? getApp() : initializeApp({ projectId: projectId() }))

/** Returns the decoded claims of a valid Firebase ID token; throws if it is forged, expired or for another project. */
export const verifyFirebaseIdToken = (idToken) => getAuth(getAdminApp()).verifyIdToken(idToken)
