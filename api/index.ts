/**
 * Vercel Serverless Function Entrypoint
 * 
 * Dispatches serverless requests on Vercel to the central Express backend:
 * - GET  /api/health
 * - GET  /api/regions
 * - GET  /api/regions/:regionId/health
 * - POST /api/regions/:regionId/ping
 */
import { createApiApp } from '../src/server/app.ts';

const app = createApiApp();

export default app;
