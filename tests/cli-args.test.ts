import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, parseArgs } from '../src/cli-args.js';
import { CliError } from '../src/errors.js';

/**
 * `cli.ts` runs `main()` on import, so parsing lives in its own module — these are
 * the first tests the CLI surface has had.
 */

function parse(argv: string[], env: NodeJS.ProcessEnv = {}) {
  return parseArgs(argv, env);
}

describe('port', () => {
  it('defaults to 3555 and is not explicit', () => {
    const { options } = parse([]);
    expect(options.port).toBe(DEFAULT_PORT);
    expect(options.portExplicit).toBe(false);
  });

  /**
   * `$PORT` counts as explicit: someone who exports it means it, and a `.env`
   * carrying it is loaded before parsing precisely so it takes effect.
   */
  it('takes $PORT as an explicit choice', () => {
    const { options } = parse([], { PORT: '4000' });
    expect(options.port).toBe(4000);
    expect(options.portExplicit).toBe(true);
  });

  it('lets --port win over $PORT', () => {
    const { options } = parse(['--port', '5000'], { PORT: '4000' });
    expect(options.port).toBe(5000);
    expect(options.portExplicit).toBe(true);
  });

  it('rejects a non-numeric --port instead of reaching listen() as NaN', () => {
    expect(() => parse(['--port', 'abc'])).toThrow(CliError);
  });

  it('rejects --port as the last argument instead of silently defaulting', () => {
    expect(() => parse(['--port'])).toThrow(/needs a port number/);
  });

  it('rejects a bad $PORT too', () => {
    expect(() => parse([], { PORT: 'nope' })).toThrow(/\$PORT/);
  });
});

describe('parallel', () => {
  it('is off by default', () => {
    expect(parse(['preview']).options.parallel).toBe(false);
  });

  it('is on with --parallel', () => {
    const { command, options } = parse(['preview', '--parallel']);
    expect(command).toBe('preview');
    expect(options.parallel).toBe(true);
  });
});

describe('commands and passthrough flags', () => {
  it.each([
    ['reset', ['reset']],
    ['init-preview', ['init-preview', '--dir', './x']],
    ['preview', ['preview']],
    ['version', ['--version']],
    ['version', ['-v']],
  ])('recognises %s', (expected, argv) => {
    expect(parse(argv).command).toBe(expected);
  });

  it('has no command for the bare mock server', () => {
    expect(parse(['--no-ui']).command).toBeNull();
  });

  it('rejects an unknown option', () => {
    expect(() => parse(['--nope'])).toThrow(/Unknown option: --nope/);
  });

  /**
   * `--env` is consumed by loadEnvFile before parsing; it must not be mistaken for
   * an unknown option, and its value must not be read as a command.
   */
  it('skips --env and its value', () => {
    const { command, options } = parse(['--env', '.env.staging', 'preview']);
    expect(command).toBe('preview');
    expect(options.port).toBe(DEFAULT_PORT);
  });

  /** Node acts on `--env-file` itself but still forwards it here. */
  it.each([
    ['--env-file', ['--env-file', 'x.env', 'preview']],
    ['--env-file=', ['--env-file=x.env', 'preview']],
  ])('tolerates %s', (_label, argv) => {
    expect(parse(argv).command).toBe('preview');
  });
});

describe('paths', () => {
  it('resolves --dir against the cwd', () => {
    expect(parse(['preview', '--dir', './my-preview']).options.previewDir).toBe(resolve(process.cwd(), 'my-preview'));
  });

  it('leaves previewDir null for the managed cache', () => {
    expect(parse(['preview']).options.previewDir).toBeNull();
  });
});
