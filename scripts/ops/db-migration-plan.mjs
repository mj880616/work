import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateExpanded, parseExpectations, checkSnapshotSQL, createdTables, ExpandedRejection } from './db-migration-expanded.mjs';

// Single source of truth for check item labels. The run phase (db-migration-run.mjs)
// refuses any label outside this set AFTER apply, so the plan phase checks it first.
export const CHECK_LABEL_RE = /^[\p{L}\p{N} _/()=:+.,·-]{1,100}$/u;

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

// Keep the existing risk checks shared by ordinary statements and function
// bodies. Privilege EXECUTE is parsed separately; dynamic EXECUTE stays here.
function checkRisks(ts) {
  const flattened = flat(ts); const c = code(flattened); const text = c.join(' ');
  if (flattened.some(t => t.kind === 'quoted' && !/^[a-z_][a-z0-9_]*$/.test(t.value))
      || /\bu &/.test(text)) fail();
  if (flattened.some(t => /rtw_/i.test(t.value)) || /\b(drop (?:table|schema)|truncate|alter role|(?:create|alter|drop) extension)\b/.test(text)
      || /\b(execute|call|copy|savepoint|release|reset|vacuum)\b/.test(text)
      || /\b(?:disable|no force) row level security\b/.test(text)
      || /\b(?:dblink\w*|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|set_config|nextval|setval)\b/.test(text)
      || c.includes('cascade') && code(ts)[0] !== 'alter') fail();
}

const identifier = t => t && ['word', 'quoted'].includes(t.kind) && /^[a-z_][a-z0-9_]*$/.test(t.value) && t.value.length <= 63;
const keyword = (t, value) => t?.kind === 'word' && t.value === value;
const symbol = (t, value) => t?.kind === 'symbol' && t.value === value;
const typeNames = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['integer', 'integer'], ['int8', 'bigint'], ['bigint', 'bigint'],
  ['int2', 'smallint'], ['smallint', 'smallint'], ['bool', 'boolean'], ['boolean', 'boolean'],
  ['text', 'text'], ['uuid', 'uuid'], ['json', 'json'], ['jsonb', 'jsonb'], ['bytea', 'bytea'],
  ['numeric', 'numeric'], ['decimal', 'numeric'], ['real', 'real'], ['float4', 'real'],
  ['double precision', 'double precision'], ['float8', 'double precision'], ['date', 'date'],
  ['timestamp', 'timestamp'], ['timestamp without time zone', 'timestamp'],
  ['timestamptz', 'timestamptz'], ['timestamp with time zone', 'timestamptz'], ['void', 'void'],
]);
function functionType(ts) {
  if (!ts.length || ts.some(t => t.kind !== 'word' && !['[', ']'].includes(t.value))) fail();
  let array = '';
  if (symbol(ts.at(-2), '[') && symbol(ts.at(-1), ']')) { array = '[]'; ts = ts.slice(0, -2); }
  const type = typeNames.get(ts.map(t => t.value).join(' '));
  if (!type) fail();
  return type + array;
}
function functionSignature(ts, start, declaration = false) {
  if (!identifier(ts[start]) || !['public', 'private'].includes(ts[start].value)
      || !symbol(ts[start + 1], '.') || !identifier(ts[start + 2])
      || /rtw_/i.test(ts[start + 2].value) || !symbol(ts[start + 3], '(')) fail();
  const args = []; let current = []; let i = start + 4;
  for (; i < ts.length && !symbol(ts[i], ')'); i++) {
    if (symbol(ts[i], ',')) { if (!current.length) fail(); args.push(current); current = []; }
    else current.push(ts[i]);
  }
  if (!symbol(ts[i], ')') || !current.length && args.length) fail();
  if (current.length) args.push(current);
  const types = args.map(arg => {
    if (arg[0]?.kind === 'word' && ['out', 'inout', 'variadic'].includes(arg[0].value)) fail();
    if (declaration && keyword(arg[0], 'in')) arg = arg.slice(1);
    // Only built-in types, optional IN and argument names; no defaults, OUT,
    // variadics, typmods or user-defined types whose identity is ambiguous.
    if (declaration && identifier(arg[0]) && !typeNames.has(arg.map(t => t.value).join(' '))) {
      const rawType = arg.at(-1)?.value === ']' ? arg.slice(0, -2) : arg;
      if (!typeNames.has(rawType.map(t => t.value).join(' '))) arg = arg.slice(1);
    }
    const type = functionType(arg);
    if (type.startsWith('void')) fail();
    return type;
  });
  return { signature: `${ts[start].value}.${ts[start + 2].value}(${types.join(',')})`, end: i + 1 };
}

