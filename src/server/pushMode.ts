/**
 * Push mode: regional agents make OUTBOUND-ONLY HTTPS calls to this backend.
 * Nothing connects into the regional VMs.
 *
 * Flow (on-demand test):
 *   1. Browser  -> POST /api/regions/:id/ping      -> backend stores a "test requested" flag, returns 202 + requestId
 *   2. Agent    -> GET  /api/agent/poll            -> sees the flag, runs `ping -c 30 8.8.8.8` ON THE VM
 *   3. Agent    -> POST /api/agent/ingest          -> pushes the real measured result
 *   4. Browser  -> GET  /api/regions/:id/result    -> polls until the result is ready
 *
 * A region is in push mode when AGENT_KEY_<REGION> (e.g. AGENT_KEY_IN_DC02) is set.
 * Regions without that variable keep the old behaviour (pull mode / 503 unconfigured).
 * Storage: Upstash Redis REST (UPSTASH_REDIS_REST_URL / _TOKEN, or KV_REST_API_URL / _TOKEN).
 */
import express, { type Request, type Response, type NextFunction, type Application, type Router } from 'express';
import crypto from 'crypto';

const REGIONS = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as const;
type RegionId = (typeof REGIONS)[number];

const FIXED_TARGET_IP = '8.8.8.8';
const DEFAULT_COUNT = 30;
const AGENT_STALE_MS = 120_000; // agent is "offline" if no heartbeat for 2 minutes
const REQUEST_TTL_S = 120;
const RESULT_TTL_S = 300;
const COOLDOWN_S = 10;
const SEEN_TTL_S = 600;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const keyEnvName = (r: RegionId) => `AGENT_KEY_${r.replace(/-/g, '_')}`;
const K = {
  req: (r: string) => `ping:req:${r}`,
  seen: (r: string) => `ping:seen:${r}`,
  cool: (r: string) => `ping:cool:${r}`,
  res: (r: string, id: string) => `ping:res:${r}:${id}`,
};

export function isPushRegion(regionId: string): regionId is RegionId {
  return (REGIONS as readonly string[]).includes(regionId) && Boolean(process.env[keyEnvName(regionId as RegionId)]?.trim());
}

/* ---------- helpers ---------- */

function digest(s: string): Buffer {
  return crypto.createHash('sha256').update(s).digest();
}
function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** Returns the region whose AGENT_KEY_* matches the Bearer token, or null. The key decides the region. */
function authAgent(req: Request): RegionId | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  const token = h.substring(7).trim();
  if (!token) return null;
  let found: RegionId | null = null;
  for (const r of REGIONS) {
    const key = process.env[keyEnvName(r)]?.trim();
    if (key && safeEqual(token, key)) found = r;
  }
  return found;
}

function clientIp(req: Request): string {
  const f = req.headers['x-forwarded-for'];
  if (typeof f === 'string' && f.split(',')[0].trim()) return f.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/** Small per-IP limiter (in-memory, best-effort on serverless). */
function ipLimiter(maxPerMinute: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req as any).isApiKeyAuthenticated) return next();
    const now = Date.now();
    const ip = clientIp(req);
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

/* ---------- Redis (Upstash REST) ---------- */

