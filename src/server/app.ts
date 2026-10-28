/**
 * Regional Ping Monitor - Central Express Application
 * 
 * Shared Express configuration and route handlers used by:
 * 1. api/index.ts (Vercel Serverless Function entrypoint)
 * 2. server.ts (Local Vite dev server & Cloud Run container entrypoint)
 * 
 * API Routes:
 * - GET  /api/health
 * - GET  /api/regions
 * - GET  /api/regions/:regionId/health
 * - POST /api/regions/:regionId/ping
 * - GET  /api/regions/:regionId/result      (push mode: poll for the agent's result)
 * - GET  /api/agent/poll                    (push mode: called by regional agents)
 * - POST /api/agent/ingest                  (push mode: called by regional agents)
 * 
 * Security & Network Hardening:
 * 1. Strict validation: Allowed regions (IN-DC01, IN-DC02, LK-DC01, SG-DC01).
 * 2. Fixed target enforcement: Strictly 8.8.8.8. Rejects arbitrary target IPs.
 * 3. Bounded count & timeouts: Clamped count (1..30) and timeouts (45s max).
 * 4. Zero credential leakage: Private endpoint URLs and secret keys stay on the server.
 * 5. Safe error handling: Sanitized network error messages without stack traces.
 * 6. Hardened Auth: Timing-safe token comparison against CENTRAL_API_KEY in production.
 * 7. Private VM isolation: Never assumes 10.202.202.61 is directly reachable from Vercel.
 * 8. Push mode: regional agents make OUTBOUND-ONLY HTTPS calls; nothing connects into the VMs.
 */

import express, { type Request, type Response, type NextFunction, type Application } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Constants & Types
export const ALLOWED_REGIONS = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as const;
export type RegionId = typeof ALLOWED_REGIONS[number];

export const FIXED_TARGET_IP = '8.8.8.8';
export const DEFAULT_PING_COUNT = 30;
export const MIN_PING_COUNT = 1;
export const MAX_PING_COUNT = 30;
export const HEALTH_TIMEOUT_MS = 6000;
export const PING_TIMEOUT_MS = 45000;

/**
 * Resolves regional agent URL from server-side environment variables.
 * Note: Under Vercel serverless deployment, the private IP (10.202.202.61) is NOT
 * configured as reachable directly. Only configured environment variables are used.
 * Regions without an explicit environment variable remain unconfigured (returning null).
 */
export function getRegionalEndpointUrl(regionId: RegionId): string | null {
  switch (regionId) {
    case 'IN-DC02':
      // Only set if explicitly provided via environment variable
      return process.env.REGIONAL_IN_DC02_URL?.trim() || null;
    case 'IN-DC01':
      return process.env.REGIONAL_IN_DC01_URL?.trim() || null;
    case 'LK-DC01':
      return process.env.REGIONAL_LK_DC01_URL?.trim() || null;
    case 'SG-DC01':
      return process.env.REGIONAL_SG_DC01_URL?.trim() || null;
    default:
      return null;
  }
}

/**
 * Sanitizes and formats network error messages safely without exposing internal stacks or raw paths.
 */
export function formatNetworkError(err: any): string {
  if (!err) return 'Network failure';
  if (err.name === 'AbortError') return 'Connection timed out';
  if (err.code === 'ECONNREFUSED') return 'Connection refused (agent service not listening or port 8080 blocked)';
  if (err.code === 'ENETUNREACH') return 'Network unreachable (no route to private IP)';
  if (err.code === 'EHOSTUNREACH') return 'Host unreachable (target VM offline or subnet not routed)';
  if (err.code === 'ETIMEDOUT') return 'Network connection timed out';
  return err.message || 'Unknown network error';
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

declare global {
  namespace Express {
    interface Request {
      isApiKeyAuthenticated?: boolean;
    }
  }
}

/**
 * Safely extracts client IP address across reverse proxies (e.g. Vercel, Cloud Run).
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown-client';
}

/**
 * Validates public browser request origin / Sec-Fetch metadata to protect against
 * cross-site execution abuse and ping amplification from third-party sites.
 */
function validatePublicRequestOrigin(req: Request): { allowed: boolean; reason?: string } {
  // 1. Check Sec-Fetch-Site (modern browsers include this header)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && secFetchSite === 'cross-site') {
    return {
      allowed: false,
      reason: 'Cross-site request rejected: Ping test execution is restricted to the Regional Ping Monitor dashboard.',
    };
  }

  // 2. Validate Origin if present
  const origin = req.headers['origin'];
  const host = req.headers['host'];
  if (typeof origin === 'string' && host) {
    try {
      const originHost = new URL(origin).host;
      const isSameHost = originHost === host;
      const isAllowedHost = isSameHost ||
        originHost.endsWith('.vercel.app') ||
        originHost.includes('localhost') ||
        originHost.includes('127.0.0.1');

      if (!isAllowedHost) {
        return {
          allowed: false,
          reason: `Untrusted origin "${originHost}". Cross-origin ping execution is restricted.`,
        };
      }
    } catch {
      return { allowed: false, reason: 'Malformed Origin header.' };
    }
  }

  return { allowed: true };
}

/**
 * In-memory sliding-window rate limit structures.
 */
interface PingRateLimitRecord {
  timestamps: number[];
  inFlight: number;
}

const pingRateLimitStore = new Map<string, PingRateLimitRecord>();
const healthRateLimitStore = new Map<string, number[]>();

function pruneStaleRateLimits(): void {
  const now = Date.now();
  // Prune ping records older than 2 minutes
  for (const [ip, rec] of pingRateLimitStore.entries()) {
    rec.timestamps = rec.timestamps.filter(t => now - t < 120_000);
    if (rec.timestamps.length === 0 && rec.inFlight <= 0) {
      pingRateLimitStore.delete(ip);
    }
  }
  // Prune health records older than 1 minute
  for (const [ip, timestamps] of healthRateLimitStore.entries()) {
    const fresh = timestamps.filter(t => now - t < 60_000);
    if (fresh.length === 0) {
      healthRateLimitStore.delete(ip);
    } else {
      healthRateLimitStore.set(ip, fresh);
    }
  }
}

