#!/usr/bin/env node
// Reports the first psql failure from a disposable local step without SQL,
// literals, credentials, or unfiltered PostgreSQL diagnostics.
import {readFileSync} from 'node:fs';

const [stage, sqlFile, errorFile] = process.argv.slice(2);
const allowedStages = new Set(['AUTH_TRIGGER', 'SYNTHETIC_SEED', 'MIGRATION', 'AUTHORIZATION_SQL']);
if (!allowedStages.has(stage) || !sqlFile || !errorFile) {
  console.error('Expected stage, SQL file and captured psql output');
  process.exit(2);
}
try {
  const lines = readFileSync(sqlFile, 'utf8').split(/\r?\n/);
  const error = readFileSync(errorFile, 'utf8');
  const first = /psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL|PANIC):\s*([0-9A-Z]{5})\b/m.exec(error);
  const fallback = /psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL|PANIC):/m.exec(error);
  const line = Number(first?.[1] ?? fallback?.[1] ?? 0);
  let kind = 'UNKNOWN';
  let object = 'UNKNOWN';
  for (let i = Math.min(line - 1, lines.length - 1); i >= Math.max(0, line - 80); i--) {
    const match = /^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DO|ALTER\s+TABLE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|FUNCTION|TRIGGER))\b(?:\s+((?:public|private)\.[A-Za-z_][A-Za-z0-9_]*))?/i.exec(lines[i]);
    if (!match) continue;
    kind = match[1].replace(/\s+/g, '_').toUpperCase();
    const candidate = match[2] ?? '';
    object = !/(?:password|secret|token|api[_-]?key|jwt|oauth)/i.test(candidate)
      ? candidate || 'UNKNOWN' : 'REDACTED';
    break;
  }
  console.log(`LOCAL_SQL_STAGE=${stage}`);
  console.log(`LOCAL_SQLSTATE=${first?.[2] ?? 'UNAVAILABLE'}`);
  console.log(`LOCAL_SQL_LINE=${line || 'UNAVAILABLE'}`);
  console.log(`LOCAL_SQL_STATEMENT=${kind}`);
  console.log(`LOCAL_SQL_OBJECT=${object}`);
  if (stage === 'SYNTHETIC_SEED') {
    const context = /PL\/pgSQL function ((?:(?:public|private)\.)?[a-z_][a-z_0-9]*)\([^\r\n)]*\) line (\d+) at ([A-Z_]+)/i.exec(error);
    const fn = context?.[1] || 'UNAVAILABLE';
    const action = context?.[3]?.toUpperCase() || 'UNAVAILABLE';
    console.log(`LOCAL_SQL_TRIGGER_FUNCTION=${/^(?:(?:public|private)\.)?[a-z_][a-z_0-9]*$/i.test(fn) ? fn : 'UNAVAILABLE'}`);
    console.log(`LOCAL_SQL_TRIGGER_ACTION=${/^[A-Z_]+$/.test(action) ? action : 'UNAVAILABLE'}`);
  }
  console.log('LOCAL_SQL_AND_ERROR_WITHHELD=true');
} catch {
  console.error('Local SQL diagnosis failed without printing source or captured errors');
  process.exitCode = 1;
}
