import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const modes = ['dry-run', 'apply', 'rollback'];
const fail = () => { throw new Error('DB plan rejected; check file structure, pairing or risk rules'); };

// Token boundaries preserve strings, quoted identifiers and dollar blocks. No
// executable code is hidden by a regex comment remover or by a nested WHERE.
export function tokens(sql) {
  const out = [];
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--', i)) { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (sql.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) fail();
      continue;
    }
    const start = i;
    const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) fail();
      out.push({ kind: 'block', value: sql.slice(i + dollar.length, end), start, end: end + dollar.length });
      i = end + dollar.length; continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]; let value = ''; let closed = false;
      const escaped = quote === "'" && /(?:^|[^A-Za-z0-9_])[eE]$/.test(sql.slice(0, start));
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { value += sql.slice(i, i + 2); i += 2; }
        else if (sql[i] === quote && sql[i + 1] === quote) { value += quote; i += 2; }
        else if (sql[i] === quote) { i++; closed = true; break; }
        else value += sql[i++];
      }
      if (!closed) fail();
      out.push({ kind: quote === "'" ? 'string' : 'quoted', value, start, end: i }); continue;
    }
    const word = sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*|^[0-9]+/);
    if (word) {
      i += word[0].length;
      out.push({ kind: 'word', value: word[0].toLowerCase(), start, end: i });
    } else { out.push({ kind: 'symbol', value: sql[i++], start, end: i }); }
  }
  return out;
}
const code = ts => ts.filter(t => t.kind !== 'string' && t.kind !== 'block').map(t => t.value.toLowerCase());
const statements = ts => {
  const result = []; let current = [];
  for (const t of ts) {
    if (t.value === ';' && t.kind === 'symbol') { if (current.length) result.push(current); current = []; }
    else current.push(t);
  }
  if (current.length) fail();
  return result;
};
const flat = ts => ts.flatMap(t => t.kind === 'block' ? tokens(t.value) : [t]);
const topWhere = ts => {
  let depth = 0;
  for (const t of ts) {
    if (t.kind === 'symbol' && t.value === '(') depth++;
    if (t.kind === 'symbol' && t.value === ')') depth--;
    if (depth === 0 && t.kind === 'word' && t.value === 'where') return true;
  }
  return false;
};
const target = ts => {
  const c = code(ts);
  let i = c[0] === 'alter' && c[1] === 'table' ? 2 : c[0] === 'update' ? 1 : c[0] === 'delete' && c[1] === 'from' ? 2 : -1;
  if (i < 0) return null;
  if (c[i] === 'only') i++;
  if (c[i] !== 'public' || c[i + 1] !== '.' || !/^[a-z_][a-z0-9_]*$/.test(c[i + 2] ?? '')) fail();
  return c[i + 2];
};

function historyInsert(ts, version, name) {
  // Explicit literal VALUES of one row; no SELECT, multi-row insert, conflict
  // handler or RETURNING can disguise a different migration record.
  const text = ts.map(t => t.kind === 'string' ? `'${t.value.replaceAll("'", "''")}'` : t.value).join(' ');
  const m = text.match(/^insert into supabase_migrations \. schema_migrations \( (.*?) \) values \( ([\s\S]*) \)$/i);
  if (!m) fail();
  const columns = m[1].split(' , ');
  if (new Set(columns).size !== columns.length || !columns.includes('version') || !columns.includes('name')
      || columns.some(c => !['version', 'name', 'statements'].includes(c))) fail();
  const start = ts.findIndex(t => t.kind === 'word' && t.value === 'values');
  const values = []; let current = []; let depth = 0;
  for (const t of ts.slice(start + 2, -1)) {
    if (t.kind === 'symbol' && ['(', '['].includes(t.value)) depth++;
    if (t.kind === 'symbol' && [')', ']'].includes(t.value)) depth--;
    if (depth === 0 && t.kind === 'symbol' && t.value === ',') { values.push(current); current = []; }
    else current.push(t);
  }
  values.push(current);
  if (values.length !== columns.length || depth !== 0) fail();
  for (const [column, value] of [['version', version], ['name', name]]) {
    const v = values[columns.indexOf(column)];
    if (v.length !== 1 || v[0].kind !== 'string' || v[0].value !== value) fail();
  }
  const history = values[columns.indexOf('statements')];
  if (history && code(history).some(v => !['array', '[', ']', ','].includes(v))) fail();
}

