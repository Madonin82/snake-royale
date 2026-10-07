import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyC6r7A9Hv72DW2umzxQYWLmlU7m515TQ1U",
  authDomain: "snake-royale-f596d.firebaseapp.com",
  projectId: "snake-royale-f596d",
  storageBucket: "snake-royale-f596d.firebasestorage.app",
  messagingSenderId: "1053251139928",
  appId: "1:1053251139928:web:5e22e37855de47a93e0d2d",
  databaseURL: "https://snake-royale-f596d-default-rtdb.firebaseio.com/"
};

// Initialize Firebase SDK
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

export const ADMIN_UIDS = ['REPLACE_WITH_JIMMY_GOOGLE_UID'];

function waitForInitialAuthState(): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      () => {
        unsubscribe();
        resolve();
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

let anonymousSignInPromise: Promise<string> | null = null;

function ensureAnonymousUser(): Promise<string> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  if (!anonymousSignInPromise) {
    anonymousSignInPromise = signInAnonymously(auth)
      .then((cred) => cred.user.uid)
      .finally(() => {
        anonymousSignInPromise = null;
      });
  }
  return anonymousSignInPromise;
}

export async function initAuth(): Promise<string> {
  try {
    await waitForInitialAuthState();
    if (auth.currentUser) return auth.currentUser.uid;
    return await ensureAnonymousUser();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Firebase authentication failed: ${message}`);
  }
}

export async function signOutToAnonymous(): Promise<void> {
  await signOut(auth);
  await ensureAnonymousUser();
}
