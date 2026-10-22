/**
 * Unified Regional Ping Service Orchestrator
 * 
 * Manages concurrent test dispatch across authorized regional data center APIs.
 * Does NOT generate fake or simulated results.
 */

import {
  type RegionId,
  type RegionPingResult,
  type SessionSummary,
  type PingSession,
  REGIONS,
} from '../types/ping';
import {
  executeRealRegionalPing,
  areRealRegionalApisConfigured,
  isValidIpv4,
  isValidPingCount,
} from './regionalApi';

export interface ExecuteSessionOptions {
  userId?: string;
  userEmail?: string;
  targetIp?: string;
  pingCount?: number;
  onRegionProgress?: (regionId: RegionId, result: RegionPingResult) => void;
  getUserToken?: () => Promise<string | null>;
}

/**
 * Calculates high-level aggregate summary across regional results
 */
export function calculateSessionSummary(
  regions: Record<RegionId, RegionPingResult>
): SessionSummary {
  const list = Object.values(regions);
  const totalRegions = list.length;

  const testedList = list.filter(r => r.status !== 'Not Tested');
  if (testedList.length === 0) {
    return {
      totalRegions: 4,
      successfulRegions: null,
      partialLossRegions: null,
      failedOrUnavailableRegions: null,
      overallAvgLatencyMs: null,
      minLatencyMs: null,
      maxLatencyMs: null,
    };
  }

  const successfulRegions = testedList.filter(r => r.status === 'Success').length;
  const partialLossRegions = testedList.filter(r => r.status === 'Partial Loss').length;
  const failedOrUnavailableRegions = testedList.filter(
    r => r.status === 'Failed' || r.status === 'Unavailable'
  ).length;

  const validAverages = testedList
    .filter(r => r.avgLatencyMs !== null)
    .map(r => r.avgLatencyMs as number);

  const validMins = testedList
    .filter(r => r.minLatencyMs !== null)
    .map(r => r.minLatencyMs as number);

  const validMaxs = testedList
    .filter(r => r.maxLatencyMs !== null)
    .map(r => r.maxLatencyMs as number);

  const overallAvgLatencyMs = validAverages.length > 0
    ? parseFloat((validAverages.reduce((a, b) => a + b, 0) / validAverages.length).toFixed(1))
    : null;

  const minLatencyMs = validMins.length > 0 ? Math.min(...validMins) : null;
  const maxLatencyMs = validMaxs.length > 0 ? Math.max(...validMaxs) : null;

  return {
    totalRegions,
    successfulRegions,
    partialLossRegions,
    failedOrUnavailableRegions,
    overallAvgLatencyMs,
    minLatencyMs,
    maxLatencyMs,
  };
}

/**
 * Generates initial placeholder state for unexecuted regions with dashes/null values
 */
export function createInitialRegionalResults(targetIp: string = '8.8.8.8'): Record<RegionId, RegionPingResult> {
  const ids: RegionId[] = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];
  const res: Partial<Record<RegionId, RegionPingResult>> = {};

  for (const id of ids) {
    res[id] = {
      regionId: id,
      regionName: `${id} — ${REGIONS[id].fullName}`,
      targetIp,
      status: 'Not Tested',
      requestsSent: null,
      successfulReplies: null,
      failedRequests: null,
      packetLossPercent: null,
      minLatencyMs: null,
      avgLatencyMs: null,
      maxLatencyMs: null,
      jitterMs: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      errorDetails: null,
      packets: [],
    };
  }

  return res as Record<RegionId, RegionPingResult>;
}

/**
 * Executes a full ping test session across all 4 regional DCs concurrently using authorized APIs.
 * Throws a clear descriptive error if regional endpoints are not configured.
 */
export async function executePingSession(
  options: ExecuteSessionOptions
): Promise<PingSession> {
  const targetIp = options.targetIp ?? '8.8.8.8';
  const pingCount = options.pingCount ?? 30;

  if (!isValidIpv4(targetIp)) {
    throw new Error(`Target IP must be a valid IPv4 address. Received: "${targetIp}"`);
  }
  if (!isValidPingCount(pingCount)) {
    throw new Error(`Ping count must be between 1 and 100. Received: ${pingCount}`);
  }

  // Check if real regional APIs are configured
  if (!areRealRegionalApisConfigured()) {
    throw new Error(
      'Regional ping APIs are not configured yet. Connect the authorized regional servers to run real tests.'
    );
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const startedAt = new Date().toISOString();
  const token = options.getUserToken ? await options.getUserToken() : '';
  const regionIds: RegionId[] = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];

  // Mark all regions as Running
  const initialRegions = createInitialRegionalResults(targetIp);
  for (const rid of regionIds) {
    initialRegions[rid].status = 'Running';
    initialRegions[rid].startedAt = startedAt;
    options.onRegionProgress?.(rid, initialRegions[rid]);
  }

  // Execute concurrently across real regional endpoints with isolated failure handling
  const settled = await Promise.allSettled(
    regionIds.map(rid =>
      executeRealRegionalPing(
        {
          regionId: rid,
          targetIp,
          count: pingCount,
          sessionId,
        },
        token || ''
      )
    )
  );

  const finalRegions = createInitialRegionalResults(targetIp);
  settled.forEach((res, index) => {
    const rid = regionIds[index];
    if (res.status === 'fulfilled') {
      finalRegions[rid] = res.value;
    } else {
      finalRegions[rid] = {
        regionId: rid,
        regionName: `${rid} — ${REGIONS[rid].fullName}`,
        targetIp,
        status: 'Failed',
        requestsSent: pingCount,
        successfulReplies: 0,
        failedRequests: pingCount,
        packetLossPercent: 100,
        minLatencyMs: null,
        avgLatencyMs: null,
        maxLatencyMs: null,
        jitterMs: null,
        durationMs: null,
        startedAt,
        completedAt: new Date().toISOString(),
        errorDetails: res.reason?.message || 'Regional endpoint connection failure',
        packets: [],
      };
    }
    options.onRegionProgress?.(rid, finalRegions[rid]);
  });

  const completedAt = new Date().toISOString();
  const summary = calculateSessionSummary(finalRegions);

  let sessionStatus: 'success' | 'partial_loss' | 'failed' = 'success';
  if ((summary.failedOrUnavailableRegions ?? 0) > 0 && (summary.successfulRegions ?? 0) === 0) {
    sessionStatus = 'failed';
  } else if ((summary.partialLossRegions ?? 0) > 0 || (summary.failedOrUnavailableRegions ?? 0) > 0) {
    sessionStatus = 'partial_loss';
  }

  return {
    id: sessionId,
    userId: options.userId,
    userEmail: options.userEmail,
    targetIp,
    pingCount,
    status: sessionStatus,
    isSimulated: false,
    startedAt,
    completedAt,
    summary,
    regions: finalRegions,
  };
}