export function validateSQL(sql, { mode, version, name }) {
  if (!modes.includes(mode) || !/^[0-9]{14}$/.test(version) || !/^[a-z0-9][a-z0-9_]{0,80}$/.test(name)) fail();
  const lines = sql.trimEnd().split(/\r?\n/);
  if (!/^begin;$/i.test(lines[0].trim()) || !/^commit;$/i.test(lines.at(-1).trim())) fail();
  const ss = statements(tokens(sql));
  if (ss[0]?.length !== 1 || ss[0][0].value !== 'begin' || ss.at(-1)?.length !== 1 || ss.at(-1)[0].value !== 'commit') fail();
  let inserts = 0; let deletes = 0;
  const targets = new Set();
  for (const ts of ss.slice(1, -1)) {
    const flattened = flat(ts); const c = code(flattened); const text = c.join(' ');
    // Case-sensitive / Unicode escaped identifiers cannot be normalized into
    // reliable backup targets. Reject this unsupported syntax, rather than
    // backing up a different table or overlooking an escaped role name.
    if (flattened.some(t => t.kind === 'quoted' && !/^[a-z_][a-z0-9_]*$/.test(t.value))
        || /\bu &/.test(text)) fail();
    if (flattened.some(t => /rtw_/i.test(t.value)) || /\b(drop (?:table|schema)|truncate|alter role|(?:create|alter|drop) extension)\b/.test(text)
        || /\b(execute|call|copy|savepoint|release|reset|vacuum)\b/.test(text)
        || /\b(?:disable|no force) row level security\b/.test(text)
        || /\b(?:dblink\w*|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|set_config|nextval|setval)\b/.test(text)
        || c.includes('cascade') && code(ts)[0] !== 'alter') fail();
    if (c[0] === 'grant' && c.slice(c.indexOf('to') + 1).some(v => ['anon', 'public', 'authenticated'].includes(v))) fail();
    const root = code(ts);
    if (!['set', 'lock', 'do', 'alter', 'create', 'insert', 'update', 'delete', 'drop', 'grant', 'revoke'].includes(root[0])) fail();
    if (root[0] === 'set' && !(root[1] === 'local' && ['lock_timeout', 'statement_timeout'].includes(root[2]))) fail();
    if (root[0] === 'do') {
      if (ts.filter(t => t.kind === 'block').length !== 1 || c.some(v => ['insert', 'update', 'delete', 'create', 'alter', 'drop', 'grant', 'revoke', 'commit', 'rollback', 'perform'].includes(v))) fail();
      const assertionCalls = new Set(['if', 'exists', 'in', 'not', 'and', 'or', 'count', 'length', 'num_nonnulls', 'coalesce', 'to_regclass']);
      for (let i = 0; i < c.length - 1; i++) {
        if (c[i + 1] === '(' && /^[a-z_]/.test(c[i]) && (!assertionCalls.has(c[i]) || c[i - 1] === '.')) fail();
      }
    }
    if (root[0] === 'alter' && !['table', 'policy'].includes(root[1])) fail();
    if (root[0] === 'create' && !['table', 'index', 'unique'].includes(root[1])) fail();
    if (root[0] === 'drop' && !(mode === 'rollback' && root[1] === 'index' && root[2] === 'public' && root[3] === '.')) fail();
    if (root[0] === 'alter' && root[1] === 'table' && (root.includes('cascade') && root.includes('drop')
        || root.includes('rename') && root.includes('to') && !root.includes('constraint'))) fail();
    if (['update', 'delete'].includes(root[0]) && !topWhere(ts)) fail();
    const mentionsHistory = c.includes('supabase_migrations');
    if (root[0] === 'insert' && root[1] === 'into' && root[2] === 'supabase_migrations') {
      if (mode === 'rollback') fail(); historyInsert(ts, version, name); inserts++;
      if (ts !== ss.at(-2)) fail();
    } else if (root[0] === 'delete' && mentionsHistory) {
      if (mode !== 'rollback') fail();
      const text = ts.map(t => t.kind === 'string' ? `'${t.value}'` : t.value).join(' ');
      if (text !== `delete from supabase_migrations . schema_migrations where version = '${version}'`
          && text !== `delete from supabase_migrations . schema_migrations where version = '${version}' and name = '${name}'`) fail();
      deletes++;
    } else {
      if (mentionsHistory && ['insert', 'update', 'delete', 'alter', 'create', 'drop', 'grant', 'revoke'].includes(root[0])) fail();
      if (mode === 'rollback' && ['insert', 'update', 'delete', 'create', 'grant', 'revoke'].includes(root[0])) fail();
      const table = target(ts); if (table) targets.add(table);
      if (root[0] === 'insert' && !(root[1] === 'into' && root[2] === 'public' && root[3] === '.')) fail();
    }
  }
  if (mode === 'rollback' ? deletes !== 1 || inserts !== 0 : inserts !== 1 || deletes !== 0) fail();
  if (targets.size > 16) fail();
  return { targets: [...targets].sort(), risks: '통과: 차단 목록·기록 일치·트랜잭션 경계 확인' };
}

