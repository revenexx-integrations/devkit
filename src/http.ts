import type http from 'node:http';
import { DevApiError } from './errors.js';

/**
 * The `/api/v1` contract version this mock implements. Mirrors what the real
 * service reports via its `SetApiVersion` middleware.
 *
 * Kept as a constant rather than read from the vendored spec so nothing 357 KB
 * has to ship in the package; `tests/contract.test.ts` asserts it equals
 * `info.version` of `contract/integrations-v1.json`, so the two cannot drift.
 */
export const API_VERSION = '1.0.0';

const BASE_HEADERS = {
  'X-Api-Version': API_VERSION,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...BASE_HEADERS });
  res.end(payload);
}

/**
 * 204 with no body, which is what the service returns from every DELETE. The mock
 * used to answer `200 {deleted:true}`; per ADR-0036 §3 a changed status code is a
 * breaking difference, so that was training node authors on behaviour the real API
 * does not have.
 */
export function sendNoContent(res: http.ServerResponse): void {
  res.writeHead(204, BASE_HEADERS);
  res.end();
}

/** Maps a thrown error to the Laravel-style `{message}` / `{message, errors}` body. */
export function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof DevApiError) {
    sendJson(res, err.status, err.errors ? { message: err.message, errors: err.errors } : { message: err.message });
    return;
  }
  sendJson(res, 500, { message: (err as Error)?.message ?? 'Internal error' });
}

export async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

/** Reads + parses a JSON body; throws {@link DevApiError} 400 on malformed input. */
export async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (raw.trim() === '') {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new DevApiError(400, 'Invalid JSON body.');
  }
}
