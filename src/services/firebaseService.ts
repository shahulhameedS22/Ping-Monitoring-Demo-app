/**
 * Firebase Firestore Service for Ping Session Persistence (Public Dashboard Mode)
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, handleFirestoreError, OperationType } from '../lib/firebase';
import { type PingSession } from '../types/ping';

const COLLECTION_SESSIONS = 'pingSessions';

/**
 * Saves a completed ping session into Cloud Firestore
 */
export async function savePingSession(session: PingSession): Promise<void> {
  if (!isFirebaseConfigured || !db) {
    console.warn('Firebase is not configured. Session will only be kept in local session memory.');
    return;
  }

  const path = `${COLLECTION_SESSIONS}/${session.id}`;
  try {
    const docRef = doc(db, COLLECTION_SESSIONS, session.id);
    
    // Sanitize payload to match firestore schema
    const payload = {
      id: session.id,
      targetIp: session.targetIp,
      pingCount: session.pingCount,
      status: session.status,
      isSimulated: session.isSimulated,
      startedAt: session.startedAt,
      completedAt: session.completedAt || new Date().toISOString(),
      createdAt: session.createdAt || new Date().toISOString(),
      summary: {
        totalRegions: session.summary.totalRegions,
        successfulRegions: session.summary.successfulRegions,
        partialLossRegions: session.summary.partialLossRegions,
        failedOrUnavailableRegions: session.summary.failedOrUnavailableRegions,
        overallAvgLatencyMs: session.summary.overallAvgLatencyMs,
        minLatencyMs: session.summary.minLatencyMs,
        maxLatencyMs: session.summary.maxLatencyMs,
      },
      regions: session.regions,
    };

    await setDoc(docRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Retrieves recent test history from Cloud Firestore
 */
export async function getRecentPingSessions(
  options?: {
    limitCount?: number;
    statusFilter?: string;
  }
): Promise<PingSession[]> {
  if (!isFirebaseConfigured || !db) {
    return [];
  }

  const maxItems = options?.limitCount ?? 50;
  const path = COLLECTION_SESSIONS;

  try {
    const sessionsRef = collection(db, COLLECTION_SESSIONS);
    const q = query(
      sessionsRef,
      orderBy('startedAt', 'desc'),
      limit(maxItems)
    );

    const snapshot = await getDocs(q);
    const sessions: PingSession[] = [];

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data) {
        sessions.push(data as PingSession);
      }
    });

    if (options?.statusFilter && options.statusFilter !== 'all') {
      return sessions.filter(s => s.status === options.statusFilter);
    }

    return sessions;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}