/**
 * Dual-tier Authentication Middleware
 * 
 * 1. If Authorization: Bearer <key> or X-API-Key: <key> is supplied:
 *    - Validated in constant time against CENTRAL_API_KEY.
 *    - If valid, req.isApiKeyAuthenticated is set to true (bypasses public rate limits).
 *    - If invalid, rejected immediately with HTTP 401 Unauthorized.
 * 2. If NO credentials are provided:
 *    - If REQUIRE_AUTH=true is explicitly configured (for strict private/internal setups),
 *      rejects with HTTP 401 Unauthorized.
 *    - Otherwise (default for public no-login dashboard), allows the request through
 *      to route-level abuse protection, strict input validation, and rate limiting.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.CENTRAL_API_KEY?.trim();
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  let providedToken: string | null = null;
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    providedToken = apiKeyHeader.trim();
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  }

  // 1. Credentials supplied: validate strictly
  if (providedToken) {
    if (!expectedKey) {
      res.status(500).json({
        ok: false,
        error: 'Server configuration error: Authentication credentials were provided, but CENTRAL_API_KEY is not configured in server environment variables.',
        code: 'AUTH_CONFIG_MISSING',
      });
      return;
    }

    if (!safeCompare(providedToken, expectedKey)) {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized: Invalid authentication credentials.',
        code: 'UNAUTHORIZED',
        hint: 'Provided Bearer token or X-API-Key does not match the configured CENTRAL_API_KEY.',
      });
      return;
    }

    req.isApiKeyAuthenticated = true;
    return next();
  }

  // 2. No credentials supplied:
  // If administrator explicitly requested mandatory authentication:
  if (process.env.REQUIRE_AUTH === 'true') {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized: Authentication is strictly required (REQUIRE_AUTH=true).',
      code: 'UNAUTHORIZED',
      hint: 'Provide a valid Authorization: Bearer <CENTRAL_API_KEY> or X-API-Key header, or configure REQUIRE_AUTH=false for public dashboard access.',
    });
    return;
  }

  // Public dashboard access: proceed to public abuse controls and rate limits
  req.isApiKeyAuthenticated = false;
  next();
}

/**
 * Rate Limiter & Abuse Filter for Health Check Endpoints
 * Prevents rapid scraping / polling flood from single IP addresses (60 requests / minute).
 */
export function healthRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.isApiKeyAuthenticated) {
    return next();
  }

  pruneStaleRateLimits();

  const ip = getClientIp(req);
  const now = Date.now();
  let timestamps = healthRateLimitStore.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < 60_000);

  if (timestamps.length >= 60) {
    res.setHeader('Retry-After', '10');
    res.status(429).json({
      ok: false,
      error: 'Too many health check requests. Rate limit is 60 requests per minute per IP.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 10,
    });
    return;
  }

  timestamps.push(now);
  healthRateLimitStore.set(ip, timestamps);
  next();
}

/**
 * Rate Limiter & Abuse Protection for Ping Endpoints
 * 
 * Guards against ICMP flood amplification, bot attacks, and resource exhaustion:
 * - Cross-site origin validation
 * - Max 4 concurrent in-flight ping executions per IP (allows 'Run All Tests' across 4 regions)
 * - Max 6 ping executions per rolling 2-minute window per IP
 */
