import type http from 'node:http';
import { DevApiError } from './errors.js';

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  res.end(payload);
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