type Cmd = (string | number)[];

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redisPipeline(cmds: Cmd[]): Promise<any[]> {
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

function storageError(res: Response, err: any, extra: Record<string, unknown> = {}) {
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

/* ---------- agent-facing routes ---------- */

async function agentPoll(req: Request, res: Response) {
  const region = authAgent(req);
  if (!region) return void res.status(401).json({ error: 'Unauthorized' });
  try {
    const cmds: Cmd[] = [['GET', K.req(region)]];
    if (req.header('x-heartbeat') === '1') cmds.push(['SET', K.seen(region), String(Date.now()), 'EX', SEEN_TTL_S]);
    const out = await redisPipeline(cmds);
    const raw = out[0];
    if (!raw) return void res.json({ pending: false });
    const rec = JSON.parse(raw);
    if (rec.status !== 'pending') return void res.json({ pending: false });
    await redisPipeline([
      ['SET', K.req(region), JSON.stringify({ ...rec, status: 'running', startedAt: Date.now() }), 'EX', REQUEST_TTL_S],
      ['SET', K.seen(region), String(Date.now()), 'EX', SEEN_TTL_S],
    ]);
    res.json({ pending: true, requestId: rec.requestId, count: rec.count });
  } catch (err) {
    storageError(res, err);
  }
}

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const numOrNull = (v: unknown) => v === null || isNum(v, 0, 60_000);

/** Whitelist + range-check everything an agent sends. Returns sanitized result or an error string. */
function sanitizeResult(body: any, region: RegionId): { ok: true; result: any } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  if (body.targetIp !== FIXED_TARGET_IP) return { ok: false, error: `targetIp must be ${FIXED_TARGET_IP}.` };
  if (!Number.isInteger(body.requestsSent) || body.requestsSent < 1 || body.requestsSent > 30)
    return { ok: false, error: 'requestsSent must be an integer 1-30.' };
  if (!Number.isInteger(body.successfulReplies) || body.successfulReplies < 0 || body.successfulReplies > body.requestsSent)
    return { ok: false, error: 'successfulReplies must be an integer 0..requestsSent.' };
  for (const f of ['minLatencyMs', 'avgLatencyMs', 'maxLatencyMs', 'jitterMs']) {
    if (!numOrNull(body[f])) return { ok: false, error: `${f} must be null or a number 0-60000.` };
  }
  if (!isNum(body.executionDurationMs, 0, 300_000)) return { ok: false, error: 'executionDurationMs out of range.' };
  if (!Array.isArray(body.packets) || body.packets.length > 30) return { ok: false, error: 'packets must be an array (max 30).' };
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
  const ok = body.successfulReplies as number;
  const failed = sent - ok;
  return {
    ok: true,
    result: {
      success: body.success === true,
      regionId: region, // decided by the agent's key, never by the body
      targetIp: FIXED_TARGET_IP,
      requestsSent: sent,
      successfulReplies: ok,
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

async function agentIngest(req: Request, res: Response) {
  const region = authAgent(req);
  if (!region) return void res.status(401).json({ error: 'Unauthorized' });
  const requestId = req.body?.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId))
    return void res.status(400).json({ error: 'Valid requestId is required.' });
  const clean = sanitizeResult(req.body, region);
  if (!clean.ok) return void res.status(400).json({ error: clean.error });
  try {
    const [raw] = await redisPipeline([['GET', K.req(region)]]);
    const rec = raw ? JSON.parse(raw) : null;
    if (!rec || rec.requestId !== requestId)
      return void res.status(409).json({ error: 'No matching pending test request (expired or already completed).' });
    await redisPipeline([
      ['SET', K.res(region, requestId), JSON.stringify(clean.result), 'EX', RESULT_TTL_S],
      ['DEL', K.req(region)],
      ['SET', K.cool(region), '1', 'EX', COOLDOWN_S],
      ['SET', K.seen(region), String(Date.now()), 'EX', SEEN_TTL_S],
    ]);
    res.json({ ok: true });
  } catch (err) {
    storageError(res, err);
  }
}

/* ---------- browser-facing routes (inserted before the original handlers) ---------- */

async function pushHealth(req: Request, res: Response, next: NextFunction) {
  const regionId = String(req.params.regionId);
  if (!isPushRegion(regionId)) return next();
  try {
    const [seen] = await redisPipeline([['GET', K.seen(regionId)]]);
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
      message: `Regional agent for ${regionId} is offline: no heartbeat received in the last 2 minutes.`,
    });
  } catch (err) {
    storageError(res, err, { statusCode: 503, regionId });
  }
}

