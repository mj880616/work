// SEC-1 offline regression entrypoint. Historical vulnerable observations remain
// in commit 8226ce31. Now every run enforces the fixed handler/browser contracts.
// Real PostgreSQL concurrency: npm ci --prefix tests/auth-handoff && npm test --prefix tests/auth-handoff
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const result = spawnSync(process.execPath, ['--test',
  'tests/security/auth-handoff.test.mjs',
  'tests/security/auth-handoff-browser.test.mjs'
], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
