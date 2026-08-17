// Aggregates every packages/<name>/size-limit.json into one root-level
// config so a single `size-limit` invocation (what the CI PR-comment action
// and the plain CI gate both run) covers all published packages, while each
// package still owns its own budget file per spec §3.1.
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const packagesDir = join(__dirname, 'packages');
const packageNames = existsSync(packagesDir) ? readdirSync(packagesDir) : [];

const checks = packageNames.flatMap((name) => {
  const configPath = join(packagesDir, name, 'size-limit.json');
  if (!existsSync(configPath)) return [];
  const packageChecks = JSON.parse(readFileSync(configPath, 'utf8'));
  return packageChecks.map((check) => ({
    ...check,
    path: join('packages', name, check.path),
  }));
});

// size-limit errors on a genuinely empty config array — both `size-limit
// --json` (run directly by andresz1/size-limit-action, which offers no way
// to swap in a wrapper script) and our own plain CI gate need this to
// always produce valid output, even before the first real package exists.
module.exports =
  checks.length > 0
    ? checks
    : [
        {
          name: 'placeholder (no packages published yet)',
          path: 'scripts/size-limit-placeholder.js',
          limit: '1 KB',
        },
      ];