export function pingRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.isApiKeyAuthenticated) {
    return next();
  }

  // 1. Anti-abuse cross-site execution check
  const originCheck = validatePublicRequestOrigin(req);
  if (!originCheck.allowed) {
    res.status(403).json({
      success: false,
      error: originCheck.reason || 'Forbidden: Cross-site request rejected.',
      code: 'CROSS_SITE_FORBIDDEN',
    });
    return;
  }

  pruneStaleRateLimits();

  const ip = getClientIp(req);
  const now = Date.now();
  let rec = pingRateLimitStore.get(ip);
  if (!rec) {
    rec = { timestamps: [], inFlight: 0 };
    pingRateLimitStore.set(ip, rec);
  }

  rec.timestamps = rec.timestamps.filter(t => now - t < 120_000);

  // 2. Concurrency limit (max 4 parallel pings per IP)
  if (rec.inFlight >= 4) {
    res.setHeader('Retry-After', '5');
    res.status(429).json({
      success: false,
      error: 'Concurrency limit reached: 4 ping tests are already in progress for your IP. Please allow existing tests to finish.',
      code: 'CONCURRENCY_LIMIT_EXCEEDED',
      retryAfterSeconds: 5,
    });
    return;
  }

  // 3. Rolling window limit (max 6 requests per 2 minutes)
  if (rec.timestamps.length >= 6) {
    const oldest = rec.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((120_000 - (now - oldest)) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: `Rate limit reached: Maximum 6 ping requests per 2-minute window. Please wait ${retryAfterSeconds}s before starting new tests.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds,
    });
    return;
  }

  // Record ping slot and track in-flight lifecycle
  rec.timestamps.push(now);
  rec.inFlight++;

  let finalized = false;
  const releaseSlot = () => {
    if (!finalized) {
      finalized = true;
      if (rec) {
        rec.inFlight = Math.max(0, rec.inFlight - 1);
      }
    }
  };

  res.on('finish', releaseSlot);
  res.on('close', releaseSlot);

  next();
}

/* ======================================================================
 * PUSH MODE (regional agents make OUTBOUND-ONLY HTTPS calls to this backend)
 *
 * Flow (on-demand test):
 *   1. Browser -> POST /api/regions/:id/ping   -> backend stores a "test requested" flag, returns 202 + requestId
 *   2. Agent   -> GET  /api/agent/poll         -> sees the flag, runs `ping -c 30 8.8.8.8` ON THE VM
 *   3. Agent   -> POST /api/agent/ingest       -> pushes the real measured result
 *   4. Browser -> GET  /api/regions/:id/result -> polls until the result is ready
 *
 * A region is in push mode when AGENT_KEY_<REGION> (e.g. AGENT_KEY_IN_DC02) is set.
 * Regions without that variable keep the previous behaviour (pull mode / 503 unconfigured).
 * Storage: Upstash Redis REST (UPSTASH_REDIS_REST_URL / _TOKEN, or KV_REST_API_URL / _TOKEN).
 * ====================================================================== */

const AGENT_STALE_MS = 600_000; // agent is "offline" if no heartbeat for 10 minutes (heartbeat is sent every 5 minutes)
const PUSH_REQUEST_TTL_S = 120;
const PUSH_RESULT_TTL_S = 300;
const PUSH_COOLDOWN_S = 10;
const PUSH_SEEN_TTL_S = 1200;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const agentKeyEnvName = (r: RegionId) => `AGENT_KEY_${r.replace(/-/g, '_')}`;
const PK = {
  req: (r: string) => `ping:req:${r}`,
  seen: (r: string) => `ping:seen:${r}`,
  cool: (r: string) => `ping:cool:${r}`,
  mail: (r: string) => `ping:alertmail:${r}`,
  res: (r: string, id: string) => `ping:res:${r}:${id}`,
};

export function isPushRegion(regionId: string): regionId is RegionId {
  return (ALLOWED_REGIONS as readonly string[]).includes(regionId) && Boolean(process.env[agentKeyEnvName(regionId as RegionId)]?.trim());
}

function digestEqual(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest();
  const db = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(da, db);
}

/** Returns the region whose AGENT_KEY_* matches the Bearer token, or null. The key decides the region. */
function authAgent(req: Request): RegionId | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  const token = h.substring(7).trim();
  if (!token) return null;
  let found: RegionId | null = null;
  for (const r of ALLOWED_REGIONS) {
    const key = process.env[agentKeyEnvName(r)]?.trim();
    if (key && digestEqual(token, key)) found = r;
  }
  return found;
}

/** Small per-IP limiter (in-memory, best-effort on serverless). */
function pushIpLimiter(maxPerMinute: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.isApiKeyAuthenticated) return next();
    const now = Date.now();
    const ip = getClientIp(req);
    const fresh = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    if (fresh.length >= maxPerMinute) {
      res.setHeader('Retry-After', '10');
      res.status(429).json({ ok: false, error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT_EXCEEDED' });
      return;
    }
    fresh.push(now);
    hits.set(ip, fresh);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

type RedisCmd = (string | number)[];

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redisPipeline(cmds: RedisCmd[]): Promise<any[]> {
  const cfg = redisConfig();
  if (!cfg) throw new Error('STORAGE_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Storage HTTP ${r.status}`);
    const arr = (await r.json()) as Array<{ result?: any; error?: string }>;
    return arr.map((x) => {
      if (x.error) throw new Error(x.error);
      return x.result;
    });
  } finally {
    clearTimeout(timer);
  }
}

function pushStorageError(res: Response, err: any, extra: Record<string, unknown> = {}) {
  console.error('[push-mode] storage error:', err?.message || err);
  const notConfigured = err?.message === 'STORAGE_NOT_CONFIGURED';
  res.status(503).json({
    ok: false,
    success: false,
    ...extra,
    error: notConfigured
      ? 'Result storage is not configured on the central backend (Upstash Redis environment variables missing).'
      : 'Result storage is temporarily unavailable.',
  });
}

async function agentPoll(req: Request, res: Response) {
  const region = authAgent(req);
  if (!region) return void res.status(401).json({ error: 'Unauthorized' });
  try {
    const cmds: RedisCmd[] = [['GET', PK.req(region)]];
    if (req.header('x-heartbeat') === '1') cmds.push(['SET', PK.seen(region), String(Date.now()), 'EX', PUSH_SEEN_TTL_S]);
    const out = await redisPipeline(cmds);
    const raw = out[0];
    if (!raw) return void res.json({ pending: false });
    const rec = JSON.parse(raw);
    if (rec.status !== 'pending') return void res.json({ pending: false });
    await redisPipeline([
      ['SET', PK.req(region), JSON.stringify({ ...rec, status: 'running', startedAt: Date.now() }), 'EX', PUSH_REQUEST_TTL_S],
      ['SET', PK.seen(region), String(Date.now()), 'EX', PUSH_SEEN_TTL_S],
    ]);
    res.json({ pending: true, requestId: rec.requestId, count: rec.count });
  } catch (err) {
    pushStorageError(res, err);
  }
}

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const numOrNull = (v: unknown) => v === null || isNum(v, 0, 60_000);

