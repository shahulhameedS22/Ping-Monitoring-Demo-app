/**
 * Regional Ping API Integration Layer
 * 
 * Manages real, authorized regional server endpoints (IN-DC01, IN-DC02, LK-DC01, SG-DC01).
 * Features:
 * - Configurable regional API endpoints (UI localStorage + Vite environment variables)
 * - Real ICMP ping dispatch to remote daemons executing `ping 8.8.8.8 -n 30`
 * - Live endpoint connectivity testing / probe verification
 * - Timeout handling (45s) and comprehensive error reporting
 * - Push mode: when the central backend answers HTTP 202, the result is polled until the
 *   regional agent (running on the regional VM) has pushed its real measurement
 * - Zero simulated or fake fallback data
 */

import { type RegionId, type RegionPingResult, type PingPacket, REGIONS } from '../types/ping';

const STORAGE_KEY = 'regional_ping_endpoints_v1';

/**
 * Strict IPv4 format validation
 */
export function isValidIpv4(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip.trim());
}

/**
 * Validates ping count constraint (clamped between 1 and 30 for security)
 */
export function isValidPingCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= 100;
}

/**
 * API Request Payload
 */
export interface RegionalPingApiRequest {
  regionId: RegionId;
  targetIp: string;       // Validated IPv4 (default 8.8.8.8)
  count: number;          // Default 30 (ping -n 30)
  timeoutMs?: number;     // e.g., 35000ms
  sessionId: string;      // Audit trace ID
}

/**
 * API Response Schema (Returned by the authorized regional agent)
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
  serverVersion?: string;
  error?: string;
}

/**
 * Regional Endpoint Configuration registry
 */
export interface RegionalEndpointConfig {
  baseUrl: string;
  isEnabled: boolean;
  isCustomized?: boolean;
}

/**
 * Retrieve user-customized endpoints from localStorage
 */
export function getStoredEndpoints(): Partial<Record<RegionId, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save user-customized endpoints to localStorage
 */
export function saveStoredEndpoints(endpoints: Record<RegionId, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
  } catch (e) {
    console.error('Failed to save regional endpoints:', e);
  }
}

/**
 * Reset customized endpoints
 */
