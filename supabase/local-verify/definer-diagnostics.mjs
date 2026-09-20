#!/usr/bin/env node
// Static triage only. Never print function SQL or string literals.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const safeName = value => {
  const raw = String(value ?? '').split('(')[0].trim();
  if (/^(?:public|private)\.[A-Za-z_][A-Za-z0-9_$]*$/.test(raw) &&
      !/(?:password|secret|token|api[_-]?key|jwt|oauth)/i.test(raw)) return raw;
  return `object_${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
};
export function reviewDefiners(sql) {
  const lines = sql.split(/\r?\n/);
  const blocks = [];
  let active = null;
  for (const line of lines) {
    const match = /^-- Name: (.*?); Type: (FUNCTION|PROCEDURE); Schema: (.*?); Owner: (.*?)\s*$/.exec(line);
    const anyHeader = /^-- Name: .*?; Type: .*?; Schema: .*?; Owner: .*?\s*$/.test(line);
    if (anyHeader) {
      if (active) blocks.push(active);
      active = match ? {name: safeName(`${match[3]}.${match[1]}`), signature: match[1], lines: []} : null;
    } else if (active) active.lines.push(line);
  }
  if (active) blocks.push(active);
  const result = [];
  for (const block of blocks) {
    const body = block.lines.join('\n');
    if (!/\bSECURITY\s+DEFINER\b/i.test(body)) continue;
    const escaped = block.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const acl = lines.filter(line => new RegExp(`^\\s*(?:GRANT|REVOKE)\\b.*\\bON\\s+(?:FUNCTION|PROCEDURE)\\s+${escaped}\\s*\\(`, 'i').test(line));
    const grants = new Set();
    for (const line of acl) {
      const grantees = /^\s*GRANT\b.*\bTO\s+([^;]+);/i.exec(line)?.[1];
      if (grantees) for (const role of grantees.split(',')) {
        const clean = role.trim();
        grants.add(['anon', 'authenticated', 'service_role', 'PUBLIC', 'postgres'].includes(clean)
          ? clean : 'OTHER_ROLE');
      }
    }
    const idInput = /\([^)]*\buuid\b/i.test(block.signature);
    const identity = /\bauth\.uid\s*\(|\bcurrent_setting\s*\(\s*'request\.jwt\./i.test(body);
    const helper = /\b(?:app_can_|app_is_|has_project_|check_project_|pg_has_role\s*\()/i.test(body);
    const explicitGrant = [...grants].sort().join(',') || 'NONE_OBSERVED';
    const publicRevoke = acl.some(line => /^\s*REVOKE\b.*\bFROM\s+PUBLIC\b/i.test(line));
    const priority = /\b(?:app_public_|app_set_project_|app_project_publication_|app_move_project_|app_can_)/i.test(block.name)
      ? 'HIGH' : 'NORMAL';
    result.push({name: block.name, priority,
      searchPath: /\bSET\s+search_path\b/i.test(body),
      idInput, identity, helper, explicitGrant, publicRevoke});
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('Expected schema-only dump path'); process.exit(2); }
  try {
    const reviews = reviewDefiners(readFileSync(file, 'utf8'));
    console.log(`DEFINER_REVIEW_COUNT=${reviews.length}`);
    for (const review of reviews.sort((a, b) => a.priority.localeCompare(b.priority) || a.name.localeCompare(b.name))) {
      console.log(`DEFINER_REVIEW=${review.name} priority:${review.priority} search_path:${review.searchPath} id_input:${review.idInput} identity_ref:${review.identity} permission_helper_ref:${review.helper} explicit_grant:${review.explicitGrant} public_revoke:${review.publicRevoke}`);
    }
    console.log('DEFINER_REVIEW_LIMIT=Heuristic triage; body logic and effective EXECUTE privileges require human review.');
  } catch {
    console.error('Definer review failed without printing dump content');
    process.exitCode = 1;
  }
}
