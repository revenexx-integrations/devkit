import type { Mock } from 'vitest';

/**
 * The type of every spy the harness hands out: a mock that takes any call and
 * returns anything, so a test can seed it with whatever its node expects.
 *
 * Spelled out rather than written `ReturnType<typeof vi.fn>`, which meant this
 * under Vitest 2 and means `Mock<Constructable | Procedure>` from Vitest 3 on —
 * a type no logger or `secrets.get` signature accepts. `Mock<AnyFn>` reads the
 * same under every Vitest from 2 on (PO-804).
 */
export type AnyFn = (...args: any[]) => any;

export type AnyMock = Mock<AnyFn>;
