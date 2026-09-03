import { NodeError } from '@revenexx/integrations-node-sdk';

/**
 * The two rules the tenant state store keeps that neither the mock context nor
 * the local preview would otherwise have any reason to keep — and both of which
 * a node author only finds out about in production if we do not.
 *
 * They live here rather than in either caller because the testing harness and
 * the preview must refuse the same things: a node that passes its unit tests and
 * then trips the store on its first preview run has learnt nothing from either.
 * The rest of what the store promises — that a granted claim really excludes a
 * parallel run, that an undeclared namespace is refused — is the engine's, and
 * `specs/workflow-state.md` in the SDK records it as such.
 */

/** Mirrors the engine's default claim lifetime (7 days). */
export const DEFAULT_CLAIM_TTL_SECONDS = 604_800;

/** The window the store accepts: one second to one year. */
export const MIN_CLAIM_TTL_SECONDS = 1;
export const MAX_CLAIM_TTL_SECONDS = 31_536_000;

/**
 * A `ttlSeconds` outside the accepted window is refused rather than clamped: the
 * figure is the duplicate-suppression window *and* the retry window, so a node
 * quietly given a different one than it asked for would suppress deliveries for
 * a stretch its author never chose.
 */
export function assertTtlInRange(ttlSeconds: number | undefined): void {
  if (ttlSeconds === undefined) {
    return;
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < MIN_CLAIM_TTL_SECONDS || ttlSeconds > MAX_CLAIM_TTL_SECONDS) {
    throw new NodeError('INVALID_TTL', `ttlSeconds must be between ${MIN_CLAIM_TTL_SECONDS} and ${MAX_CLAIM_TTL_SECONDS}, got ${String(ttlSeconds)}.`);
  }
}

/**
 * Re-pointing one side of an existing pair is refused, in both directions: an id
 * correlated two ways is always a bug, and no later sync can untangle it —
 * whichever of the two answers a lookup happens to give, half the records it
 * touches are the wrong ones. Writing the same pair again is not a re-point and
 * is allowed, so a node that puts unconditionally on every run stays green.
 */
export function assertNotRepointed(namespace: string, pairs: Iterable<[string, string]>, left: string, right: string): void {
  for (const [existingLeft, existingRight] of pairs) {
    if (existingLeft === left && existingRight !== right) {
      throw new NodeError('MAPPING_CONFLICT', `'${left}' is already correlated with '${existingRight}' in namespace '${namespace}'.`);
    }
    if (existingRight === right && existingLeft !== left) {
      throw new NodeError('MAPPING_CONFLICT', `'${right}' is already correlated with '${existingLeft}' in namespace '${namespace}'.`);
    }
  }
}