function functionBody(block, language) {
  const body = tokens(block.value);
  if (!body.length || body.some(t => t.kind === 'block')) fail();
  checkRisks(body);
  const c = code(body);
  // No nested DDL, privilege changes or transaction control. SET could undo
  // the fixed search_path, and SQL-standard bodies are outside this grammar.
  if (c.some(v => ['create', 'alter', 'drop', 'grant', 'revoke', 'commit', 'rollback', 'supabase_migrations'].includes(v))) fail();
  for (let i = 0; i < c.length; i++) {
    if (c[i] === 'set' && !(c[i - 3] === 'public' && c[i - 2] === '.'
        && (c[i - 4] === 'update' || c[i - 4] === 'only' && c[i - 5] === 'update'))) fail();
  }
  // PostgreSQL SQL bodies may omit their final semicolon. PL/pgSQL bodies
  // retain explicit statement boundaries; lexical failures still reject.
  const terminated = language === 'sql' && !symbol(body.at(-1), ';')
    ? [...body, { kind: 'symbol', value: ';' }] : body;
  for (const statement of statements(terminated)) {
    for (let i = 0; i < statement.length; i++) {
      if (!keyword(statement[i], 'update') && !keyword(statement[i], 'delete')) continue;
      // SELECT ... FOR UPDATE is a row lock, not DML. The FOR immediately
      // preceding UPDATE is part of PostgreSQL's locking-clause grammar.
      // Continue scanning: a later real UPDATE/DELETE still needs its own WHERE.
      if (keyword(statement[i], 'update') && keyword(statement[i - 1], 'for')) continue;
      // Stop at the enclosing CTE/subquery boundary, so an outer WHERE or a
      // WHERE in another statement cannot authorize this mutation. RETURNING
      // and LOOP also end a FOR-loop source before its first body statement.
      let depth = 0; let end = i + 1;
      for (; end < statement.length; end++) {
        if (depth === 0 && statement[end].kind === 'word'
            && ['returning', 'loop'].includes(statement[end].value)) break;
        if (symbol(statement[end], '(')) depth++;
        if (symbol(statement[end], ')') && --depth < 0) break;
      }
      const mutation = statement.slice(i, end);
      if (!topWhere(mutation)) fail();
      target(mutation); // The same supported public write targets as before.
    }
  }
}

function functionDefinition(ts) {
  checkRisks(ts);
  let start = 1;
  if (keyword(ts[start], 'or') && keyword(ts[start + 1], 'replace')) start += 2;
  if (!keyword(ts[start], 'function')) fail();
  const parsed = functionSignature(ts, start + 1, true);
  let i = parsed.end;
  if (!keyword(ts[i++], 'returns')) fail();
  if (keyword(ts[i], 'setof')) i++;
  const beginType = i;
  while (ts[i]?.kind === 'word' && !['language', 'security', 'set', 'as', 'stable', 'immutable', 'volatile', 'strict'].includes(ts[i].value)
      || symbol(ts[i], '[') || symbol(ts[i], ']')) i++;
  functionType(ts.slice(beginType, i));
  const seen = new Set();
  let language; let body;
  while (i < ts.length) {
    const option = ts[i++];
    if (option.kind !== 'word' || seen.has(option.value)) fail();
    seen.add(option.value);
    if (option.value === 'language') {
      if (ts[i]?.kind !== 'word' || !['sql', 'plpgsql'].includes(ts[i].value)) fail();
      language = ts[i++].value;
    } else if (option.value === 'security') {
      if (!keyword(ts[i++], 'invoker')) fail();
    } else if (option.value === 'set') {
      if (!keyword(ts[i++], 'search_path') || !(symbol(ts[i], '=') || keyword(ts[i], 'to'))) fail();
      i++;
      if (ts[i]?.kind === 'string' && ts[i].value === '') i++;
      else if (identifier(ts[i]) && ts[i].value === 'public' && symbol(ts[i + 1], ',')
          && identifier(ts[i + 2]) && ts[i + 2].value === 'pg_temp') i += 3;
      else fail();
    } else if (option.value === 'as') {
      if (ts[i]?.kind !== 'block') fail();
      body = ts[i++];
    } else if (!['stable', 'immutable', 'volatile', 'strict'].includes(option.value)) fail();
  }
  if (!['language', 'security', 'set', 'as'].every(v => seen.has(v))
      || ['stable', 'immutable', 'volatile'].filter(v => seen.has(v)).length > 1) fail();
  functionBody(body, language);
  return parsed.signature;
}

