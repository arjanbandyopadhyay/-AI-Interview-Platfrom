


import { initializeApp } from "firebase/app";
import {getAuth, GoogleAuthProvider} from "firebase/auth"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "interviewiq-f0eb6.firebaseapp.com",
  projectId: "interviewiq-f0eb6",
  storageBucket: "interviewiq-f0eb6.firebasestorage.app",
  messagingSenderId: "1057858250306",
  appId: "1:1057858250306:web:1b5250619bafa959b9afdb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth=getAuth(app);
const provider= new GoogleAuthProvider()

export {auth,provider}