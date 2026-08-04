import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.js';
import { findFreePort, listenWithFallback, parsePort } from '../src/ports.js';

/**
 * Port allocation is what decides whether a second `preview` starts, so its two
 * halves both matter: the default must get out of the way, and an explicitly named
 * port must never be quietly swapped for a different one.
 */

const open: Server[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map(server => new Promise(done => server.close(done))));
});

/** A server occupying an ephemeral port, plus that port. */
async function occupied(): Promise<number> {
  const server = createServer();
  open.push(server);
  await new Promise<void>(done => server.listen(0, done));
  return (server.address() as AddressInfo).port;
}

function track(): Server {
  const server = createServer();
  open.push(server);
  return server;
}

describe('listenWithFallback', () => {
  it('binds the requested port when it is free', async () => {
    const free = await findFreePort(3555);
    const port = await listenWithFallback(track(), { port: free, strict: false });
    expect(port).toBe(free);
  });

  it('walks up past an occupied port and reports the port it actually bound', async () => {
    const taken = await occupied();
    const port = await listenWithFallback(track(), { port: taken, strict: false });

    expect(port).toBeGreaterThan(taken);
    expect(port).toBeLessThan(taken + 20);
  });

  /**
   * The distinction the whole module exists for. `--port 4000` is a promise the
   * devkit makes to whatever the user pointed at 4000 — their own Nuxt host, a
   * curl script — so relocating would break exactly the thing they configured.
   */
  it('refuses to relocate an explicitly named port', async () => {
    const taken = await occupied();

    await expect(listenWithFallback(track(), { port: taken, strict: true })).rejects.toThrow(CliError);
    await expect(listenWithFallback(track(), { port: taken, strict: true })).rejects.toThrow(/already in use/);
  });

  it('gives up with an actionable message when the whole range is taken', async () => {
    const taken = await occupied();

    await expect(listenWithFallback(track(), { port: taken, strict: false, limit: 1 })).rejects.toThrow(/Pass --port/);
  });
});

describe('findFreePort', () => {
  it('skips a port that is in use', async () => {
    const taken = await occupied();
    expect(await findFreePort(taken)).toBeGreaterThan(taken);
  });

  it('leaves nothing bound behind, so the caller can take the port', async () => {
    const free = await findFreePort(3555);
    // Would throw EADDRINUSE if the probe had not closed its listener.
    expect(await listenWithFallback(track(), { port: free, strict: true })).toBe(free);
  });
});

describe('parsePort', () => {
  it('accepts a plain port number', () => {
    expect(parsePort('4000', '--port')).toBe(4000);
  });

  /**
   * `Number.parseInt('abc')` produced NaN, which travelled all the way into
   * `server.listen(NaN)` and died there with ERR_SOCKET_BAD_PORT.
   */
  it.each(['abc', '4000x', '', '0', '65536', '-1', '80.5'])('rejects %j', value => {
    expect(() => parsePort(value, '--port')).toThrow(CliError);
  });

  /** `--port` as the last argument silently fell back to the default. */
  it('rejects a missing value instead of falling back to the default', () => {
    expect(() => parsePort(undefined, '--port')).toThrow(/needs a port number/);
  });

  it('rejects the next flag being swallowed as the value', () => {
    expect(() => parsePort('--no-ui', '--port')).toThrow(/needs a port number/);
  });
});