function functionPrivilege(ts, functions) {
  let i = 1;
  if (!(keyword(ts[i], 'execute') || keyword(ts[0], 'revoke') && keyword(ts[i], 'all'))) fail();
  i++;
  if (keyword(ts[i - 1], 'all') && keyword(ts[i], 'privileges')) i++;
  if (!keyword(ts[i++], 'on') || !keyword(ts[i++], 'function')) fail();
  const parsed = functionSignature(ts, i);
  const revoked = functions.get(parsed.signature);
  if (!revoked) fail();
  i = parsed.end;
  if (keyword(ts[0], 'grant')) {
    if (!keyword(ts[i++], 'to') || !identifier(ts[i]) || ts[i++].value !== 'authenticated'
        || i !== ts.length || !revoked.has('public') || !revoked.has('anon')) fail();
  } else {
    if (!keyword(ts[i++], 'from')) fail();
    const roles = [];
    while (i < ts.length) {
      if (!identifier(ts[i]) || !['public', 'anon', 'service_role'].includes(ts[i].value)) fail();
      roles.push(ts[i++].value);
      if (i < ts.length && (!symbol(ts[i++], ',') || i === ts.length)) fail();
    }
    if (!roles.length || new Set(roles).size !== roles.length) fail();
    roles.forEach(role => revoked.add(role));
  }
}

export function validateSQL(sql, { mode, version, name, migrationSQL }) {
  if (!modes.includes(mode) || !/^[0-9]{14}$/.test(version) || !/^[a-z0-9][a-z0-9_]{0,80}$/.test(name)) fail();
  const lines = sql.trimEnd().split(/\r?\n/);
  if (!/^begin;$/i.test(lines[0].trim()) || !/^commit;$/i.test(lines.at(-1).trim())) fail();
  const ss = statements(tokens(sql));
  if (ss[0]?.length !== 1 || ss[0][0].value !== 'begin' || ss.at(-1)?.length !== 1 || ss.at(-1)[0].value !== 'commit') fail();
  let inserts = 0; let deletes = 0;
  const targets = new Set(); const functions = new Map();
  let pairedFunctions;
  for (const ts of ss.slice(1, -1)) {
    const flattened = flat(ts); const c = code(flattened);
    const root = code(ts);
    if (keyword(ts[0], 'create') && (keyword(ts[1], 'function') || keyword(ts[1], 'or'))) {
      if (mode === 'rollback') fail();
      const signature = functionDefinition(ts);
      if (functions.has(signature)) fail();
      functions.set(signature, new Set());
      continue;
    }
    if (['grant', 'revoke'].includes(root[0]) && (root.some(v => ['function', 'functions'].includes(v)) || root[1] === 'execute')) {
      if (mode === 'rollback') fail();
      functionPrivilege(ts, functions);
      continue;
    }
    if (keyword(ts[0], 'drop') && keyword(ts[1], 'function')) {
      if (mode !== 'rollback' || typeof migrationSQL !== 'string') fail();
      checkRisks(ts);
      let start = 2;
      if (keyword(ts[start], 'if') && keyword(ts[start + 1], 'exists')) start += 2;
      const parsed = functionSignature(ts, start);
      if (parsed.end !== ts.length) fail();
      pairedFunctions ??= new Set(validateSQL(migrationSQL, { mode: 'apply', version, name }).functions);
      if (!pairedFunctions.has(parsed.signature)) fail();
      continue;
    }
    // Case-sensitive / Unicode escaped identifiers cannot be normalized into
    // reliable backup targets. Reject this unsupported syntax, rather than
    // backing up a different table or overlooking an escaped role name.
    checkRisks(ts);
    if (c[0] === 'grant' && c.slice(c.indexOf('to') + 1).some(v => ['anon', 'public', 'authenticated'].includes(v))) fail();
    if (!['set', 'lock', 'do', 'alter', 'create', 'insert', 'update', 'delete', 'drop', 'grant', 'revoke'].includes(root[0])) fail();
    if (root[0] === 'set' && !(root[1] === 'local' && ['lock_timeout', 'statement_timeout'].includes(root[2]))) fail();
    if (root[0] === 'do') {
      if (ts.filter(t => t.kind === 'block').length !== 1 || c.some(v => ['insert', 'update', 'delete', 'create', 'alter', 'drop', 'grant', 'revoke', 'commit', 'rollback', 'perform'].includes(v))) fail();
      // Pure text helpers only, for whitespace-insensitive deparsed CHECK comparison.
      const assertionCalls = new Set(['if', 'exists', 'in', 'not', 'and', 'or', 'count', 'length', 'num_nonnulls', 'coalesce', 'to_regclass', 'btrim', 'regexp_replace']);
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
  // CREATE defaults to PUBLIC EXECUTE even if there is no explicit GRANT.
  // Every definition must therefore revoke both client entry paths.
  if ([...functions.values()].some(roles => !roles.has('public') || !roles.has('anon'))) fail();
  if (targets.size > 16) fail();
  return { targets: [...targets].sort(), functions: [...functions.keys()].sort(), risks: '통과: 차단 목록·기록 일치·트랜잭션 경계 확인' };
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

// Static, conservative label extraction from a precheck/postcheck SQL. Only string
// literals in these shapes are read: `'label' [::type] as item` anywhere, and the
// first select-list literal of a `union [all] select 'label' [::type] ,`
// branch. Labels produced by expressions, concatenation or the first branch
// written as `select 'label',` (no alias) cannot be parsed and are NOT checked here;
// the run phase still checks every label at runtime.
export function extractItemLabels(sql) {
  const ts = tokens(sql).filter(t => t.kind !== 'block');
  const isItem = t => t && ['word', 'quoted'].includes(t.kind) && t.value.toLowerCase() === 'item';
  const labels = [];
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].kind !== 'string') continue;
    let j = i + 1;
    if (ts[j]?.value === ':' && ts[j + 1]?.value === ':' && ts[j + 2]?.kind === 'word') j += 3;
    const aliased = ts[j]?.kind === 'word' && ts[j].value === 'as' && isItem(ts[j + 1]);
    const afterUnion = ts[i - 1]?.value === 'select' && ts[i - 1].kind === 'word'
      && (ts[i - 2]?.value === 'union' || ts[i - 2]?.value === 'all' && ts[i - 3]?.value === 'union')
      && ts[j]?.kind === 'symbol' && ts[j].value === ',';
    if (aliased || afterUnion) labels.push(ts[i].value);
  }
  return labels;
}
export const unsafeCheckLabels = sql => extractItemLabels(sql).filter(label => !CHECK_LABEL_RE.test(label));

