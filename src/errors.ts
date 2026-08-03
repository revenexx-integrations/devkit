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