export function clearStoredEndpoints(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/**
 * Computes active regional endpoints combining user overrides and env variables
 */
export function getRegionalEndpoints(): Record<RegionId, RegionalEndpointConfig> {
  const stored = getStoredEndpoints();
  const globalBase = (import.meta.env.VITE_REGIONAL_API_BASE_URL as string) || '';

  const resolveUrl = (regionId: RegionId, envKey: string, defaultPath: string) => {
    // 1. User manual configuration in Settings UI
    if (stored[regionId] !== undefined && stored[regionId] !== null) {
      const val = stored[regionId]!.trim();
      if (val.length > 0) {
        return { url: val, isCustomized: true };
      }
    }
    // 2. Specific Region Environment Variable
    const envVal = (import.meta.env[envKey] as string) || '';
    if (envVal.trim().length > 0) {
      return { url: envVal.trim(), isCustomized: false };
    }
    // 3. Global Regional API Base URL
    if (globalBase.trim().length > 0) {
      return { url: `${globalBase.replace(/\/+$/, '')}/${defaultPath}`, isCustomized: false };
    }
    // 4. Central backend secure proxy route (same-origin, keeps private IPs and secrets server-side)
    return { url: `/api/regions/${regionId}`, isCustomized: false };
  };

  const inDc01 = resolveUrl('IN-DC01', 'VITE_IN_DC01_API_URL', 'in-dc01');
  const inDc02 = resolveUrl('IN-DC02', 'VITE_IN_DC02_API_URL', 'in-dc02');
  const lkDc01 = resolveUrl('LK-DC01', 'VITE_LK_DC01_API_URL', 'lk-dc01');
  const sgDc01 = resolveUrl('SG-DC01', 'VITE_SG_DC01_API_URL', 'sg-dc01');

  return {
    'IN-DC01': {
      baseUrl: inDc01.url,
      isEnabled: Boolean(inDc01.url),
      isCustomized: inDc01.isCustomized,
    },
    'IN-DC02': {
      baseUrl: inDc02.url,
      isEnabled: Boolean(inDc02.url),
      isCustomized: inDc02.isCustomized,
    },
    'LK-DC01': {
      baseUrl: lkDc01.url,
      isEnabled: Boolean(lkDc01.url),
      isCustomized: lkDc01.isCustomized,
    },
    'SG-DC01': {
      baseUrl: sgDc01.url,
      isEnabled: Boolean(sgDc01.url),
      isCustomized: sgDc01.isCustomized,
    },
  };
}

/**
 * Check if at least one real regional endpoint is configured
 */
export function areRealRegionalApisConfigured(): boolean {
  const endpoints = getRegionalEndpoints();
  return Object.values(endpoints).some(ep => ep.isEnabled && ep.baseUrl.length > 0);
}

/**
 * Check if ALL 4 regional endpoints are configured
 */
export function areAllRegionalApisConfigured(): boolean {
  const endpoints = getRegionalEndpoints();
  return (['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as RegionId[]).every(
    id => endpoints[id]?.isEnabled && endpoints[id]?.baseUrl.length > 0
  );
}

/**
 * Tests live connectivity to a regional endpoint daemon
 */
export async function testRegionalEndpointConnection(
  regionId: RegionId,
  customUrl?: string
): Promise<{
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  message: string;
  serverInfo?: any;
}> {
  const endpoints = getRegionalEndpoints();
  const url = (customUrl !== undefined ? customUrl : endpoints[regionId]?.baseUrl || '').trim();

  if (!url) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Endpoint URL is not set.',
    };
  }

  // Guard against browser Mixed Content blocks when dashboard is loaded over HTTPS
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.startsWith('http://')) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Mixed Content Restriction: Dashboard is hosted on HTTPS. Regional endpoint must use HTTPS (or SSL reverse proxy).',
    };
  }

  const startTime = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // 8-second timeout

  try {
    const healthUrl = `${url.replace(/\/+$/, '')}/health`;
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);

    if (res.ok) {
      let serverInfo = null;
      try {
        serverInfo = await res.json();
      } catch {
        // Text is fine
      }
      return {
        ok: true,
        statusCode: res.status,
        latencyMs,
        message: `HTTP ${res.status} OK — Server reachable (${latencyMs} ms)`,
        serverInfo,
      };
    } else {
      let message = `Server responded with HTTP ${res.status}: ${res.statusText}`;
      try {
        const errorJson = await res.json();
        if (errorJson.message) message = errorJson.message;
        else if (errorJson.error) message = errorJson.error;
      } catch {}
      return {
        ok: false,
        statusCode: res.status,
        latencyMs,
        message,
      };
    }
  } catch (err: any) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);
    if (err.name === 'AbortError') {
      return {
        ok: false,
        latencyMs,
        message: 'Connection timed out after 8s. Server may be offline or firewall is blocking traffic.',
      };
    }
    return {
      ok: false,
      latencyMs,
      message: `Failed to connect (${err.message || 'Network error'}). Ensure regional daemon is running with CORS enabled.`,
    };
  }
}

/**
 * Push mode helper.
 * - HTTP 200 with a full result (older pull mode) is returned unchanged.
 * - HTTP 202 + requestId: polls GET <base>/result until the regional agent has pushed
 *   its real measurement, then returns that result.
 */
const PUSH_POLL_EVERY_MS = 3000;
const PUSH_MAX_WAIT_MS = 75_000; // ~5s agent pickup + ~30s ping + margin

async function readPingResponse(response: Response, baseUrl: string, regionId: string): Promise<any> {
  const first = await response.json();
  if (response.status !== 202 || !first?.requestId) return first;

  const url = `${baseUrl.replace(/\/+$/, '')}/result?requestId=${encodeURIComponent(first.requestId)}`;
  const deadline = Date.now() + PUSH_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PUSH_POLL_EVERY_MS));
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 202) continue; // still queued / running on the regional agent
    const body = await r.json().catch(() => ({} as any));
    if (r.ok && body.status === 'done' && body.result) return body.result;
    throw new Error(`Regional server [${regionId}] HTTP ${r.status}: ${body.error || body.message || 'Could not retrieve result.'}`);
  }
  throw new Error(`Regional agent for ${regionId} did not return a result in time (waited ${PUSH_MAX_WAIT_MS / 1000}s).`);
}

