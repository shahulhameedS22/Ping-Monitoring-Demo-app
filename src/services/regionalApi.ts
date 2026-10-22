/**
 * Regional Ping API Integration Layer (Future Specification & Client Contract)
 * 
 * IMPORTANT: This module defines the architectural contracts, typed request/response
 * payloads, and validation interfaces for future regional server endpoints.
 * 
 * Target Architecture:
 * - Each region (IN-DC01, IN-DC02, LK-DC01, SG-DC01) hosts an authorized network daemon
 *   or runs behind an internal API Gateway with mutual TLS / JWT authentication.
 * - The gateway executes `ping 8.8.8.8 -n 30` via a restricted sandboxed process runner
 *   with strict input sanitation (preventing arbitrary command injection).
 * - Browser JavaScript NEVER executes shell commands directly.
 */

import { type RegionId, type RegionPingResult, type PingPacket } from '../types/ping';

/**
 * Strict IPv4 format validation
 */
export function isValidIpv4(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip.trim());
}

/**
 * Validates ping count constraint (must be between 1 and 100)
 */
export function isValidPingCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= 100;
}

/**
 * Future API Request Payload
 */
export interface RegionalPingApiRequest {
  regionId: RegionId;
  targetIp: string;       // Validated IPv4 (default 8.8.8.8)
  count: number;          // Default 30 (ping -n 30)
  timeoutMs?: number;     // e.g., 30000ms
  sessionId: string;      // Audit trace ID
}

/**
 * Future API Response Schema (Returned by the regional agent)
 */
export interface RegionalPingApiResponse {
  success: boolean;
  regionId: RegionId;
  targetIp: string;
  requestsSent: number;
  successfulReplies: number;
  failedRequests: number;
  packetLossPercent: number;
  minLatencyMs: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  jitterMs: number | null;
  rawOutputSnippet?: string;
  packets?: Array<{
    sequence: number;
    latencyMs: number | null;
    ttl?: number;
    success: boolean;
  }>;
  executionDurationMs: number;
  timestamp: string;
  serverVersion: string;
  error?: string;
}

/**
 * Regional Endpoint Configuration registry (Configured via secure environment variables)
 */
export interface RegionalEndpointConfig {
  baseUrl: string;
  authToken?: string;
  isEnabled: boolean;
}

export function getRegionalEndpoints(): Record<RegionId, RegionalEndpointConfig> {
  const globalBase = import.meta.env.VITE_REGIONAL_API_BASE_URL || '';
  
  return {
    'IN-DC01': {
      baseUrl: import.meta.env.VITE_IN_DC01_API_URL || (globalBase ? `${globalBase}/in-dc01` : ''),
      isEnabled: Boolean(import.meta.env.VITE_IN_DC01_API_URL || globalBase),
    },
    'IN-DC02': {
      baseUrl: import.meta.env.VITE_IN_DC02_API_URL || (globalBase ? `${globalBase}/in-dc02` : ''),
      isEnabled: Boolean(import.meta.env.VITE_IN_DC02_API_URL || globalBase),
    },
    'LK-DC01': {
      baseUrl: import.meta.env.VITE_LK_DC01_API_URL || (globalBase ? `${globalBase}/lk-dc01` : ''),
      isEnabled: Boolean(import.meta.env.VITE_LK_DC01_API_URL || globalBase),
    },
    'SG-DC01': {
      baseUrl: import.meta.env.VITE_SG_DC01_API_URL || (globalBase ? `${globalBase}/sg-dc01` : ''),
      isEnabled: Boolean(import.meta.env.VITE_SG_DC01_API_URL || globalBase),
    },
  };
}

/**
 * Check if real regional endpoints are configured
 */
export function areRealRegionalApisConfigured(): boolean {
  const endpoints = getRegionalEndpoints();
  return Object.values(endpoints).some(ep => ep.isEnabled && ep.baseUrl.length > 0);
}

/**
 * Future API Call Implementation placeholder.
 * Throws a clear descriptive error if endpoints are not yet deployed.
 */
export async function executeRealRegionalPing(
  req: RegionalPingApiRequest,
  userAuthToken: string
): Promise<RegionPingResult> {
  const endpoints = getRegionalEndpoints();
  const config = endpoints[req.regionId];

  if (!config || !config.baseUrl) {
    throw new Error(
      `Regional API endpoint for ${req.regionId} is not yet provisioned. Switch to DEMO MODE or configure VITE_${req.regionId.replace('-', '_')}_API_URL.`
    );
  }

  // Parameter validation
  if (!isValidIpv4(req.targetIp)) {
    throw new Error(`Invalid target IPv4 address: ${req.targetIp}`);
  }
  if (!isValidPingCount(req.count)) {
    throw new Error(`Ping count must be between 1 and 100, received: ${req.count}`);
  }

  const response = await fetch(`${config.baseUrl}/ping`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userAuthToken}`,
      'X-Session-ID': req.sessionId,
    },
    body: JSON.stringify({
      targetIp: req.targetIp,
      count: req.count,
      timeoutMs: req.timeoutMs || 30000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Regional server [${req.regionId}] HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  const data: RegionalPingApiResponse = await response.json();

  const packets: PingPacket[] = (data.packets || []).map((p, idx) => ({
    sequence: p.sequence ?? idx + 1,
    latencyMs: p.latencyMs,
    ttl: p.ttl,
    success: p.success,
    timestamp: new Date().toISOString(),
  }));

  return {
    regionId: req.regionId,
    regionName: req.regionId,
    targetIp: req.targetIp,
    status: data.packetLossPercent === 0 ? 'Success' : (data.packetLossPercent < 100 ? 'Partial Loss' : 'Failed'),
    requestsSent: data.requestsSent,
    successfulReplies: data.successfulReplies,
    failedRequests: data.failedRequests,
    packetLossPercent: data.packetLossPercent,
    minLatencyMs: data.minLatencyMs,
    avgLatencyMs: data.avgLatencyMs,
    maxLatencyMs: data.maxLatencyMs,
    jitterMs: data.jitterMs,
    durationMs: data.executionDurationMs,
    startedAt: new Date(Date.now() - data.executionDurationMs).toISOString(),
    completedAt: data.timestamp,
    errorDetails: data.error || null,
    packets,
  };
}
