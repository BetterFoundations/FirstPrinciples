#!/usr/bin/env node
// Reads every package's `coverage/coverage-summary.json` (written by vitest's
// v8 provider, see tools/vitest-config) and renders one table to
// $GITHUB_STEP_SUMMARY. This is the free replacement for a paid Codecov PR
// comment — it runs with `if: always()` so a failing coverage gate still
// shows *why* it failed.
import { readFile, readdir, appendFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist']);
const root = process.cwd();

async function findCoverageSummaries(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.name === 'coverage') {
      const summaryPath = join(full, 'coverage-summary.json');
      try {
        await readFile(summaryPath);
        found.push(summaryPath);
      } catch {
        // no summary in this coverage dir
      }
      continue;
    }
    found.push(...(await findCoverageSummaries(full)));
  }
  return found;
}

function pct(metric) {
  return `${metric.pct.toFixed(2)}%`;
}

const THRESHOLDS = { lines: 90, branches: 85, functions: 90, statements: 90 };

async function main() {
  const summaryPaths = await findCoverageSummaries(root);

  if (summaryPaths.length === 0) {
    const body = '## Coverage\n\nNo `coverage-summary.json` found — no package has tests yet.\n';
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, body);
    } else {
      console.log(body);
    }
    return;
  }

  const rows = [];
  let anyBelowThreshold = false;

  for (const summaryPath of summaryPaths) {
    const pkgDir = relative(root, join(summaryPath, '..', '..'));
    const raw = JSON.parse(await readFile(summaryPath, 'utf8'));
    const total = raw.total;
    const cells = ['lines', 'statements', 'functions', 'branches'].map((key) => {
      const belowThreshold = total[key].pct < THRESHOLDS[key];
      if (belowThreshold) anyBelowThreshold = true;
      const mark = belowThreshold ? ' ❌' : '';
      return `${pct(total[key])}${mark}`;
    });
    rows.push(`| ${pkgDir} | ${cells.join(' | ')} |`);
  }

  const body = [
    '## Coverage',
    '',
    `Thresholds: lines/statements ${THRESHOLDS.lines}%, branches ${THRESHOLDS.branches}%, functions ${THRESHOLDS.functions}%.`,
    '',
    '| Package | Lines | Statements | Functions | Branches |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    anyBelowThreshold
      ? '❌ One or more packages are below their coverage threshold.'
      : '✅ All packages meet their coverage threshold.',
    '',
  ].join('\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, body);
  } else {
    console.log(body);
  }
}

await main();
