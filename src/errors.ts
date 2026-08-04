/**
 * An error that maps to an HTTP status + JSON body in the mock API, mirroring
 * Laravel's `{message}` / `{message, errors}` envelopes.
 */
export class DevApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DevApiError';
  }
}

/**
 * An error whose message is the whole story for the user — a wrong flag, an
 * occupied port, a refused second preview.
 *
 * The CLI's top-level handler prints these as a single line and exits 1, rather
 * than the stack trace it prints for a genuine defect. That distinction is the
 * point: a stack trace on `--port abc` teaches the reader nothing and buries the
 * one line that matters.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
