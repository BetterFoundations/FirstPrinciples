// Aggregates every packages/<name>/size-limit.json into one root-level
// config so a single `size-limit` invocation (what the CI PR-comment action
// and the plain CI gate both run) covers all published packages, while each
// package still owns its own budget file per spec §3.1.
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const packagesDir = join(__dirname, 'packages');
const packageNames = existsSync(packagesDir) ? readdirSync(packagesDir) : [];

module.exports = packageNames.flatMap((name) => {
  const configPath = join(packagesDir, name, 'size-limit.json');
  if (!existsSync(configPath)) return [];
  const checks = JSON.parse(readFileSync(configPath, 'utf8'));
  return checks.map((check) => ({
    ...check,
    path: join('packages', name, check.path),
  }));
});
