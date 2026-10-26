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
 * 
 * Security & Network Hardening:
 * 1. Strict validation: Allowed regions (IN-DC01, IN-DC02, LK-DC01, SG-DC01).
 * 2. Fixed target enforcement: Strictly 8.8.8.8. Rejects arbitrary target IPs.
 * 3. Bounded count & timeouts: Clamped count (1..30) and timeouts (45s max).
 * 4. Zero credential leakage: Private endpoint URLs and secret keys stay on the server.
 * 5. Safe error handling: Sanitized network error messages without stack traces.
 * 6. Hardened Auth: Timing-safe token comparison against CENTRAL_API_KEY in production.
 * 7. Private VM isolation: Never assumes 10.202.202.61 is directly reachable from Vercel.
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

/**
 * Authentication & Authorization Middleware
 * 
 * Rules:
 * - In production (Vercel deployment: process.env.VERCEL === '1' or NODE_ENV === 'production'),
 *   REQUIRE_AUTH defaults to true unless explicitly set to 'false'.
 * - When REQUIRE_AUTH is true:
 *   - CENTRAL_API_KEY must be configured on the server. If missing, responds with 500 error.
 *   - The client must supply an Authorization header (`Bearer <token>`) or `X-API-Key: <token>`.
 *   - The supplied token is strictly validated against CENTRAL_API_KEY using constant-time comparison.
 *   - Arbitrary or generic Bearer tokens are strictly rejected.
 * - When REQUIRE_AUTH is false (e.g. during local development if explicitly disabled):
 *   - Requests proceed without token verification.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const requireAuth = process.env.REQUIRE_AUTH !== undefined
    ? process.env.REQUIRE_AUTH === 'true'
    : isProd;

  if (!requireAuth) {
    return next();
  }

  const expectedKey = process.env.CENTRAL_API_KEY?.trim();
  if (!expectedKey) {
    res.status(500).json({
      ok: false,
      error: 'Server configuration error: Authentication is enabled (REQUIRE_AUTH=true), but CENTRAL_API_KEY is not configured in environment variables.',
      code: 'AUTH_CONFIG_MISSING',
      hint: 'Configure the CENTRAL_API_KEY environment variable in your Vercel project settings or .env file.',
    });
    return;
  }

  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  let providedToken: string | null = null;
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    providedToken = apiKeyHeader.trim();
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  }

  if (!providedToken || !safeCompare(providedToken, expectedKey)) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized: Invalid or missing authentication credentials.',
      code: 'UNAUTHORIZED',
      hint: 'Provide a valid Authorization: Bearer <CENTRAL_API_KEY> or X-API-Key header matching the configured CENTRAL_API_KEY.',
    });
    return;
  }

  next();
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
  apiRouter.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'regional-ping-central-backend',
      timestamp: new Date().toISOString(),
      configuredRegions: ALLOWED_REGIONS.filter(r => Boolean(getRegionalEndpointUrl(r))),
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
