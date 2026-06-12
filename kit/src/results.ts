// The machine-readable results file (BUILD-BRIEF §3.4, BP-09 §4.1 results_url).
//
// JSON with suite version, per-test pass/fail/skip plus evidence pointers, and an overall
// verdict. Published at a stable URL for self-certification; its schema is
// schemas/tck-results.schema.json so registry entries can reference it.

import { writeFileSync } from 'node:fs';
import { release, arch, platform } from 'node:os';

export type Status = 'pass' | 'fail' | 'skip';

export interface Evidence {
  label: string;
  detail?: unknown;
}

export interface TestResult {
  id: string;
  suite: string;
  class: 'D' | 'A' | 'H';
  name: string;
  /** the spec clause this test enforces, named in the assertion message. */
  clause: string;
  status: Status;
  /** the assertion message — names the spec clause on failure (BUILD-BRIEF §3.3). */
  message: string;
  evidence: Evidence[];
  duration_ms: number;
}

export interface ResultsFile {
  results_format: 1;
  suite: 'brain-protocol-tck';
  suite_version: string;
  class: 'D' | 'A' | 'H';
  target: string | null;
  adapter: string | null;
  started_at: string;
  completed_at: string;
  environment: { node: string; os: string };
  summary: { total: number; passed: number; failed: number; skipped: number };
  verdict: 'pass' | 'fail';
  tests: TestResult[];
}

export function buildResults(args: {
  suiteVersion: string;
  cls: 'D' | 'A' | 'H';
  target: string | null;
  adapter: string | null;
  startedAt: string;
  tests: TestResult[];
}): ResultsFile {
  const passed = args.tests.filter((t) => t.status === 'pass').length;
  const failed = args.tests.filter((t) => t.status === 'fail').length;
  const skipped = args.tests.filter((t) => t.status === 'skip').length;
  return {
    results_format: 1,
    suite: 'brain-protocol-tck',
    suite_version: args.suiteVersion,
    class: args.cls,
    target: args.target,
    adapter: args.adapter,
    started_at: args.startedAt,
    completed_at: new Date().toISOString(),
    environment: { node: process.version, os: `${platform()} ${release()} ${arch()}` },
    summary: { total: args.tests.length, passed, failed, skipped },
    // verdict: a class passes only when every test marked for it passes (BP-09 §2.1).
    // Skips do not pass: a skipped Class D test means the suite did not prove the law.
    verdict: failed === 0 && skipped === 0 ? 'pass' : 'fail',
    tests: args.tests,
  };
}

export function writeResults(path: string, results: ResultsFile): void {
  writeFileSync(path, JSON.stringify(results, null, 2) + '\n', 'utf8');
}