/** Whitelist + range-check everything an agent sends. Returns sanitized result or an error string. */
function sanitizeAgentResult(body: any, region: RegionId): { ok: true; result: any } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  if (body.targetIp !== FIXED_TARGET_IP) return { ok: false, error: `targetIp must be ${FIXED_TARGET_IP}.` };
  if (!Number.isInteger(body.requestsSent) || body.requestsSent < 1 || body.requestsSent > MAX_PING_COUNT)
    return { ok: false, error: 'requestsSent must be an integer 1-30.' };
  if (!Number.isInteger(body.successfulReplies) || body.successfulReplies < 0 || body.successfulReplies > body.requestsSent)
    return { ok: false, error: 'successfulReplies must be an integer 0..requestsSent.' };
  for (const f of ['minLatencyMs', 'avgLatencyMs', 'maxLatencyMs', 'jitterMs']) {
    if (!numOrNull(body[f])) return { ok: false, error: `${f} must be null or a number 0-60000.` };
  }
  if (!isNum(body.executionDurationMs, 0, 300_000)) return { ok: false, error: 'executionDurationMs out of range.' };
  if (!Array.isArray(body.packets) || body.packets.length > MAX_PING_COUNT) return { ok: false, error: 'packets must be an array (max 30).' };
  const packets = [];
  for (const p of body.packets) {
    if (!p || !Number.isInteger(p.sequence) || p.sequence < 1 || p.sequence > 1000 || typeof p.success !== 'boolean' || !numOrNull(p.latencyMs ?? null))
      return { ok: false, error: 'Invalid packet entry.' };
    packets.push({
      sequence: p.sequence,
      latencyMs: p.latencyMs ?? null,
      ...(Number.isInteger(p.ttl) && p.ttl >= 0 && p.ttl <= 255 ? { ttl: p.ttl } : {}),
      success: p.success,
    });
  }
  const sent = body.requestsSent as number;
  const okCount = body.successfulReplies as number;
  const failed = sent - okCount;
  return {
    ok: true,
    result: {
      success: body.success === true,
      regionId: region, // decided by the agent's key, never by the body
      targetIp: FIXED_TARGET_IP,
      requestsSent: sent,
      successfulReplies: okCount,
      failedRequests: failed,
      packetLossPercent: Math.round((failed / sent) * 1000) / 10,
      minLatencyMs: body.minLatencyMs,
      avgLatencyMs: body.avgLatencyMs,
      maxLatencyMs: body.maxLatencyMs,
      jitterMs: body.jitterMs,
      packets,
      executionDurationMs: body.executionDurationMs,
      timestamp: new Date().toISOString(), // server time
      serverVersion: 'push-agent',
      ...(typeof body.error === 'string' && body.error ? { error: body.error.slice(0, 200) } : {}),
    },
  };
}

/* ======================================================================
 * TIMEOUT ALERTS
 *
 * - Any ping request that times out (even one) is reported to the dashboard with the result
 *   (result.alert), which shows an in-app alert.
 * - An EMAIL is sent only when MORE THAN `ALERT_CONSECUTIVE_TIMEOUTS` (default 5) ping requests
 *   in a row time out in one test. At most one email per region per `ALERT_EMAIL_COOLDOWN_MIN`
 *   (default 30) minutes.
 *
 * Environment variables (all optional except the first two for email):
 *   RESEND_API_KEY            API key of the email service (Resend)
 *   ALERT_EMAIL_TO            Recipient(s), comma separated
 *   ALERT_EMAIL_FROM          Sender, default "Regional Ping Monitor <onboarding@resend.dev>"
 *   ALERT_CONSECUTIVE_TIMEOUTS  default 5 (email when MORE than this many in a row)
 *   ALERT_EMAIL_COOLDOWN_MIN  default 30
 *   ALERT_DASHBOARD_URL       link shown in the email
 * ====================================================================== */

type AlertEmailStatus = 'not_required' | 'sent' | 'skipped_cooldown' | 'not_configured' | 'failed';
interface PingAlert {
  level: 'none' | 'warning' | 'critical';
  timeouts: number;
  maxConsecutiveTimeouts: number;
  threshold: number;
  emailStatus: AlertEmailStatus;
}

const REGION_LABELS: Record<RegionId, string> = {
  'IN-DC01': 'IN-DC01 (Mumbai)',
  'IN-DC02': 'IN-DC02 (Chennai)',
  'LK-DC01': 'LK-DC01 (Colombo)',
  'SG-DC01': 'SG-DC01 (Singapore)',
};

function alertThreshold(): number {
  const n = Number(process.env.ALERT_CONSECUTIVE_TIMEOUTS);
  return Number.isInteger(n) && n >= 1 && n <= 29 ? n : 5;
}
function alertCooldownSeconds(): number {
  const m = Number(process.env.ALERT_EMAIL_COOLDOWN_MIN);
  return (Number.isFinite(m) && m >= 1 && m <= 1440 ? Math.round(m) : 30) * 60;
}
function alertRecipients(): string[] {
  return (process.env.ALERT_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s))
    .slice(0, 10);
}

