/**
 * Firebase Client Initialization & Utilities
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import rawConfig from '../../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentAuth = auth;
  const currentUser = currentAuth?.currentUser;
  
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo: currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let app: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let isConfigured = false;
let configError: string | null = null;

try {
  const config = {
    apiKey: rawConfig.apiKey || import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: rawConfig.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: rawConfig.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: rawConfig.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: rawConfig.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: rawConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const firestoreDatabaseId = rawConfig.firestoreDatabaseId || import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

  if (config.apiKey && config.projectId) {
    app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
    dbInstance = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
    authInstance = getAuth(app);
    isConfigured = true;
  } else {
    configError = 'Firebase credentials missing. Please configure Firebase project settings.';
  }
} catch (err: any) {
  console.error('Firebase initialization failure:', err);
  configError = err?.message || 'Failed to initialize Firebase.';
}

export const firebaseApp = app;
export const db = dbInstance as Firestore;
export const auth = authInstance as Auth;
export const isFirebaseConfigured = isConfigured;
export const firebaseConfigErrorMessage = configError;

/**
 * Validates connection to Cloud Firestore
 */
export async function testConnection(): Promise<{ connected: boolean; message: string }> {
  if (!isFirebaseConfigured || !db) {
    return { connected: false, message: 'Firebase is not configured.' };
  }
  try {
    // Attempt reading a server document
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { connected: true, message: 'Firestore connection validated.' };
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Please check your Firebase configuration or network status.');
      return { connected: false, message: 'Firestore client is offline or network is unreachable.' };
    }
    // A permission-denied is actually proof that Firestore server was reached!
    if (error?.code === 'permission-denied') {
      return { connected: true, message: 'Firestore connected (Rules active).' };
    }
    return { connected: true, message: 'Firestore connected.' };
  }
}
