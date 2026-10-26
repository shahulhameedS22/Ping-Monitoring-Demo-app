/**
 * Handles the push-mode response of POST /api/regions/:id/ping.
 * - Old behaviour (HTTP 200 with a full result) is returned unchanged.
 * - New behaviour (HTTP 202 + requestId): polls GET <base>/result until the
 *   regional agent has pushed its real measurement, then returns that result.
 */
const POLL_EVERY_MS = 3000;
const MAX_WAIT_MS = 75_000; // ~5s agent pickup + ~30s ping + margin

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readPingResponse(response: Response, baseUrl: string, regionId: string): Promise<any> {
  const first = await response.json();
  if (response.status !== 202 || !first?.requestId) return first;

  const url = `${baseUrl.replace(/\/+$/, '')}/result?requestId=${encodeURIComponent(first.requestId)}`;
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 202) continue; // still queued / running on the regional agent
    const body = await r.json().catch(() => ({} as any));
    if (r.ok && body.status === 'done' && body.result) return body.result;
    throw new Error(`Regional server [${regionId}] HTTP ${r.status}: ${body.error || body.message || 'Could not retrieve result.'}`);
  }
  throw new Error(`Regional agent for ${regionId} did not return a result in time (waited ${MAX_WAIT_MS / 1000}s).`);
}
