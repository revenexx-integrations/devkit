/**
 * Whether a process is still around.
 *
 * `kill(pid, 0)` sends no signal — it only asks the kernel whether the process
 * exists and whether we may signal it. `EPERM` therefore means "alive, but not
 * yours", which counts as alive: a preview started under another user still holds
 * the port.
 *
 * Both the preview registry and the install lock record a pid, and both need the
 * same answer, so this lives on its own rather than in either of them.
 */
export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Injectable liveness check, so tests need no real processes. */
export type IsAlive = (pid: number) => boolean;
