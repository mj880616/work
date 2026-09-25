import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Hash a comparison copy only. Keep pg_dump's unpredictable restriction key
// intact in the raw file that psql later restores.
export function canonicalSchemaHash(sql) {
  const markers = [...sql.matchAll(/^\\(un)?restrict ([A-Za-z0-9]+)\r?$/gm)];
  if (markers.length !== 2 || markers[0][1] || markers[1][1] !== 'un' ||
      markers[0][2] !== markers[1][2]) {
    throw new Error('Expected exactly one matching pg_dump restrict/unrestrict pair');
  }
  const canonical = sql.replace(/^\\(un)?restrict [A-Za-z0-9]+(\r?)$/gm,
    (_, un, newline) => `\\${un || ''}restrict CANONICALKEY${newline}`);
  return createHash('sha256').update(canonical).digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, expected] = process.argv.slice(2);
  if (!file || (expected && !/^[a-f0-9]{64}$/.test(expected))) {
    throw new Error('A schema file and optional reviewed SHA-256 are required');
  }
  const digest = canonicalSchemaHash(readFileSync(file, 'utf8'));
  if (expected && digest !== expected) {
    throw new Error(`Canonical schema SHA-256 mismatch: ${digest}`);
  }
  console.log(`Canonical schema SHA-256 ${digest}${expected ? ' matches reviewed value' : ''}`);
}
