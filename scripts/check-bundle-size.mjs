#!/usr/bin/env node
// Wraps `size-limit` (config: ../.size-limit.js) so the empty scaffold (no
// packages/*/size-limit.json yet) doesn't fail CI — size-limit itself
// errors on an empty check list. Once the first package lands with its own
// size-limit.json, this delegates straight through and budget violations
// fail the process the normal way.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const packagesDir = join(process.cwd(), 'packages');
const hasConfigs =
  existsSync(packagesDir) &&
  readdirSync(packagesDir).some((name) => existsSync(join(packagesDir, name, 'size-limit.json')));

if (!hasConfigs) {
  console.log('No packages/*/size-limit.json yet — skipping bundle size check.');
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'size-limit'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
