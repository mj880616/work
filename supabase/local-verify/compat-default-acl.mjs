#!/usr/bin/env node
// Restore hosted supabase_admin default ACLs as that same role in local CI.
// This changes only disposable restore files, never the reviewed dump or DB.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function splitAdminDefaultAcl(sql, expectedCount = 12) {
  const lines = sql.split(/\r?\n/);
  const admin = [];
  let lastCreate = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|SEQUENCE|TYPE|DOMAIN|MATERIALIZED\s+VIEW)\b/i.test(line)) lastCreate = i + 1;
    if (!/^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(line)) continue;
    if (!/^\s*ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+supabase_admin\s+IN\s+SCHEMA\s+public\s+(?:GRANT|REVOKE)\b.*\bON\s+(?:TABLES|SEQUENCES|FUNCTIONS)\b.*;\s*$/i.test(line)) continue;
    admin.push({line: i + 1, sql: line});
    lines[i] = ''; // Keep line numbering stable for first-error reports.
  }
  if (admin.length !== expectedCount || admin.some(item => item.line <= lastCreate)) {
    throw new Error('Unexpected admin default ACL count or ordering; stop without a compatibility output');
  }
  const adminSql = admin.map(item => `-- BASELINE_SOURCE_LINE=${item.line}\n${item.sql}`).join('\n') + '\n';
  return {mainSql: lines.join('\n'), adminSql, movedLines: admin.map(item => item.line)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === 'split' && args.length === 3) {
      const [input, main, admin] = args;
      const result = splitAdminDefaultAcl(readFileSync(input, 'utf8'));
      writeFileSync(main, result.mainSql, {mode: 0o600});
      writeFileSync(admin, result.adminSql, {mode: 0o600});
      console.log(`COMPAT_ADMIN_DEFAULT_ACL_MOVED=${result.movedLines.length}`);
      console.log(`COMPAT_ADMIN_DEFAULT_ACL_LINES=${result.movedLines.join(',')}`);
      console.log('COMPAT_ADMIN_DEFAULT_ACL_MODE=original SQL executed as local supabase_admin');
    } else if (mode === 'failure' && args.length === 2) {
      const [adminFile, errorFile] = args;
      const error = readFileSync(errorFile, 'utf8');
      const first = /psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL|PANIC):\s*([0-9A-Z]{5})\b/m.exec(error);
      const adminLine = Number(first?.[1] ?? 0);
      const lines = readFileSync(adminFile, 'utf8').split(/\r?\n/);
      const marker = /^-- BASELINE_SOURCE_LINE=(\d+)$/.exec(lines[adminLine - 2] ?? '');
      console.log(`BASELINE_SQLSTATE=${first?.[2] ?? 'UNAVAILABLE'}`);
      console.log(`BASELINE_STAGE=ADMIN_DEFAULT_ACL`);
      console.log(`BASELINE_DUMP_LINE=${marker?.[1] ?? 'UNAVAILABLE'}`);
      console.log('BASELINE_RAW_SQL_AND_ERROR_WITHHELD=true');
    } else {
      console.error('Expected split <reviewed-local-copy> <main-output> <admin-output> or failure <admin-copy> <captured-error>');
      process.exitCode = 2;
    }
  } catch {
    console.error('Default ACL compatibility stopped without printing SQL or errors');
    process.exitCode = 1;
  }
}