export function toDryRun(sql) {
  if (!/commit;\s*$/i.test(sql)) fail();
  return sql.replace(/commit;(\s*)$/i, 'rollback;$1');
}

function safeFile(root, path, limit = 262_144) {
  let full = root;
  for (const part of path.split('/')) {
    full = join(full, part);
    if (lstatSync(full).isSymbolicLink()) fail();
  }
  const info = lstatSync(full);
  if (!info.isFile() || info.size > limit) fail();
  const sql = readFileSync(full, 'utf8');
  return { path, sql, sha256: createHash('sha256').update(sql).digest('hex'), lines: sql.trimEnd().split('\n').length };
}
function choose(root, folder, pattern, required) {
  if (lstatSync(join(root, folder)).isSymbolicLink()) fail();
  const matches = readdirSync(join(root, folder)).filter(name => pattern.test(name));
  if (matches.length > 1 || required && matches.length !== 1) fail();
  return matches.length ? `${folder}/${matches[0]}` : null;
}
export function checkSQL(sql) {
  const ts = tokens(sql); const ss = statements(ts);
  if (ss.length !== 1 || !['select', 'with'].includes(ss[0][0]?.value)) fail();
  if (code(flat(ts)).some(v => ['insert', 'update', 'delete', 'create', 'alter', 'drop', 'truncate', 'grant', 'revoke', 'execute', 'call', 'copy', 'into', 'rtw_', 'set_config', 'nextval', 'setval', 'lo_import', 'lo_export', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir'].includes(v) || /^dblink/.test(v))) fail();
  if (flat(ts).some(t => /rtw_/i.test(t.value))) fail();
  // Inspect the baseline CTE definition, not unrelated IS [NOT] NULL tests
  // elsewhere in the query. Never inject baseline values automatically.
  let baselineNull = false;
  const close = open => {
    let depth = 0;
    for (let j = open; j < ts.length; j++) {
      if (ts[j].kind === 'symbol' && ts[j].value === '(') depth++;
      if (ts[j].kind === 'symbol' && ts[j].value === ')' && --depth === 0) return j;
    }
    fail();
  };
  for (let i = 0; i < ts.length; i++) {
    if (!['word', 'quoted'].includes(ts[i].kind) || ts[i].value !== 'baseline') continue;
    let j = i + 1;
    if (ts[j]?.value === '(') j = close(j) + 1; // optional column list
    if (ts[j]?.value !== 'as') continue;
    j++;
    if (ts[j]?.value === 'not') j++;
    if (ts[j]?.value === 'materialized') j++;
    if (ts[j]?.value !== '(') fail();
    const end = close(j);
    for (let k = j + 1; k < end; k++) {
      if (ts[k].kind === 'word' && ts[k].value === 'null' && ts[k - 1]?.value !== 'is'
          && !(ts[k - 1]?.value === 'not' && ts[k - 2]?.value === 'is')) baselineNull = true;
    }
  }
  return { baselineNull };
}

export function prepareMigration({ mode, version, runId, root }) {
  if (!modes.includes(mode) || !/^[0-9]{14}$/.test(version) || !/^[1-9][0-9]{0,19}$/.test(runId)) fail();
  const path = choose(root, 'supabase/migrations', new RegExp(`^${version}_.*\\.sql$`), true);
  const name = path.slice('supabase/migrations/'.length + 15, -4);
  const migration = safeFile(root, path);
  validateSQL(migration.sql, { mode: 'apply', version, name });
  const rollbackPath = choose(root, 'docs', new RegExp(`^${version}_.*\\.rollback\\.sql$`), mode === 'rollback');
  if (rollbackPath && rollbackPath !== `docs/${version}_${name}.rollback.sql`) fail();
  const file = mode === 'rollback' ? safeFile(root, rollbackPath) : migration;
  const validation = validateSQL(file.sql, { mode, version, name });
  const summaryPath = choose(root, 'docs', new RegExp(`^${version}_.*\\.summary\\.md$`), true);
  if (summaryPath !== `docs/${version}_${name}.summary.md`) fail();
  const summaryFile = safeFile(root, summaryPath, 4096);
  const summaryLines = summaryFile.sql.trim().split(/\r?\n/);
  if (summaryLines.length !== 3 || !['무엇이 바뀌나:', '잘못되면:', '되돌리는 법:'].every((prefix, i) => summaryLines[i].startsWith(prefix) && summaryLines[i].length > prefix.length)) fail();
  const checks = {};
  for (const suffix of ['precheck', 'postcheck']) {
    const checkPath = choose(root, 'docs', new RegExp(`^${version}_.*\\.${suffix}\\.sql$`), false);
    if (checkPath) {
      if (checkPath !== `docs/${version}_${name}.${suffix}.sql`) fail();
      const check = safeFile(root, checkPath, 65_536);
      checks[suffix] = { ...check, ...checkSQL(check.sql) };
    }
  }
  return { mode, version, name, runId, file, summaryFile, summaryLines, checks, ...validation };
}

export const escapeSummary = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;');
export function sqlBlock(sql) {
  const fence = '`'.repeat(Math.max(3, ...[...sql.matchAll(/`+/g)].map(m => m[0].length + 1)));
  return `${fence}sql\n${sql}\n${fence}\n`;
}
export function migrationSummary(plan) {
  const sql = plan.mode === 'dry-run' ? toDryRun(plan.file.sql) : plan.file.sql;
  return `## DB ${plan.mode}: ${plan.version}\n\n${plan.summaryLines.map(escapeSummary).join('\n\n')}\n\n`
    + `파일: \`${plan.file.path}\`\n\nSHA256: \`${plan.file.sha256}\` · 줄 수: ${plan.file.lines}\n\n위험 검사: ${plan.risks}\n\n`
    + `요약 파일 SHA256: \`${plan.summaryFile.sha256}\`\n\n실행 SQL 전문:\n\n${sqlBlock(sql)}\n`
    + Object.entries(plan.checks).map(([kind, file]) => `### ${kind} (읽기 전용)\n\n파일: \`${file.path}\` · SHA256: \`${file.sha256}\` · 줄 수: ${file.lines}\n\n`
      + (file.baselineNull ? 'baseline NULL: 실행하지 않고 수동 확인 필요로 표시합니다.\n\n' : '') + sqlBlock(file.sql)).join('\n');
}
