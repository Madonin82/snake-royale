import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyC6r7A9Hv72DW2umzxQYWLmlU7m515TQ1U",
  authDomain: "snake-royale-f596d.firebaseapp.com",
  projectId: "snake-royale-f596d",
  storageBucket: "snake-royale-f596d.firebasestorage.app",
  messagingSenderId: "1053251139928",
  appId: "1:1053251139928:web:5e22e37855de47a93e0d2d"
};

// Initialize Firebase SDK
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize anonymous auth session
export async function initAuth(): Promise<string | null> {
  try {
    if (auth.currentUser) return auth.currentUser.uid;
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch (err) {
    console.warn('Firebase anonymous auth warning:', err);
    return null;
  }
}