export function prepareMigration({ mode, version, runId, root }) {
  if (!modes.includes(mode) || !/^[0-9]{14}$/.test(version) || !/^[1-9][0-9]{0,19}$/.test(runId)) fail();
  const path = choose(root, 'supabase/migrations', new RegExp(`^${version}_.*\\.sql$`), true);
  const name = path.slice('supabase/migrations/'.length + 15, -4);
  const migration = safeFile(root, path);
  // Strict grammar first (unchanged). Apply/dry-run may fall back to the
  // expanded rules, which refuse every access-widening pattern by reason code.
  let strict = true;
  try { validateSQL(migration.sql, { mode: 'apply', version, name }); }
  catch (error) {
    if (mode === 'rollback') throw error;
    strict = false;
  }
  const expanded = strict ? null : validateExpanded(migration.sql, { version, name });
  const rollbackPath = choose(root, 'docs', new RegExp(`^${version}_.*\\.rollback\\.sql$`), mode === 'rollback' || !strict);
  if (rollbackPath && rollbackPath !== `docs/${version}_${name}.rollback.sql`) fail();
  const file = mode === 'rollback' ? safeFile(root, rollbackPath) : migration;
  const validation = expanded ?? validateSQL(file.sql, { mode, version, name, migrationSQL: migration.sql });
  if (expanded) {
    // The expanded path needs every pair file: precheck/snapshot/postcheck/rollback.
    for (const suffix of ['precheck', 'snapshot', 'postcheck']) {
      const exclude = suffix === 'postcheck' ? '(?!.*\\.dry-run\\.postcheck\\.sql$)' : '';
      const found = choose(root, 'docs', new RegExp(`^${version}_${exclude}.*\\.${suffix}\\.sql$`), false);
      if (found !== `docs/${version}_${name}.${suffix}.sql`) throw new ExpandedRejection('pair-missing');
    }
  }
  const summaryPath = choose(root, 'docs', new RegExp(`^${version}_.*\\.summary\\.md$`), true);
  if (summaryPath !== `docs/${version}_${name}.summary.md`) fail();
  const summaryFile = safeFile(root, summaryPath, 4096);
  const summaryLines = summaryFile.sql.trim().split(/\r?\n/);
  if (summaryLines.length !== 3 || !['무엇이 바뀌나:', '잘못되면:', '되돌리는 법:'].every((prefix, i) => summaryLines[i].startsWith(prefix) && summaryLines[i].length > prefix.length)) fail();
  const checks = {};
  let manualSnapshotRequired = false;
  const suffixes = mode === 'dry-run' ? ['precheck', 'postcheck', 'dry-run.postcheck'] : ['precheck', 'postcheck'];
  for (const suffix of suffixes) {
    // The mode-specific file must not count as a second apply postcheck.
    const excludeDryRun = suffix === 'postcheck' ? '(?!.*\\.dry-run\\.postcheck\\.sql$)' : '';
    const checkPath = choose(root, 'docs', new RegExp(`^${version}_${excludeDryRun}.*\\.${suffix.replaceAll('.', '\\.')}\\.sql$`), false);
    if (checkPath) {
      if (checkPath !== `docs/${version}_${name}.${suffix}.sql`) fail();
      const check = safeFile(root, checkPath, 65_536);
      const checked = { ...check, ...checkSQL(check.sql) };
      if (unsafeCheckLabels(check.sql).length) throw new ExpandedRejection('check-label');
      if (mode === 'dry-run' && suffix === 'postcheck') {
        // Preserve the existing manual snapshot requirement without selecting
        // or executing an applied-state check after rollback.
        manualSnapshotRequired = checked.baselineNull;
      } else checks[suffix === 'dry-run.postcheck' ? 'dryRunPostcheck' : suffix] = checked;
    }
  }
  for (const kind of ['precheck', 'postcheck']) if (checks[kind]) checks[kind].expect = parseExpectations(checks[kind].sql);
  let snapshot = null;
  if (mode !== 'rollback') {
    const snapshotPath = choose(root, 'docs', new RegExp(`^${version}_.*\\.snapshot\\.sql$`), false);
    if (snapshotPath) {
      if (snapshotPath !== `docs/${version}_${name}.snapshot.sql`) fail();
      snapshot = safeFile(root, snapshotPath, 65_536);
      try { checkSQL(snapshot.sql); checkSnapshotSQL(snapshot.sql); snapshot.artifact = true; }
      catch (error) {
        // Expanded path: a snapshot that could carry row values is a refusal.
        // Strict path keeps its earlier behavior (manual snapshot, no artifact).
        if (!strict) throw error instanceof ExpandedRejection ? new ExpandedRejection('snapshot-rows') : error;
        snapshot.artifact = false;
      }
    }
  }
  // Full single-approval flow (precheck → snapshot artifact → dry-run → apply →
  // postcheck) whenever every pair file exists; the expanded rules require it.
  const pairs = ['precheck', 'postcheck'].every(kind => choose(root, 'docs',
    new RegExp(`^${version}_${name}\\.${kind}\\.sql$`), false)) && Boolean(rollbackPath) && snapshot?.artifact === true;
  // Strict-rule files opt in with `-- expect:` lines in the precheck (older
  // migrations keep their earlier flow and outputs); expanded files always run full.
  const optedIn = !strict || (checks.precheck?.expect?.size ?? 0) > 0;
  const flow = mode !== 'rollback' && optedIn && pairs && checks.precheck && !checks.precheck.baselineNull
    && !manualSnapshotRequired && !checks.postcheck?.baselineNull ? 'full' : 'legacy';
  if (!strict && flow !== 'full') throw new ExpandedRejection('pair-missing');
  // A table created by this same migration has no earlier rows: never back it up
  // (the copy would fail before the table exists).
  const fresh = mode === 'rollback' ? new Set() : createdTables(migration.sql);
  return { mode, version, name, runId, file, summaryFile, summaryLines, checks, snapshot, manualSnapshotRequired, flow,
    rollbackPath, rules: strict ? 'strict' : 'expanded', ...validation, targets: validation.targets.filter(t => !fresh.has(t)) };
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
    + (plan.mode === 'dry-run' ? 'dry-run은 precheck를 전후 같은 읽기 전용 SQL로 비교합니다. 집계가 없거나 baseline NULL이면 수동 snapshot 확인 필요이며 검증 미완료입니다. 적용용 postcheck는 실행하지 않습니다.\n\n' : '')
    + (plan.mode === 'dry-run' && plan.manualSnapshotRequired ? '기존 postcheck의 baseline NULL: 수동 snapshot 확인 필요를 유지합니다. 적용용 SQL은 선택하거나 실행하지 않습니다.\n\n' : '')
    + Object.entries(plan.checks).map(([kind, file]) => `### ${kind} (읽기 전용)\n\n파일: \`${file.path}\` · SHA256: \`${file.sha256}\` · 줄 수: ${file.lines}\n\n`
      + (file.baselineNull ? 'baseline NULL: 실행하지 않고 수동 확인 필요로 표시합니다.\n\n' : '') + sqlBlock(file.sql)).join('\n');
}
