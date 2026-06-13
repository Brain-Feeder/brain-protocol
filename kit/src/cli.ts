// brain-tck — the conformance kit CLI.
//
//   brain-tck run --class D --target http://localhost:8080 --adapter ../reference/adapter.ts --out results.json
//
// Loads the adapter module, brings up the kit-peer, runs the class suite in BP-09 catalogue
// order, prints a human summary, and writes the machine-readable results (BP-09 §4.1).
// CD-3: the kit runs locally and transmits nothing except to --target (T-SEC-11 tests this).

import { pathToFileURL } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import type { Adapter, AdapterFactory } from './types.js';
import { KitPeer } from './peer/kit-peer.js';
import { WireClient } from './peer/wire.js';
import { runSuite, type RunOptions } from './harness.js';
import { buildResults, writeResults, type TestResult } from './results.js';

// Register all suites (side-effect imports populate the test registry).
import './suites/env.js';
import './suites/dat.js';
import './suites/hsk.js';
import './suites/com.js';
import './suites/sec.js';
import './suites/gat.js';
import './suites/ref.js';

// 2.0.1 (PATCH, BP-09 §5.2): the kit learns the target's system id from its verified card
// instead of assuming it — a coupling removed, no test semantics changed.
// 2.0.2 (PATCH, BP-09 §5.2): T-DAT-07 reads the served bounds envelope against provider-stood-up
// rows instead of seeding by wire ingest (which only passed against a reference accepting
// unauthenticated ingest); the reference now requires a sync-mode grant for ingest/resync. The
// read-bounds LAW is unchanged — only how the kit exercises it. Surfaced by the TPMS integration.
const SUITE_VERSION = '2.0.2';

interface Args {
  cmd: string;
  cls: 'D';
  target: string | null;
  adapter: string | null;
  out: string | null;
  only: string[];
  strict: boolean;
  systemId: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? 'run', cls: 'D', target: null, adapter: null, out: null, only: [], strict: false, systemId: null };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--class': a.cls = (v as 'D'); i++; break;
      case '--target': a.target = v; i++; break;
      case '--adapter': a.adapter = v; i++; break;
      case '--out': a.out = v; i++; break;
      case '--only': a.only = v.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--system-id': a.systemId = v; i++; break;
      case '--strict': a.strict = true; break;
      default: if (k.startsWith('--')) { console.error(`unknown flag ${k}`); }
    }
  }
  return a;
}

async function loadAdapter(spec: string): Promise<Adapter> {
  const p = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
  const mod = await import(pathToFileURL(p).href);
  const factory: AdapterFactory = mod.default ?? mod.createAdapter;
  if (typeof factory !== 'function') throw new Error(`adapter ${spec} must export a default factory () => Adapter`);
  return await factory();
}

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function badge(status: TestResult['status']): string {
  if (status === 'pass') return C.green('PASS');
  if (status === 'fail') return C.red('FAIL');
  return C.yellow('SKIP');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd !== 'run') {
    console.error('usage: brain-tck run --class D --target <url> --adapter <file> [--out results.json] [--only T-ENV] [--strict]');
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  let adapter: Adapter | null = null;
  if (args.adapter) adapter = await loadAdapter(args.adapter);
  const peer = await KitPeer.create();

  // Learn the target's own system id — the kit never assumes the target's name. Precedence:
  // an explicit --system-id, else the id from the target's verified agent card (BP-03 §2.3).
  // (TPMS friction log, 2026-06-12: a system honestly named anything must still certify.)
  let targetSystemId: string | null = args.systemId;
  let targetCap: number | null = null;
  if (args.target) {
    const card = await new WireClient(args.target).fetchAndVerifyCard();
    if (card.ok && card.body) {
      if (!targetSystemId && card.body.system_id) targetSystemId = card.body.system_id as string;
      if (typeof card.body?.limits?.max_batch_records === 'number') targetCap = card.body.limits.max_batch_records as number;
    } else if (!targetSystemId) {
      console.error(C.yellow(`  warning: could not learn the target's system id from its card (${card.reason ?? 'no system_id'}); pass --system-id`));
    }
  }

  console.log(C.bold(`\nBrain Protocol TCK ${SUITE_VERSION} — Class ${args.cls}`));
  console.log(C.dim(`target: ${args.target ?? '(none)'}  system-id: ${targetSystemId ?? '(none)'}  adapter: ${args.adapter ?? '(none)'}  ${args.only.length ? 'only: ' + args.only.join(',') : ''}\n`));

  const opts: RunOptions = {
    cls: args.cls, adapter, peer, target: args.target, targetSystemId, targetCap, strict: args.strict, only: args.only,
    onResult: (r) => {
      const line = `  ${badge(r.status)}  ${r.id.padEnd(9)} ${r.name}`;
      console.log(line);
      if (r.status === 'fail') console.log(C.red(`         ↳ ${r.message}`));
      if (r.status === 'skip') console.log(C.dim(`         ↳ ${r.message}`));
    },
  };

  const tests = await runSuite(opts);
  if (adapter) await adapter.close();

  const results = buildResults({ suiteVersion: SUITE_VERSION, cls: args.cls, target: args.target, adapter: args.adapter, startedAt, tests });
  if (args.out) { writeResults(args.out, results); console.log(C.dim(`\nresults → ${args.out}`)); }

  const { passed, failed, skipped, total } = results.summary;
  console.log('');
  console.log(C.bold(`  ${passed}/${total} passed`) + C.dim(`  (${failed} failed, ${skipped} skipped)`));
  console.log(C.bold(`  verdict: ${results.verdict === 'pass' ? C.green('PASS') : C.red('FAIL')}\n`));
  process.exit(results.verdict === 'pass' ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
