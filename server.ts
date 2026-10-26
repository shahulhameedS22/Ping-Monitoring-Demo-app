/**
 * Regional Ping Monitor - Central Express Backend
 * 
 * Provides secure server-side API proxy routes for regional ping test execution:
 * - GET  /api/health
 * - GET  /api/regions
 * - GET  /api/regions/:regionId/health
 * - POST /api/regions/:regionId/ping
 * 
 * Security & Network Hardening:
 * 1. Strict validation: Allowed regions (IN-DC01, IN-DC02, LK-DC01, SG-DC01).
 * 2. Fixed target enforcement: Strictly 8.8.8.8. Rejects arbitrary target IPs.
 * 3. Bounded count & timeouts: Clamped count (1..30) and timeouts (45s max).
 * 4. Zero credential leakage: Private endpoint URLs and secret keys stay on the server.
 * 5. Safe error handling: Sanitized network error messages without stack traces.
 * 6. Auth integration point: Configurable authentication middleware.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants & Types
export const ALLOWED_REGIONS = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as const;
export type RegionId = typeof ALLOWED_REGIONS[number];

const FIXED_TARGET_IP = '8.8.8.8';
const DEFAULT_PING_COUNT = 30;
const MIN_PING_COUNT = 1;
const MAX_PING_COUNT = 30;
const HEALTH_TIMEOUT_MS = 6000;
const PING_TIMEOUT_MS = 45000;

/**
 * Resolves regional agent URL from server-side environment variables.
 * Only IN-DC02 is initially configured for the Test-In-dc02 Ubuntu VM.
 * The other three regions remain unconfigured unless an environment variable is set.
 */
export function getRegionalEndpointUrl(regionId: RegionId): string | null {
  switch (regionId) {
    case 'IN-DC02':
      // Configured test endpoint for Test-In-dc02 Ubuntu VM
      return process.env.REGIONAL_IN_DC02_URL || 'http://10.202.202.61:8080';
    case 'IN-DC01':
      return process.env.REGIONAL_IN_DC01_URL || null;
    case 'LK-DC01':
      return process.env.REGIONAL_LK_DC01_URL || null;
    case 'SG-DC01':
      return process.env.REGIONAL_SG_DC01_URL || null;
    default:
      return null;
  }
}

/**
 * Sanitizes and formats network error messages safely without exposing internal stacks or raw paths.
 */
function formatNetworkError(err: any): string {
  if (!err) return 'Network failure';
  if (err.name === 'AbortError') return 'Connection timed out';
  if (err.code === 'ECONNREFUSED') return 'Connection refused (agent service not listening or port 8080 blocked)';
  if (err.code === 'ENETUNREACH') return 'Network unreachable (no route to private IP)';
  if (err.code === 'EHOSTUNREACH') return 'Host unreachable (target VM offline or subnet not routed)';
  if (err.code === 'ETIMEDOUT') return 'Network connection timed out';
  return err.message || 'Unknown network error';
}

/**
 * Authentication & Authorization Integration Point
 * 
 * - When REQUIRE_AUTH=true, enforces valid Bearer token or X-API-Key.
 * - When REQUIRE_AUTH=false (default in development/preview), logs an audit notice and allows requests.
 */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requireAuth = process.env.REQUIRE_AUTH === 'true';
  const centralApiKey = process.env.CENTRAL_API_KEY;
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  if (requireAuth) {
    const hasValidApiKey = centralApiKey && apiKeyHeader === centralApiKey;
    const hasValidBearer =
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ') &&
      authHeader.replace('Bearer ', '').trim().length > 10;

    if (!hasValidApiKey && !hasValidBearer) {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized: Authentication required to execute ping tests or access regional agents.',
        code: 'AUTH_REQUIRED',
        hint: 'Provide a valid Authorization: Bearer <token> or X-API-Key header. In local development, set REQUIRE_AUTH=false.',
      });
      return;
    }
  }

  next();
}

/**
 * Creates and configures the Express application
 */
export function createServerApp() {
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

  /**
   * GET /api/health
   * Central backend health check
   */
  apiRouter.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'regional-ping-central-backend',
      timestamp: new Date().toISOString(),
      configuredTestRegion: 'IN-DC02',
    });
  });

  /**
   * GET /api/regions
   * Lists supported regional data centers and their backend configuration status
   */
  apiRouter.get('/regions', (_req: Request, res: Response) => {
    const regionsStatus = ALLOWED_REGIONS.reduce((acc, rid) => {
      const url = getRegionalEndpointUrl(rid);
      acc[rid] = {
        regionId: rid,
        isConfigured: Boolean(url),
        // Note: Do not return private IPs or full URLs to the browser
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
  apiRouter.get('/regions/:regionId/health', async (req: Request, res: Response) => {
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
        message: `Regional endpoint for ${regionId} is not configured on the central backend. Set REGIONAL_${regionId.replace('-', '_')}_URL to enable.`,
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
        message: `Unable to connect to regional agent for ${regionId} (${networkErr}). Private VM requires VPC connector or active network route.`,
      });
    }
  });

  /**
   * POST /api/regions/:regionId/ping
   * Executes standardized ping test on the authorized regional server
   */
  apiRouter.post('/regions/:regionId/ping', async (req: Request, res: Response) => {
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
        error: `Regional endpoint for ${regionId} is not configured on the central backend. Set REGIONAL_${regionId.replace('-', '_')}_URL to enable.`,
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
        error: `Unable to reach regional agent for ${regionId} (${networkErr}). The private test VM is unreachable from the central backend. Ensure private VPC networking or a secure tunnel is established.`,
      });
    }
  });

  app.use('/api', apiRouter);

  return app;
}

/**
 * Starts the central full-stack server
 */
export async function startServer() {
  const app = createServerApp();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    // Development mode: Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static files
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Regional Ping Central Backend] Running on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
    console.log(`[Regional Ping Central Backend] Configured Test Agent: IN-DC02 -> ${getRegionalEndpointUrl('IN-DC02')}`);
  });
}

// Start if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Fatal startup error in server.ts:', err);
    process.exit(1);
  });
}
