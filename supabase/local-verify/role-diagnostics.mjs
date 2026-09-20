#!/usr/bin/env node
// Only structural facts and aliases may leave the disposable runner. The raw
// dump and role catalogs stay in temporary files and are never artifacts.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const known = new Set(['postgres', 'anon', 'authenticated', 'service_role',
  'supabase_admin', 'pg_database_owner', 'PUBLIC', 'authenticator']);
const alias = value => {
  if (!value) return 'UNSPECIFIED';
  const raw = String(value).replace(/^"|"$/g, '').replace(/""/g, '"');
  return known.has(raw) ? raw : `role_${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
};
const identifier = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)';
const decode = value => value?.replace(/^"|"$/g, '').replace(/""/g, '"');
const roleList = raw => raw ? raw.split(/\s*,\s*/).map(decode) : [];

export function classifyTarget(sql, targetLine) {
  const lines = sql.split(/\r?\n/);
  if (!Number.isSafeInteger(targetLine) || targetLine < 1 || targetLine > lines.length) {
    throw new Error('Target line is outside the reviewed dump');
  }
  const starts = /^\s*(?:ALTER\s+DEFAULT\s+PRIVILEGES|ALTER\s+(?:TABLE|VIEW|FUNCTION|SCHEMA|SEQUENCE|TYPE|DOMAIN|MATERIALIZED\s+VIEW)\b|GRANT\b|REVOKE\b)/i;
  let start = targetLine - 1;
  while (start >= Math.max(0, targetLine - 80) && !starts.test(lines[start])) start--;
  if (start < 0 || !starts.test(lines[start])) throw new Error('Target statement start was not found');
  let end = start;
  while (end < Math.min(lines.length, start + 80) && !/;\s*$/.test(lines[end])) end++;
  if (end >= lines.length || targetLine - 1 > end) throw new Error('Target statement boundary is uncertain');
  const statement = lines.slice(start, end + 1).join(' ');
  let kind = 'OTHER';
  if (/^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(statement)) kind = 'ALTER_DEFAULT_PRIVILEGES';
  else if (/\bOWNER\s+TO\b/i.test(statement)) kind = 'ALTER_OWNER';
  else if (/^\s*GRANT\b/i.test(statement)) kind = 'GRANT';
  else if (/^\s*REVOKE\b/i.test(statement)) kind = 'REVOKE';
  const forRole = decode(new RegExp(`\\bFOR\\s+ROLE\\s+(${identifier})`, 'i').exec(statement)?.[1]);
  const schema = decode(new RegExp(`\\bIN\\s+SCHEMA\\s+(${identifier})`, 'i').exec(statement)?.[1]);
  const ownerTo = decode(new RegExp(`\\bOWNER\\s+TO\\s+(${identifier})`, 'i').exec(statement)?.[1]);
  const recipient = new RegExp(`\\b(?:TO|FROM)\\s+((?:${identifier})(?:\\s*,\\s*${identifier})*)\\s*(?:WITH\\s+GRANT\\s+OPTION)?\\s*;`, 'i').exec(statement)?.[1];
  const className = /\bON\s+(TABLES|SEQUENCES|FUNCTIONS|ROUTINES|TYPES|SCHEMAS|TABLE|SEQUENCE|FUNCTION|TYPE)\b/i.exec(statement)?.[1]?.toUpperCase() ?? 'UNSPECIFIED';
  return {kind, startLine: start + 1, endLine: end + 1, schema, forRole, ownerTo,
    recipients: roleList(recipient), objectClass: className};
}

function hasMembership(catalog, member, role) {
  if (!member || !role) return false;
  if (member === role) return true;
  const visited = new Set([member]);
  const queue = [member];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of catalog.memberships ?? []) {
      if (edge.member !== current || visited.has(edge.role)) continue;
      if (edge.role === role) return true;
      visited.add(edge.role);
      queue.push(edge.role);
    }
  }
  return false;
}

export function compareRoles(target, hosted, local) {
  const role = target.forRole ?? target.ownerTo;
  const facts = {targetRole: alias(role), hostedCurrent: alias(hosted.currentUser),
    localCurrent: alias(local.currentUser)};
  for (const [label, catalog] of [['hosted', hosted], ['local', local]]) {
    const current = (catalog.roles ?? []).find(item => item.name === catalog.currentUser);
    facts[`${label}TargetExists`] = Boolean((catalog.roles ?? []).some(item => item.name === role));
    facts[`${label}CurrentSuperuser`] = Boolean(current?.superuser);
    facts[`${label}CurrentMemberOfTarget`] = hasMembership(catalog, catalog.currentUser, role);
    facts[`${label}SchemaOwner`] = alias((catalog.schemaOwners ?? []).find(item => item.schema === target.schema)?.owner);
  }
  return facts;
}

function outputTarget(target) {
  console.log(`TARGET_KIND=${target.kind}`);
  console.log(`TARGET_DUMP_START=${target.startLine}`);
  console.log(`TARGET_DUMP_END=${target.endLine}`);
  console.log(`TARGET_SCHEMA=${target.schema === 'public' || target.schema === 'private' ? target.schema : alias(target.schema)}`);
  console.log(`TARGET_FOR_ROLE=${alias(target.forRole)}`);
  console.log(`TARGET_OWNER_TO=${alias(target.ownerTo)}`);
  console.log(`TARGET_RECIPIENTS=${target.recipients.map(alias).join(',') || 'UNSPECIFIED'}`);
  console.log(`TARGET_OBJECT_CLASS=${target.objectClass}`);
  console.log('TARGET_RAW_SQL_WITHHELD=true');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, dumpFile, lineText, hostedFile, localFile] = process.argv.slice(2);
  if (!['target', 'compare'].includes(mode) || !dumpFile || !/^\d+$/.test(lineText ?? '')) {
    console.error('Expected target|compare <dump> <line> [hosted-catalog local-catalog]');
    process.exit(2);
  }
  try {
    const target = classifyTarget(readFileSync(dumpFile, 'utf8'), Number(lineText));
    outputTarget(target);
    if (mode === 'compare') {
      if (!hostedFile || !localFile) throw new Error('Role catalog paths missing');
      const facts = compareRoles(target, JSON.parse(readFileSync(hostedFile, 'utf8')),
        JSON.parse(readFileSync(localFile, 'utf8')));
      for (const [key, value] of Object.entries(facts)) console.log(`ROLE_${key}=${value}`);
    }
  } catch {
    console.error('Role diagnosis failed without printing dump or catalog contents');
    process.exitCode = 1;
  }
}
