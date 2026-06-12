// The test harness: runs a class suite in BP-09 catalogue order, collecting machine-readable
// results. Every test id matches the BP-09 §2 catalogue exactly; every assertion message names
// the spec clause it enforces (BUILD-BRIEF ground rules). Nothing is asserted: each test runs
// its seed/attack/observe against the system under test and reports what it saw.

import type { Adapter } from './types.js';
import type { KitPeer } from './peer/kit-peer.js';
import type { Evidence, Status, TestResult } from './results.js';

export interface TestContext {
  adapter: Adapter | null;
  peer: KitPeer;
  target: string | null;
  /** the system-under-test's own id, learned from its verified card (or a --system-id override).
   *  The kit never assumes the target's name (TPMS friction log, 2026-06-12). */
  targetSystemId: string | null;
  evidence: Evidence[];
  /** record an evidence pointer (what was seeded/attacked/observed). */
  note(label: string, detail?: unknown): void;
  /** the spec-clause-naming assertion. On failure throws TckFailure with the clause. */
  check(condition: boolean, clause: string, message: string): void;
  /** skip with a reason (counts as not-proven; verdict cannot be pass with skips). */
  skip(reason: string): never;
}

export class TckFailure extends Error {
  constructor(public clause: string, message: string) {
    super(message);
    this.name = 'TckFailure';
  }
}

export class TckSkip extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TckSkip';
  }
}

export interface TestDef {
  id: string;
  suite: string;
  cls: 'D' | 'A' | 'H';
  name: string;
  clause: string;
  /** which surface this test needs; the harness skips cleanly if it is absent. */
  needs: 'adapter' | 'wire' | 'both' | 'none';
  run(ctx: TestContext): Promise<void> | void;
}

const REGISTRY = new Map<string, TestDef>();

export function defineTest(def: TestDef): void {
  if (REGISTRY.has(def.id)) throw new Error(`duplicate test id ${def.id}`);
  REGISTRY.set(def.id, def);
}

export function getTest(id: string): TestDef | undefined {
  return REGISTRY.get(id);
}

// The Class D catalogue, in BP-09 §2.10 order — 46 tests.
// ENV-01..10, DAT-01..11, HSK-01..06, COM-01/02/03/06/07/08,
// SEC-01/02/05/06/07/08/10/11, GAT-01/02/03/04/09.
// Room is left for BP-10's T-HIS/T-DEC and the A/H ids without reserving them here.
export const CLASS_D_CATALOGUE: string[] = [
  'T-ENV-01', 'T-ENV-02', 'T-ENV-03', 'T-ENV-04', 'T-ENV-05',
  'T-ENV-06', 'T-ENV-07', 'T-ENV-08', 'T-ENV-09', 'T-ENV-10',
  'T-DAT-01', 'T-DAT-02', 'T-DAT-03', 'T-DAT-04', 'T-DAT-05', 'T-DAT-06',
  'T-DAT-07', 'T-DAT-08', 'T-DAT-09', 'T-DAT-10', 'T-DAT-11',
  'T-HSK-01', 'T-HSK-02', 'T-HSK-03', 'T-HSK-04', 'T-HSK-05', 'T-HSK-06',
  'T-COM-01', 'T-COM-02', 'T-COM-03', 'T-COM-06', 'T-COM-07', 'T-COM-08',
  'T-SEC-01', 'T-SEC-02', 'T-SEC-05', 'T-SEC-06', 'T-SEC-07', 'T-SEC-08', 'T-SEC-10', 'T-SEC-11',
  'T-GAT-01', 'T-GAT-02', 'T-GAT-03', 'T-GAT-04', 'T-GAT-09',
];

export const CLASS_CATALOGUES: Record<'D', string[]> = {
  D: CLASS_D_CATALOGUE,
};

export interface RunOptions {
  cls: 'D';
  adapter: Adapter | null;
  peer: KitPeer;
  target: string | null;
  /** the target's own id (from its card or a --system-id override); null when no target. */
  targetSystemId?: string | null;
  /** when true, a test needing an absent surface fails rather than skips (strict done check). */
  strict?: boolean;
  /** run only ids matching these prefixes (e.g. ['T-ENV']) — for per-wave runs. */
  only?: string[];
  onResult?: (r: TestResult) => void;
}

export async function runSuite(opts: RunOptions): Promise<TestResult[]> {
  const full = CLASS_CATALOGUES[opts.cls];
  const catalogue = opts.only && opts.only.length
    ? full.filter((id) => opts.only!.some((p) => id.startsWith(p)))
    : full;
  const results: TestResult[] = [];

  for (const id of catalogue) {
    const def = REGISTRY.get(id);
    const started = performance.now();
    if (!def) {
      results.push(mk(id, 'UNKNOWN', opts.cls, id, '(not in catalogue)', 'fail',
        `test ${id} is in the Class ${opts.cls} catalogue but no implementation is registered`, [], started));
      opts.onResult?.(results[results.length - 1]);
      continue;
    }

    const evidence: Evidence[] = [];
    const ctx: TestContext = {
      adapter: opts.adapter,
      peer: opts.peer,
      target: opts.target,
      targetSystemId: opts.targetSystemId ?? null,
      evidence,
      note: (label, detail) => { evidence.push({ label, detail }); },
      check: (cond, clause, message) => { if (!cond) throw new TckFailure(clause, message); },
      skip: (reason) => { throw new TckSkip(reason); },
    };

    // Surface availability check.
    const surfaceMissing =
      (def.needs === 'adapter' || def.needs === 'both') && !opts.adapter ? 'adapter' :
      (def.needs === 'wire' || def.needs === 'both') && !opts.target ? 'target' : null;

    let result: TestResult;
    if (surfaceMissing && !opts.strict) {
      result = mk(def.id, def.suite, def.cls, def.name, def.clause, 'skip',
        `skipped: no ${surfaceMissing} provided (test needs ${def.needs})`, evidence, started);
    } else if (surfaceMissing && opts.strict) {
      result = mk(def.id, def.suite, def.cls, def.name, def.clause, 'fail',
        `${def.clause}: required ${surfaceMissing} not provided`, evidence, started);
    } else {
      try {
        await def.run(ctx);
        result = mk(def.id, def.suite, def.cls, def.name, def.clause, 'pass',
          `${def.clause}: passed`, evidence, started);
      } catch (err) {
        if (err instanceof TckSkip) {
          result = mk(def.id, def.suite, def.cls, def.name, def.clause, 'skip', err.message, evidence, started);
        } else if (err instanceof TckFailure) {
          result = mk(def.id, def.suite, def.cls, def.name, def.clause, 'fail',
            `${err.clause}: ${err.message}`, evidence, started);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          result = mk(def.id, def.suite, def.cls, def.name, def.clause, 'fail',
            `${def.clause}: unexpected error — ${msg}`, evidence, started);
        }
      }
    }
    results.push(result);
    opts.onResult?.(result);
  }
  return results;
}

function mk(id: string, suite: string, cls: 'D' | 'A' | 'H', name: string, clause: string,
            status: Status, message: string, evidence: Evidence[], started: number): TestResult {
  return { id, suite, class: cls, name, clause, status, message, evidence, duration_ms: Math.round((performance.now() - started) * 100) / 100 };
}
