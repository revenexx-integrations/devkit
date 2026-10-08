/**
 * The SDK's `safeFetch` refuses private and loopback addresses unless
 * `RVNXX_SSRF_ALLOW_PRIVATE` is set. The local stack sets it in
 * `docker-compose.dev.yml`; the devkit sets it for the same reason, so a node
 * can be tried against a service on localhost without any setup.
 *
 * A value the developer set themselves is left alone, including `0`.
 * Returns true when this call set it.
 */
export function allowPrivateTargets(env: NodeJS.ProcessEnv): boolean {
  if (env.RVNXX_SSRF_ALLOW_PRIVATE !== undefined) {
    return false;
  }
  env.RVNXX_SSRF_ALLOW_PRIVATE = '1';
  return true;
}