async function pushPing(req: Request, res: Response, next: NextFunction) {
  const regionId = String(req.params.regionId);
  if (!isPushRegion(regionId)) return next();

  if (!(req as any).isApiKeyAuthenticated && req.headers['sec-fetch-site'] === 'cross-site')
    return void res.status(403).json({ success: false, error: 'Cross-site request rejected.', code: 'CROSS_SITE_FORBIDDEN' });

  const targetIp = (req.body?.targetIp || FIXED_TARGET_IP).toString().trim();
  if (targetIp !== FIXED_TARGET_IP)
    return void res.status(400).json({ success: false, regionId, error: `Forbidden target IP: "${targetIp}". Only ${FIXED_TARGET_IP} is permitted.` });

  let count = DEFAULT_COUNT;
  if (req.body?.count !== undefined) {
    const n = Number(req.body.count);
    if (!Number.isInteger(n) || n < 1 || n > 30)
      return void res.status(400).json({ success: false, regionId, error: 'Invalid ping count. Must be an integer between 1 and 30.' });
    count = n;
  }

  try {
    const [seen, pending, cool] = await redisPipeline([['GET', K.seen(regionId)], ['GET', K.req(regionId)], ['EXISTS', K.cool(regionId)]]);
    if (!seen || Date.now() - Number(seen) > AGENT_STALE_MS)
      return void res.status(503).json({ success: false, regionId, error: `Regional agent for ${regionId} is offline: no heartbeat in the last 2 minutes.` });

    if (pending) {
      // a test is already queued/running for this region: everyone shares it
      const rec = JSON.parse(pending);
      return void res.status(202).json({ status: 'queued', requestId: rec.requestId, regionId, pollAfterMs: 3000 });
    }
    if (Number(cool) > 0) {
      res.setHeader('Retry-After', String(COOLDOWN_S));
      return void res.status(429).json({ success: false, regionId, error: `A test for ${regionId} just finished. Please wait ${COOLDOWN_S}s before starting another.` });
    }

    const requestId = crypto.randomUUID();
    await redisPipeline([['SET', K.req(regionId), JSON.stringify({ requestId, status: 'pending', count, createdAt: Date.now() }), 'EX', REQUEST_TTL_S]]);
    res.status(202).json({ status: 'queued', requestId, regionId, pollAfterMs: 3000 });
  } catch (err) {
    storageError(res, err, { regionId });
  }
}

async function pushResult(req: Request, res: Response, next: NextFunction) {
  const regionId = String(req.params.regionId);
  if (!isPushRegion(regionId)) return next();
  const requestId = String(req.query.requestId || '');
  if (!REQUEST_ID_RE.test(requestId)) return void res.status(400).json({ status: 'error', error: 'Invalid requestId.' });
  try {
    const [done, pending] = await redisPipeline([['GET', K.res(regionId, requestId)], ['GET', K.req(regionId)]]);
    if (done) return void res.json({ status: 'done', result: JSON.parse(done) });
    const rec = pending ? JSON.parse(pending) : null;
    if (rec && rec.requestId === requestId) return void res.status(202).json({ status: rec.status });
    res.status(404).json({ status: 'expired', error: 'Result not found or expired. Please run the test again.' });
  } catch (err) {
    storageError(res, err, { status: 'error' });
  }
}

/**
 * Call ONCE in createApiApp(), right after `apiRouter.use(authMiddleware);`
 * (and before any other apiRouter routes are defined).
 */
export function registerPushMode(app: Application, apiRouter: Router): void {
  const agentRouter = express.Router();
  agentRouter.get('/poll', ipLimiter(120), agentPoll);
  agentRouter.post('/ingest', ipLimiter(60), agentIngest);
  app.use('/api/agent', agentRouter); // mounted before apiRouter, so agent keys never hit CENTRAL_API_KEY auth
  app.use('/agent', agentRouter);

  apiRouter.get('/regions/:regionId/health', ipLimiter(60), pushHealth);
  apiRouter.post('/regions/:regionId/ping', ipLimiter(20), pushPing);
  apiRouter.get('/regions/:regionId/result', ipLimiter(300), pushResult);
}