/** Longest run of consecutive timed-out ping requests. */
function longestTimeoutRun(packets: Array<{ sequence: number; success: boolean }>, sent: number, failed: number): number {
  if (!packets.length) return failed >= sent ? sent : failed > 0 ? 1 : 0;
  let run = 0;
  let max = 0;
  for (const p of [...packets].sort((a, b) => a.sequence - b.sequence)) {
    if (!p.success) {
      run++;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

function buildAlert(result: any): PingAlert {
  const threshold = alertThreshold();
  const timeouts: number = result.failedRequests;
  const maxRun = longestTimeoutRun(result.packets || [], result.requestsSent, timeouts);
  const level: PingAlert['level'] = timeouts <= 0 ? 'none' : maxRun > threshold ? 'critical' : 'warning';
  return { level, timeouts, maxConsecutiveTimeouts: maxRun, threshold, emailStatus: 'not_required' };
}

const escHtml = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtWhen(d: Date): string {
  const ist = d.toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return `${ist} IST (${d.toISOString().replace('T', ' ').slice(0, 19)} UTC)`;
}
const fmtMs = (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : 'n/a');

function buildAlertEmail(region: RegionId, result: any, alert: PingAlert, isTest = false) {
  const label = REGION_LABELS[region] || region;
  const when = fmtWhen(new Date());
  const dash = process.env.ALERT_DASHBOARD_URL?.trim() || 'https://ping-monitoring-demo-app.vercel.app';
  const cooldownMin = Math.round(alertCooldownSeconds() / 60);
  const packets: Array<{ sequence: number; success: boolean }> = [...(result.packets || [])].sort((a, b) => a.sequence - b.sequence);
  const n = alert.maxConsecutiveTimeouts;
  const subject = `${isTest ? '[TEST] ' : ''}[CRITICAL] Ping timeout alert: ${region} - ${n} consecutive requests timed out`;

  const intro =
    `Regional Ping Monitor detected ${n} consecutive ping requests that timed out from ${label} to ${FIXED_TARGET_IP}. ` +
    `This exceeds the alert threshold of ${alert.threshold} consecutive timeouts, so this notification was sent automatically.`;

  const rows: Array<[string, string]> = [
    ['Region', label],
    ['Severity', 'Critical'],
    ['Detected at', when],
    ['Ping target', FIXED_TARGET_IP],
    ['Requests sent / replies received', `${result.requestsSent} / ${result.successfulReplies}`],
    ['Requests timed out', `${alert.timeouts} (${result.packetLossPercent}% packet loss)`],
    ['Longest run of consecutive timeouts', String(n)],
    ['Latency of replies (min / avg / max)', `${fmtMs(result.minLatencyMs)} / ${fmtMs(result.avgLatencyMs)} / ${fmtMs(result.maxLatencyMs)}`],
    ['Jitter', fmtMs(result.jitterMs)],
  ];
  const actions = [
    `Confirm the issue by running "ping ${FIXED_TARGET_IP}" on the ${region} VM and by repeating the test from the dashboard.`,
    'Check the data center internet link and the status of the upstream service provider.',
    `Verify that firewall rules allow outbound ICMP (ping) to ${FIXED_TARGET_IP} from the ${region} network.`,
    'If the timeouts continue, escalate to the network team and the service provider with the details above.',
  ];

  const text = [
    isTest ? 'THIS IS A TEST MESSAGE. NO REAL INCIDENT HAS BEEN DETECTED.' : '',
    'REGIONAL PING MONITOR - CRITICAL ALERT',
    '',
    intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Packet timeline (. = reply received, X = timed out):',
    packets.map((p) => (p.success ? '.' : 'X')).join(''),
    '',
    'Recommended actions:',
    ...actions.map((a, i) => `${i + 1}. ${a}`),
    '',
    `Dashboard: ${dash}`,
    '',
    `This is an automated message from Regional Ping Monitor. To avoid repeated emails, further alerts for ${region} are suppressed for ${cooldownMin} minutes. Please do not reply to this message.`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '' )).join('\n');

  const rowHtml = rows
    .map(([k, v], i) =>
      `<tr><td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;background:${i % 2 ? '#ffffff' : '#f9fafb'};color:#374151;width:42%;font-size:13px;">${escHtml(k)}</td>` +
      `<td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;background:${i % 2 ? '#ffffff' : '#f9fafb'};color:#111827;font-size:13px;font-weight:600;">${escHtml(v)}</td></tr>`)
    .join('');
  const cells = packets
    .map((p) => `<td width="14" height="14" style="width:14px;height:14px;background:${p.success ? '#2e7d32' : '#c62828'};font-size:1px;line-height:1px;">&nbsp;</td><td width="2" style="width:2px;font-size:1px;">&nbsp;</td>`)
    .join('');
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,Helvetica,sans-serif;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">` +
    `<table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:620px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;">` +
    (isTest ? `<tr><td style="background:#fef3c7;color:#92400e;padding:10px 24px;font-size:13px;font-weight:600;">THIS IS A TEST MESSAGE. No real incident has been detected.</td></tr>` : '') +
    `<tr><td style="background:#0F4761;padding:20px 24px;color:#ffffff;"><div style="font-size:12px;letter-spacing:1px;opacity:.85;">REGIONAL PING MONITOR</div>` +
    `<div style="font-size:20px;font-weight:700;margin-top:4px;">Critical ping timeout alert: ${escHtml(label)}</div></td></tr>` +
    `<tr><td style="padding:22px 24px 8px 24px;color:#111827;font-size:14px;line-height:1.55;">` +
    `<span style="display:inline-block;background:#fee2e2;color:#991b1b;font-weight:700;font-size:12px;padding:3px 10px;border-radius:12px;">CRITICAL</span>` +
    `<p style="margin:12px 0 0 0;">${escHtml(intro)}</p></td></tr>` +
    `<tr><td style="padding:12px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-bottom:0;">${rowHtml}</table></td></tr>` +
    `<tr><td style="padding:6px 24px 4px 24px;color:#374151;font-size:13px;font-weight:700;">Packet timeline</td></tr>` +
    `<tr><td style="padding:0 24px 4px 24px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr>${cells}</tr></table></td></tr>` +
    `<tr><td style="padding:4px 24px 12px 24px;color:#6b7280;font-size:12px;"><span style="color:#2e7d32;">&#9632;</span> reply received &nbsp; <span style="color:#c62828;">&#9632;</span> request timed out (one box per ping request, in order)</td></tr>` +
    `<tr><td style="padding:6px 24px 0 24px;color:#374151;font-size:13px;font-weight:700;">Recommended actions</td></tr>` +
    `<tr><td style="padding:4px 24px 12px 24px;color:#111827;font-size:13px;line-height:1.6;"><ol style="margin:4px 0 0 18px;padding:0;">${actions.map((a) => `<li style="margin-bottom:4px;">${escHtml(a)}</li>`).join('')}</ol></td></tr>` +
    `<tr><td style="padding:8px 24px 20px 24px;"><a href="${escHtml(dash)}" style="display:inline-block;background:#0F4761;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:4px;">Open the dashboard</a></td></tr>` +
    `<tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11.5px;line-height:1.5;">This is an automated message from Regional Ping Monitor. To avoid repeated emails, further alerts for ${escHtml(region)} are suppressed for ${cooldownMin} minutes. Please do not reply to this message.</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { subject, html, text };
}

async function sendEmailViaResend(to: string[], mail: { subject: string; html: string; text: string }): Promise<'sent' | 'not_configured' | 'failed'> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key || !to.length) return 'not_configured';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(process.env.RESEND_API_URL?.trim() || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_EMAIL_FROM?.trim() || 'Regional Ping Monitor <onboarding@resend.dev>',
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      console.error('[alert] email provider returned HTTP', r.status, (await r.text()).slice(0, 200));
      return 'failed';
    }
    return 'sent';
  } catch (err: any) {
    console.error('[alert] email send failed:', err?.name === 'AbortError' ? 'timeout' : err?.message);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the critical email once per region per cooldown period. */
async function sendCriticalAlertEmail(region: RegionId, result: any, alert: PingAlert): Promise<AlertEmailStatus> {
  const to = alertRecipients();
  if (!process.env.RESEND_API_KEY?.trim() || !to.length) return 'not_configured';
  let acquired = false;
  try {
    const [set] = await redisPipeline([['SET', PK.mail(region), '1', 'NX', 'EX', alertCooldownSeconds()]]);
    if (set !== 'OK') return 'skipped_cooldown';
    acquired = true;
    const status = await sendEmailViaResend(to, buildAlertEmail(region, result, alert));
    if (status !== 'sent') {
      await redisPipeline([['DEL', PK.mail(region)]]).catch(() => undefined); // let the next incident try again
      return status === 'not_configured' ? 'not_configured' : 'failed';
    }
    return 'sent';
  } catch (err: any) {
    console.error('[alert] could not process alert email:', err?.message);
    if (acquired) await redisPipeline([['DEL', PK.mail(region)]]).catch(() => undefined);
    return 'failed';
  }
}

/** POST /api/alerts/test-email (administrator key required): sends a clearly marked TEST email. */
function registerAlertRoutes(apiRouter: express.Router): void {
  apiRouter.post('/alerts/test-email', async (req: Request, res: Response) => {
    if (!req.isApiKeyAuthenticated) {
      res.status(401).json({ ok: false, error: 'Administrator key required (Authorization: Bearer <CENTRAL_API_KEY>).' });
      return;
    }
    const to = alertRecipients();
    if (!process.env.RESEND_API_KEY?.trim() || !to.length) {
      res.status(503).json({ ok: false, error: 'Email is not configured: set RESEND_API_KEY and ALERT_EMAIL_TO.' });
      return;
    }
    const packets = Array.from({ length: 30 }, (_, i) => ({ sequence: i + 1, success: !(i >= 8 && i <= 15) }));
    const sample = {
      requestsSent: 30, successfulReplies: 22, failedRequests: 8, packetLossPercent: 26.7,
      minLatencyMs: 39.1, avgLatencyMs: 39.4, maxLatencyMs: 41.2, jitterMs: 0.4, packets,
    };
    const alert: PingAlert = { level: 'critical', timeouts: 8, maxConsecutiveTimeouts: 8, threshold: alertThreshold(), emailStatus: 'not_required' };
    const status = await sendEmailViaResend(to, buildAlertEmail('IN-DC02', sample, alert, true));
    res.status(status === 'sent' ? 200 : 502).json({ ok: status === 'sent', status, sentTo: to.length });
  });
}

async function agentIngest(req: Request, res: Response) {
  const region = authAgent(req);
  if (!region) return void res.status(401).json({ error: 'Unauthorized' });
  const requestId = req.body?.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId))
    return void res.status(400).json({ error: 'Valid requestId is required.' });
  const clean = sanitizeAgentResult(req.body, region);
  if (!clean.ok) return void res.status(400).json({ error: clean.error });
  try {
    const [raw] = await redisPipeline([['GET', PK.req(region)]]);
    const rec = raw ? JSON.parse(raw) : null;
    if (!rec || rec.requestId !== requestId)
      return void res.status(409).json({ error: 'No matching pending test request (expired or already completed).' });
    // Timeout alerts: any timeout is flagged for the dashboard; an email goes out only for a long run of timeouts
    const alert = buildAlert(clean.result);
    if (alert.level === 'critical') alert.emailStatus = await sendCriticalAlertEmail(region, clean.result, alert);
    clean.result.alert = alert;
    await redisPipeline([
      ['SET', PK.res(region, requestId), JSON.stringify(clean.result), 'EX', PUSH_RESULT_TTL_S],
      ['DEL', PK.req(region)],
      ['SET', PK.cool(region), '1', 'EX', PUSH_COOLDOWN_S],
      ['SET', PK.seen(region), String(Date.now()), 'EX', PUSH_SEEN_TTL_S],
    ]);
    res.json({ ok: true });
  } catch (err) {
    pushStorageError(res, err);
  }
}

async function pushHealth(req: Request, res: Response, next: NextFunction) {
  const regionId = String(req.params.regionId);
  if (!isPushRegion(regionId)) return next();
  try {
    const [seen] = await redisPipeline([['GET', PK.seen(regionId)]]);
    const ageMs = seen ? Date.now() - Number(seen) : Infinity;
    if (ageMs <= AGENT_STALE_MS) {
      return void res.json({
        ok: true, statusCode: 200, status: 'online', regionId, latencyMs: 0,
        message: `Regional agent online (last heartbeat ${Math.round(ageMs / 1000)}s ago)`,
        serverInfo: { mode: 'push' },
      });
    }
    res.status(503).json({
      ok: false, statusCode: 503, status: 'offline', regionId,
      message: `Regional agent for ${regionId} is offline: no heartbeat received in the last 10 minutes.`,
    });
  } catch (err) {
    pushStorageError(res, err, { statusCode: 503, regionId });
  }
}

async function pushPing(req: Request, res: Response, next: NextFunction) {
  const regionId = String(req.params.regionId);
  if (!isPushRegion(regionId)) return next();

  if (!req.isApiKeyAuthenticated && req.headers['sec-fetch-site'] === 'cross-site')
    return void res.status(403).json({ success: false, error: 'Cross-site request rejected.', code: 'CROSS_SITE_FORBIDDEN' });

  const targetIp = (req.body?.targetIp || FIXED_TARGET_IP).toString().trim();
  if (targetIp !== FIXED_TARGET_IP)
    return void res.status(400).json({ success: false, regionId, error: `Forbidden target IP: "${targetIp}". Only ${FIXED_TARGET_IP} is permitted.` });

  let count = DEFAULT_PING_COUNT;
  if (req.body?.count !== undefined) {
    const n = Number(req.body.count);
    if (!Number.isInteger(n) || n < MIN_PING_COUNT || n > MAX_PING_COUNT)
      return void res.status(400).json({ success: false, regionId, error: 'Invalid ping count. Must be an integer between 1 and 30.' });
    count = n;
  }

  try {
    const [seen, pending, cool] = await redisPipeline([['GET', PK.seen(regionId)], ['GET', PK.req(regionId)], ['EXISTS', PK.cool(regionId)]]);
    if (!seen || Date.now() - Number(seen) > AGENT_STALE_MS)
      return void res.status(503).json({ success: false, regionId, error: `Regional agent for ${regionId} is offline: no heartbeat in the last 10 minutes.` });

    if (pending) {
      // a test is already queued/running for this region: everyone shares it
      const rec = JSON.parse(pending);
      return void res.status(202).json({ status: 'queued', requestId: rec.requestId, regionId, pollAfterMs: 3000 });
    }
    if (Number(cool) > 0) {
      res.setHeader('Retry-After', String(PUSH_COOLDOWN_S));
      return void res.status(429).json({ success: false, regionId, error: `A test for ${regionId} just finished. Please wait ${PUSH_COOLDOWN_S}s before starting another.` });
    }

    const requestId = crypto.randomUUID();
    await redisPipeline([['SET', PK.req(regionId), JSON.stringify({ requestId, status: 'pending', count, createdAt: Date.now() }), 'EX', PUSH_REQUEST_TTL_S]]);
    res.status(202).json({ status: 'queued', requestId, regionId, pollAfterMs: 3000 });
  } catch (err) {
    pushStorageError(res, err, { regionId });
  }
}

async function pushResult(req: Request, res: Response, next: NextFunction) {
  const regionId = String(req.params.regionId);
  if (!isPushRegion(regionId)) return next();
  const requestId = String(req.query.requestId || '');
  if (!REQUEST_ID_RE.test(requestId)) return void res.status(400).json({ status: 'error', error: 'Invalid requestId.' });
  try {
    const [done, pending] = await redisPipeline([['GET', PK.res(regionId, requestId)], ['GET', PK.req(regionId)]]);
    if (done) return void res.json({ status: 'done', result: JSON.parse(done) });
    const rec = pending ? JSON.parse(pending) : null;
    if (rec && rec.requestId === requestId) return void res.status(202).json({ status: rec.status });
    res.status(404).json({ status: 'expired', error: 'Result not found or expired. Please run the test again.' });
  } catch (err) {
    pushStorageError(res, err, { status: 'error' });
  }
}

/**
 * Registered once in createApiApp(), right after `apiRouter.use(authMiddleware)`.
 * Agent routes are mounted on the app BEFORE the main router so agent keys are never
 * checked against CENTRAL_API_KEY. The browser-facing routes are added to the router
 * first, and call next() for regions that are not in push mode.
 */
function registerPushMode(app: Application, apiRouter: express.Router): void {
  const agentRouter = express.Router();
  agentRouter.get('/poll', pushIpLimiter(120), agentPoll);
  agentRouter.post('/ingest', pushIpLimiter(60), agentIngest);
  app.use('/api/agent', agentRouter);
  app.use('/agent', agentRouter);

  apiRouter.get('/regions/:regionId/health', pushIpLimiter(60), pushHealth);
  apiRouter.post('/regions/:regionId/ping', pushIpLimiter(20), pushPing);
  apiRouter.get('/regions/:regionId/result', pushIpLimiter(300), pushResult);
}

/**
 * Creates and configures the Express application
 */
export function createApiApp(): Application {
  const app = express();

  // Enforce payload size limit (max 16KB)
  app.use(express.json({ limit: '16kb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const apiRouter = express.Router();
  apiRouter.use(authMiddleware);

  // Push mode: regional agents push real ping results outbound-only (see section above)
  registerPushMode(app, apiRouter);
  registerAlertRoutes(apiRouter);

  /**
   * Root / Info route for API
   */
  apiRouter.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'regional-ping-central-backend',
      timestamp: new Date().toISOString(),
      target: FIXED_TARGET_IP,
      supportedRegions: ALLOWED_REGIONS,
    });
  });

  /**
   * GET /api/health
   * Central backend health check
   */
  apiRouter.get('/health', healthRateLimiter, (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'regional-ping-central-backend',
      timestamp: new Date().toISOString(),
      configuredRegions: ALLOWED_REGIONS.filter(r => Boolean(getRegionalEndpointUrl(r)) || isPushRegion(r)),
    });
  });

  /**
   * GET /api/regions
   * Lists supported regional data centers and their backend configuration status
   */
  apiRouter.get('/regions', healthRateLimiter, (_req: Request, res: Response) => {
    const regionsStatus = ALLOWED_REGIONS.reduce((acc, rid) => {
      const url = getRegionalEndpointUrl(rid);
      acc[rid] = {
        regionId: rid,
        isConfigured: Boolean(url) || isPushRegion(rid),
        // Security note: Do not expose private IPs or full URLs to browser clients
        description: rid === 'IN-DC02' ? 'Test-In-dc02 Ubuntu Agent' : 'Regional Data Center Node',
      };
      return acc;
    }, {} as Record<RegionId, { regionId: RegionId; isConfigured: boolean; description: string }>);

    res.json({
      regions: regionsStatus,
      targetIp: FIXED_TARGET_IP,
      fixedCount: DEFAULT_PING_COUNT,
    });
  });

  /**
   * GET /api/regions/:regionId/health
   * Proxies health check to the authorized regional agent
   */
  apiRouter.get('/regions/:regionId/health', healthRateLimiter, async (req: Request, res: Response) => {
    const regionId = req.params.regionId as RegionId;

    if (!ALLOWED_REGIONS.includes(regionId)) {
      res.status(400).json({
        ok: false,
        statusCode: 400,
        error: `Invalid region ID: "${req.params.regionId}". Allowed regions: ${ALLOWED_REGIONS.join(', ')}`,
      });
      return;
    }

    const endpointUrl = getRegionalEndpointUrl(regionId);
    if (!endpointUrl) {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        status: 'unconfigured',
        regionId,
        message: `Regional endpoint for ${regionId} is not configured on the central backend. Set REGIONAL_${regionId.replace('-', '_')}_URL to enable. (Note: On Vercel serverless, private VM 10.202.202.61 requires a secure VPC connection or VPN tunnel to be reachable.)`,
      });
      return;
    }

    const targetUrl = `${endpointUrl.replace(/\/+$/, '')}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
      };
      if (process.env.REGIONAL_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.REGIONAL_API_KEY}`;
      }

      const response = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = { raw: await response.text() };
        }

        res.json({
          ok: true,
          statusCode: response.status,
          status: 'online',
          regionId,
          latencyMs,
          message: `HTTP ${response.status} OK — Regional agent reachable (${latencyMs} ms)`,
          serverInfo: data,
        });
      } else {
        const errText = await response.text();
        res.status(response.status).json({
          ok: false,
          statusCode: response.status,
          status: 'error',
          regionId,
          latencyMs,
          message: `Regional agent responded with HTTP ${response.status}: ${errText.substring(0, 150)}`,
        });
      }
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const networkErr = formatNetworkError(err);

      res.status(502).json({
        ok: false,
        statusCode: 502,
        status: 'unreachable',
        regionId,
        latencyMs,
        message: `Unable to connect to regional agent for ${regionId} (${networkErr}). Ensure the regional agent is online and reachable from the deployment environment.`,
      });
    }
  });

  /**
   * POST /api/regions/:regionId/ping
   * Executes standardized ping test on the authorized regional server
   */
  apiRouter.post('/regions/:regionId/ping', pingRateLimiter, async (req: Request, res: Response) => {
    const regionId = req.params.regionId as RegionId;

    // 1. Region validation
    if (!ALLOWED_REGIONS.includes(regionId)) {
      res.status(400).json({
        success: false,
        error: `Invalid region ID: "${req.params.regionId}". Allowed regions: ${ALLOWED_REGIONS.join(', ')}`,
      });
      return;
    }

    // 2. Target IP validation (strict fixed target 8.8.8.8)
    const targetIp = (req.body?.targetIp || FIXED_TARGET_IP).toString().trim();
    if (targetIp !== FIXED_TARGET_IP) {
      res.status(400).json({
        success: false,
        regionId,
        error: `Forbidden target IP: "${targetIp}". Only the fixed target ${FIXED_TARGET_IP} is permitted on this security-hardened monitor.`,
      });
      return;
    }

    // 3. Ping count validation
    let count = DEFAULT_PING_COUNT;
    if (req.body?.count !== undefined) {
      const parsed = Number(req.body.count);
      if (!Number.isInteger(parsed) || parsed < MIN_PING_COUNT || parsed > MAX_PING_COUNT) {
        res.status(400).json({
          success: false,
          regionId,
          error: `Invalid ping count: ${req.body.count}. Count must be an integer between ${MIN_PING_COUNT} and ${MAX_PING_COUNT}.`,
        });
        return;
      }
      count = parsed;
    }

    // 4. Endpoint resolution
    const endpointUrl = getRegionalEndpointUrl(regionId);
    if (!endpointUrl) {
      res.status(503).json({
        success: false,
        regionId,
        error: `Regional endpoint for ${regionId} is not configured on the central backend. Set REGIONAL_${regionId.replace('-', '_')}_URL to enable. (Note: On Vercel serverless, private VM 10.202.202.61 requires a secure VPC connection or VPN tunnel to be reachable.)`,
      });
      return;
    }

    // 5. Forward request to regional agent
    const targetUrl = `${endpointUrl.replace(/\/+$/, '')}/ping`;
    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(5000, Number(req.body?.timeoutMs) || 35000), PING_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Session-ID': (req.body?.sessionId || `sess_${Date.now()}`).toString(),
      };
      if (process.env.REGIONAL_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.REGIONAL_API_KEY}`;
      }

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetIp: FIXED_TARGET_IP,
          count,
          timeoutMs: Math.max(3000, timeoutMs - 5000),
          regionId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const executionDurationMs = Date.now() - startTime;

      if (!response.ok) {
        const errBody = await response.text();
        let parsedErr = errBody;
        try {
          const j = JSON.parse(errBody);
          if (j.error) parsedErr = j.error;
        } catch {}

        res.status(response.status).json({
          success: false,
          regionId,
          error: `Regional agent returned HTTP ${response.status}: ${parsedErr.substring(0, 200)}`,
        });
        return;
      }

      const payload = await response.json();
      res.json(payload);
    } catch (err: any) {
      clearTimeout(timer);
      const executionDurationMs = Date.now() - startTime;
      const networkErr = formatNetworkError(err);

      res.status(502).json({
        success: false,
        regionId,
        targetIp: FIXED_TARGET_IP,
        requestsSent: 0,
        successfulReplies: 0,
        failedRequests: count,
        packetLossPercent: 100,
        minLatencyMs: null,
        avgLatencyMs: null,
        maxLatencyMs: null,
        jitterMs: null,
        packets: [],
        executionDurationMs,
        timestamp: new Date().toISOString(),
        error: `Unable to reach regional agent for ${regionId} (${networkErr}). The regional agent is unreachable from the central backend. Ensure network routing and security group rules are established.`,
      });
    }
  });

  // Dual mounting: Mount on '/api' AND root '/'
  // This guarantees exact routing matches regardless of whether Vercel rewrite preserves or strips '/api'
  app.use('/api', apiRouter);
  app.use(apiRouter);

  return app;
}
