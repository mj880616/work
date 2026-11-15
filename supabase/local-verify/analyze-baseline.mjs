#!/usr/bin/env node
// Inspect a schema-only pg_dump without ever printing SQL, literals or raw psql
// errors. All identifiers are reduced to a conservative ASCII allowlist.
import {readFileSync} from 'node:fs';

const [mode, dumpFile, errorFile] = process.argv.slice(2);
if (!['inventory', 'failure'].includes(mode) || !dumpFile || (mode === 'failure' && !errorFile)) {
  console.error('Expected inventory <dump> or failure <dump> <captured stderr>');
  process.exit(2);
}

const lines = readFileSync(dumpFile, 'utf8').split(/\r?\n/);
const ident = value => {
  const clean = String(value ?? '').split('(')[0].trim();
  return /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(clean)
    && !/(?:password|secret|token|api[_-]?key|jwt|oauth)/i.test(clean)
    ? clean : 'REDACTED';
};
const typeOf = value => /^[A-Z][A-Z ]{0,30}$/.test(value ?? '') ? value : 'UNKNOWN';
const metaAt = [];
let current = {name: 'UNKNOWN', type: 'UNKNOWN', schema: 'UNKNOWN'};
const categoryEntries = new Map();
const functionFlags = new Map();
const add = (label, value) => {
  if (!categoryEntries.has(label)) categoryEntries.set(label, new Set());
  categoryEntries.get(label).add(value);
};
const nameOf = meta => meta.schema === 'UNKNOWN' || meta.schema === '-'
  ? ident(meta.name) : `${ident(meta.schema)}.${ident(meta.name)}`;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const header = /^-- Name: (.*?); Type: (.*?); Schema: (.*?); Owner: (.*?)\s*$/.exec(line);
  if (header) {
    current = {name: header[1], type: typeOf(header[2]), schema: header[3]};
    if (current.type === 'FUNCTION' || current.type === 'PROCEDURE') {
      add('FUNCTION_BODY_REVIEW', nameOf(current));
      functionFlags.set(nameOf(current), {definer: false, searchPath: false, dynamic: false});
    }
    if (current.type === 'POLICY' || current.type === 'ROW SECURITY') add('RLS_DEFINITION', nameOf(current));
  }
  metaAt[i + 1] = current;
  if (mode !== 'inventory') continue;
  const object = nameOf(current);
  if (/^CREATE SCHEMA (?:IF NOT EXISTS )?public\s*;/i.test(line)) add('LOCAL_SCHEMA_COLLISION_CANDIDATE', 'public');
  if (/^CREATE EXTENSION\b/i.test(line) || /\bextensions\.[A-Za-z_]/i.test(line)) add('EXTENSION_REFERENCE', object);
  if (/\b(?:auth|storage)\.[A-Za-z_]/i.test(line)) add('AUTH_STORAGE_DEPENDENCY', object);
  for (const match of line.matchAll(/\b(auth|storage|extensions|vault|net|cron|pgmq|pgsodium)\.[A-Za-z_]/gi)) {
    add('EXTERNAL_SCHEMA_REFERENCE', `${match[1].toLowerCase()}:${object}`);
  }
  if (/\bSECURITY\s+DEFINER\b/i.test(line)) add('SECURITY_DEFINER', object);
  if (/\b(?:SET\s+)?search_path\b/i.test(line)) add('SEARCH_PATH', object);
  const flags = functionFlags.get(object);
  if (flags && (current.type === 'FUNCTION' || current.type === 'PROCEDURE')) {
    if (/\bSECURITY\s+DEFINER\b/i.test(line)) flags.definer = true;
    if (/\b(?:SET\s+)?search_path\b/i.test(line)) flags.searchPath = true;
    if (/\bEXECUTE\b/i.test(line)) flags.dynamic = true;
  }
  if (/\bDEFAULT\b/i.test(line) && current.type !== 'UNKNOWN') add('DEFAULT_REVIEW', object);
  const owner = /^ALTER\s+(?:TABLE|FUNCTION|VIEW|SCHEMA|SEQUENCE|TYPE|DOMAIN|MATERIALIZED VIEW)\b.*\sOWNER TO\s+([^\s;]+);\s*$/i.exec(line);
  if (owner) {
    add('ALTER_OWNER', object);
    add('ROLE_REFERENCE', ident(owner[1]));
  }
  const grant = /^(?:GRANT|REVOKE)\b.*\b(?:TO|FROM)\s+([^;]+);\s*$/i.exec(line);
  if (grant) {
    add('GRANT_REVOKE', object);
    for (const role of grant[1].replace(/\s+WITH GRANT OPTION\s*$/i, '').split(',')) {
      add('ROLE_REFERENCE', ident(role));
    }
  }
}
for (const [name, flags] of functionFlags) {
  if (flags.definer && !flags.searchPath) add('SECURITY_DEFINER_NO_SEARCH_PATH', name);
  if (flags.dynamic) add('DYNAMIC_SQL_REVIEW', name);
}