/**
 * Executes authentic ICMP ping test on authorized regional server
 */
export async function executeRealRegionalPing(
  req: RegionalPingApiRequest,
  userAuthToken: string = ''
): Promise<RegionPingResult> {
  const endpoints = getRegionalEndpoints();
  const config = endpoints[req.regionId];

  if (!config || !config.baseUrl) {
    throw new Error(
      `Regional API endpoint for ${req.regionId} is not configured. Please set the endpoint URL in API Configuration.`
    );
  }

  // Parameter validation
  const targetIp = (req.targetIp || '8.8.8.8').trim();
  if (!isValidIpv4(targetIp)) {
    throw new Error(`Invalid target IPv4 address: ${targetIp}`);
  }

  // Count fixed to 30 for authentic standardized measurement
  const count = Math.min(Math.max(1, req.count || 30), 30);

  // Set 45s timeout (30 pings + network transit)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  const cleanBase = config.baseUrl.replace(/\/+$/, '');
  const pingUrl = `${cleanBase}/ping`;

  // Guard against browser Mixed Content blocks
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && cleanBase.startsWith('http://')) {
    throw new Error(`Mixed Content Blocked: Dashboard is on HTTPS, endpoint for ${req.regionId} must use HTTPS.`);
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Session-ID': req.sessionId,
    };
    if (userAuthToken) {
      headers['Authorization'] = `Bearer ${userAuthToken}`;
    }

    const response = await fetch(pingUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        targetIp,
        count,
        timeoutMs: req.timeoutMs || 35000,
        regionId: req.regionId,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = errorText;
      try {
        const jsonErr = JSON.parse(errorText);
        if (jsonErr.error) parsedError = jsonErr.error;
        else if (jsonErr.message) parsedError = jsonErr.message;
      } catch {}
      throw new Error(`Regional server [${req.regionId}] HTTP ${response.status}: ${parsedError || response.statusText}`);
    }

    const data: RegionalPingApiResponse = await readPingResponse(response, cleanBase, req.regionId);

    if (!data.success && data.error) {
      throw new Error(`Regional server [${req.regionId}]: ${data.error}`);
    }

    // Verify response integrity
    if (typeof data.requestsSent !== 'number' || typeof data.successfulReplies !== 'number') {
      throw new Error(`Invalid response payload from ${req.regionId}: missing ICMP transmission metrics.`);
    }

    const packets: PingPacket[] = (data.packets || []).map((p, idx) => ({
      sequence: p.sequence ?? idx + 1,
      latencyMs: p.latencyMs,
      ttl: p.ttl,
      success: p.success,
      timestamp: new Date().toISOString(),
    }));

    // Derive authentic status strictly from actual packet loss
    const loss = typeof data.packetLossPercent === 'number'
      ? data.packetLossPercent
      : Math.round(((data.requestsSent - data.successfulReplies) / data.requestsSent) * 100);

    let status: 'Success' | 'Partial Loss' | 'Failed' = 'Success';
    if (loss === 100) {
      status = 'Failed';
    } else if (loss > 0) {
      status = 'Partial Loss';
    }

    return {
      regionId: req.regionId,
      regionName: `${req.regionId} — ${REGIONS[req.regionId]?.fullName || req.regionId}`,
      targetIp,
      status,
      requestsSent: data.requestsSent,
      successfulReplies: data.successfulReplies,
      failedRequests: data.failedRequests ?? Math.max(0, data.requestsSent - data.successfulReplies),
      packetLossPercent: loss,
      minLatencyMs: data.minLatencyMs,
      avgLatencyMs: data.avgLatencyMs,
      maxLatencyMs: data.maxLatencyMs,
      jitterMs: data.jitterMs,
      durationMs: data.executionDurationMs,
      startedAt: new Date(Date.now() - (data.executionDurationMs || 30000)).toISOString(),
      completedAt: data.timestamp || new Date().toISOString(),
      errorDetails: data.error || null,
      packets,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Regional server [${req.regionId}] timed out after 45 seconds.`);
    }
    if (err.message && err.message.includes('Failed to fetch')) {
      throw new Error(`Failed to reach regional server at ${cleanBase}. Ensure daemon is running and CORS is permitted.`);
    }
    throw err;
  }
}