const stageOf = (line, meta) => {
  if (/^\s*(?:GRANT|REVOKE)\b|\bOWNER TO\b/i.test(line) || /^(?:ACL|DEFAULT ACL)$/.test(meta.type)) return 'GRANTS_OWNERSHIP';
  if (/\b(?:CREATE POLICY|ALTER POLICY|ROW LEVEL SECURITY)\b/i.test(line) || /^(?:POLICY|ROW SECURITY)$/.test(meta.type)) return 'RLS_POLICIES';
  if (/^(?:FUNCTION|PROCEDURE|AGGREGATE|TRIGGER)$/.test(meta.type)) return 'FUNCTIONS_TRIGGERS';
  if (/^(?:INDEX|CONSTRAINT|FK CONSTRAINT|RULE)$/.test(meta.type)) return 'POST_DATA';
  if (/^(?:SCHEMA|TYPE|TABLE|SEQUENCE|VIEW|MATERIALIZED VIEW|DOMAIN|EXTENSION)$/.test(meta.type)) return 'BASE_STRUCTURE';
  return 'OTHER';
};

if (mode === 'inventory') {
  console.log(`BASELINE_DUMP_LINES=${lines.length}`);
  console.log('BASELINE_REVIEW_NOTE=References are candidates; missing roles or extensions require local catalog comparison.');
  for (const [label, values] of categoryEntries) {
    const sorted = [...values].sort();
    console.log(`BASELINE_${label}_COUNT=${sorted.length}`);
    for (const value of sorted.slice(0, 30)) console.log(`BASELINE_${label}=${value}`);
    if (sorted.length > 30) console.log(`BASELINE_${label}_MORE=${sorted.length - 30}`);
  }
} else {
  const error = readFileSync(errorFile, 'utf8');
  const first = /psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL|PANIC):\s*([0-9A-Z]{5})\b/m.exec(error);
  const lineMatch = first ?? /psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL|PANIC):/m.exec(error);
  const stateMatch = first ?? /\b(?:SQLSTATE|SQL state)\s*:?\s*([0-9A-Z]{5})\b/i.exec(error);
  const lineNumber = lineMatch ? Number(lineMatch[1]) : 0;
  const state = first?.[2] ?? (stateMatch?.[1] ?? 'UNAVAILABLE');
  const meta = metaAt[lineNumber] ?? {name: 'UNKNOWN', type: 'UNKNOWN', schema: 'UNKNOWN'};
  const line = lines[lineNumber - 1] ?? '';
  console.log(`BASELINE_SQLSTATE=${/^[0-9A-Z]{5}$/.test(state) ? state : 'UNAVAILABLE'}`);
  console.log(`BASELINE_DUMP_LINE=${lineNumber || 'UNAVAILABLE'}`);
  console.log(`BASELINE_STAGE=${stageOf(line, meta)}`);
  console.log(`BASELINE_OBJECT_TYPE=${meta.type}`);
  console.log(`BASELINE_OBJECT=${nameOf(meta)}`);
  console.log('BASELINE_RAW_SQL_AND_ERROR_WITHHELD=true');
}
