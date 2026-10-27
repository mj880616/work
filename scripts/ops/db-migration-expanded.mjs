// Expanded static rules for approved apply/dry-run (DB-승인형확장, 2026-10-21).
// The strict grammar in db-migration-plan.mjs still runs first. A migration it
// rejects may pass here only when it adds policies, table grants, triggers or
// functions without widening access. Every refusal has a fixed reason code so
// the plan summary can say why, without echoing SQL text or data.
import { tokens } from './db-migration-plan.mjs';

export const REJECT_REASONS = {
  'check-label': '확인 SQL(precheck/postcheck)의 항목 이름에 허용되지 않는 문자(허용: 글자·숫자·공백과 _ / ( ) = : + . , · -; 세미콜론·따옴표 등 불가, 100자 이하)',
  structure: '파일 구조(begin/commit·문장 끝·주석)',
  history: 'migration 기록 INSERT 불일치(version/name·위치·개수)',
  'quoted-identifier': '대소문자 구분·특수문자 따옴표 식별자',
  rtw: 'RTW(rtw_) 객체 언급',
  'blocked-command': '차단 명령(drop table/schema·truncate·role·extension·copy·call·dblink·파일 읽기 등)',
  'transaction-control': '중간 트랜잭션 제어(savepoint·commit·rollback 등)',
  'rls-disable': 'RLS 끄기·force 해제(권한 확대)',
  'trigger-disable': '트리거·규칙 끄기',
  'owner-change': '소유자 변경',
  'unknown-statement': '허용 목록 밖 명령(view·schema·sequence·type·alter function·default privileges·drop 등)',
  'set-other': 'set local lock_timeout/statement_timeout 외 설정',
  'do-block': '읽기 확인 외 DO 블록(쓰기·DDL·perform·동적 실행)',
  'table-target': 'public 스키마 밖 표·이름 형식',
  'create-table-as': 'CREATE TABLE ... AS/LIKE(자료 복사)',
  'table-without-rls': '새 public 표에 RLS 켜기 없음(기본 anon 권한 노출)',
  'alter-table': '허용 밖 ALTER TABLE(이름 바꾸기·DROP CASCADE·스키마 이동)',
  'where-missing': '최상위 WHERE 없는 UPDATE/DELETE',
  'insert-target': 'public 밖 INSERT',
  'grant-anon-public': 'anon·PUBLIC(또는 허용 밖 역할)에 권한 부여(권한 확대)',
  'grant-option': 'WITH GRANT OPTION',
  'grant-bulk': '스키마 전체·schema·sequence·역할 멤버십 권한 부여',
  'grant-existing': '이번 파일에서 만들지 않은 기존 표·함수에 권한 추가(권한 확대)',
  'policy-roles': '허용 정책의 대상이 anon·PUBLIC이거나 대상 역할 생략(기본 PUBLIC)',
  'policy-true': '허용 정책의 USING/WITH CHECK가 무조건 참(true)',
  'policy-existing-table': '기존 표에 새 허용(permissive) 정책 추가(넓어질 수 있음)',
  'policy-drop-alter': '기존 정책 ALTER, 또는 DROP POLICY가 "같은 이름·같은 표로 다시 만드는 교체"의 조건을 벗어남(짝 없음·표 바뀜·TO 없음/authenticated 밖·항상 참 조건·빈 식·형식 오류)',
  'policy-rollback': '정책 교체의 rollback 파일에 원래 정책을 되살리는 DROP+CREATE 짝이 없음',
  'function-shape': '함수 정의 형식(스키마·이름·언어·옵션·본문)',
  'function-definer-path': 'SECURITY DEFINER인데 search_path 고정 없음',
  'function-body': '함수 본문 안 DDL·권한 변경·트랜잭션 제어·동적 EXECUTE·세션 설정',
  'function-duplicate': '같은 함수 이름을 한 파일에서 두 번 정의',
  'function-revoke-missing': '새·교체 함수의 PUBLIC·anon 실행권 회수 없음(기본 PUBLIC 실행 = 권한 확대)',
  'function-grant-order': '함수 실행권 부여가 정의·PUBLIC/anon 회수보다 먼저',
  'trigger-shape': '트리거 형식(public 표·이번 파일에서 만든 함수만)',
  'too-many-targets': '백업 대상 기존 표 16개 초과',
  'pair-missing': '짝 파일 없음(precheck·snapshot·postcheck·rollback·summary 모두 필요)',
  'snapshot-rows': 'snapshot이 시스템 카탈로그 밖(앱 표·사용자 함수·통계)을 읽음 — 공개 artifact에 행 값 위험',
  'expect-format': 'expect 주석 형식 오류',
};

export class ExpandedRejection extends Error {
  constructor(reason) {
    const safe = Object.hasOwn(REJECT_REASONS, reason) ? reason : 'structure';
    super(`DB plan rejected (expanded rules): ${safe}`);
    this.name = 'ExpandedRejection';
    this.reason = safe;
  }
}
const reject = reason => { throw new ExpandedRejection(reason); };

const isCode = t => t.kind !== 'string' && t.kind !== 'block';
const code = ts => ts.filter(isCode).map(t => t.value.toLowerCase());
const keyword = (t, value) => t?.kind === 'word' && t.value === value;
const symbol = (t, value) => t?.kind === 'symbol' && t.value === value;
const simpleName = t => t && ['word', 'quoted'].includes(t.kind) && /^[a-z_][a-z0-9_]*$/.test(t.value) && t.value.length <= 63;
function lex(sql) {
  try { return tokens(sql); } catch { return reject('structure'); }
}
function statements(ts) {
  const out = []; let current = [];
  for (const t of ts) {
    if (symbol(t, ';')) { if (current.length) out.push(current); current = []; }
    else current.push(t);
  }
  if (current.length) reject('structure');
  return out;
}
const flat = ts => ts.flatMap(t => t.kind === 'block' ? lex(t.value) : [t]);
function topLevel(ts) {
  // Tokens outside any parentheses.
  const out = []; let depth = 0;
  for (const t of ts) {
    if (symbol(t, '(')) depth++;
    if (depth === 0) out.push(t);
    if (symbol(t, ')')) depth--;
  }
  return out;
}
const has = (words, seq) => {
  const text = ` ${words.join(' ')} `;
  return text.includes(` ${seq} `);
};

const BLOCKED = [
  'drop table', 'drop schema', 'drop owned', 'truncate', 'create role', 'alter role', 'drop role', 'create user', 'alter user',
  'create extension', 'alter extension', 'drop extension', 'alter default privileges', 'alter system', 'set role',
  'set session', 'reset role', 'security label', 'create server', 'create foreign', 'create publication', 'create subscription',
  'create rule', 'create event trigger', 'import foreign schema', 'reassign owned', 'load',
];
const BLOCKED_WORDS = new Set(['copy', 'call', 'vacuum', 'cluster', 'checkpoint', 'listen', 'notify', 'lo_import', 'lo_export',
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'set_config', 'nextval', 'setval', 'pg_terminate_backend',
  'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile', 'bypassrls', 'superuser', 'createrole', 'leakproof']);
function commonRisks(ts) {
  const all = flat(ts);
  if (all.some(t => t.kind === 'quoted' && !/^[a-z_][a-z0-9_]*$/.test(t.value))) reject('quoted-identifier');
  if (all.some(t => /rtw_/i.test(t.value))) reject('rtw');
  const c = code(all);
  // In GRANT/REVOKE, TRUNCATE is a privilege name, not the command.
  const privilege = ['grant', 'revoke'].includes(c[0]);
  if (c.some(v => BLOCKED_WORDS.has(v) || /^dblink/.test(v))
      || BLOCKED.some(seq => !(privilege && seq === 'truncate') && has(c, seq))
      || has(c, 'u &')) reject('blocked-command');
  if (c.some(v => ['savepoint', 'commit', 'rollback', 'abort'].includes(v))) reject('transaction-control');
  if (has(c, 'disable row level security') || has(c, 'no force row level security')) reject('rls-disable');
  if (has(c, 'disable trigger') || has(c, 'disable rule')) reject('trigger-disable');
  if (has(c, 'owner to')) reject('owner-change');
  return c;
}

function publicTable(ts, i) {
  // Accepts `public.<name>`; returns [name, next index].
  if (!keyword(ts[i], 'public') || !symbol(ts[i + 1], '.') || !simpleName(ts[i + 2])) reject('table-target');
  return [ts[i + 2].value, i + 3];
}
function tableList(ts, i) {
  const names = [];
  for (;;) {
    if (keyword(ts[i], 'only')) i++;
    const [name, next] = publicTable(ts, i);
    names.push(name); i = next;
    if (!symbol(ts[i], ',')) return [names, i];
    i++;
  }
}
function roleList(ts, i, reason) {
  const roles = [];
  for (;;) {
    if (keyword(ts[i], 'group')) i++;
    const t = ts[i];
    if (!t || !['word', 'quoted'].includes(t.kind)) reject(reason);
    roles.push(t.value.toLowerCase()); i++;
    if (!symbol(ts[i], ',')) return [roles, i];
    i++;
  }
}
// Function references `schema.name(args)`, possibly several separated by commas.
function functionRefs(ts, i) {
  const names = [];
  for (;;) {
    if (!simpleName(ts[i]) || !['public', 'private'].includes(ts[i].value) || !symbol(ts[i + 1], '.') || !simpleName(ts[i + 2])
        || !symbol(ts[i + 3], '(')) reject('function-shape');
    names.push(`${ts[i].value}.${ts[i + 2].value}`);
    let depth = 0; i += 3;
    for (; i < ts.length; i++) {
      if (symbol(ts[i], '(')) depth++;
      if (symbol(ts[i], ')') && --depth === 0) break;
    }
    if (depth !== 0) reject('function-shape');
    i++;
    if (!symbol(ts[i], ',')) return [names, i];
    i++;
  }
}

const READ_GUARD_WRITES = new Set(['insert', 'update', 'delete', 'create', 'alter', 'drop', 'grant', 'revoke', 'commit', 'rollback',
  'perform', 'execute', 'truncate', 'merge', 'lock', 'set', 'reset', 'call', 'copy']);
function doBlock(ts) {
  const blocks = ts.filter(t => t.kind === 'block');
  if (blocks.length !== 1 || ts.filter(isCode).length !== 1) reject('do-block');
  const body = lex(blocks[0].value);
  if (body.some(t => t.kind === 'block')) reject('do-block');
  const c = code(body);
  if (c.some(v => READ_GUARD_WRITES.has(v))) reject('do-block');
  // Schema-qualified calls only to pg_catalog; no user-defined function side effects.
  for (let i = 0; i + 3 < body.length; i++) {
    if (body[i].kind === 'word' && symbol(body[i + 1], '.') && body[i + 2].kind === 'word' && symbol(body[i + 3], '(')
        && body[i].value !== 'pg_catalog') reject('do-block');
  }
}

const FUNCTION_OPTIONS = new Set(['language', 'security', 'set', 'as', 'stable', 'immutable', 'volatile', 'strict', 'called',
  'returns', 'on', 'null', 'input', 'parallel', 'safe', 'unsafe', 'restricted', 'cost', 'rows', 'invoker', 'definer', 'external']);
function functionBody(block) {
  const body = lex(block.value);
  if (!body.length || body.some(t => t.kind === 'block')) reject('function-body');
  commonRisks(body);
  const c = code(body);
  if (c.some(v => ['create', 'alter', 'drop', 'grant', 'revoke', 'commit', 'rollback', 'savepoint', 'supabase_migrations',
    'execute', 'truncate', 'reset'].includes(v))) reject('function-body');
  for (let i = 0; i < c.length - 1; i++) {
    // UPDATE ... SET is data; session SET/role/search_path is not.
    if (c[i] === 'set' && ['local', 'session', 'role', 'search_path', 'constraints', 'transaction', 'time'].includes(c[i + 1])) reject('function-body');
  }
  if (c[0] === 'set') reject('function-body');
  for (let i = 0; i < body.length; i++) {
    if (!keyword(body[i], 'update') && !keyword(body[i], 'delete')) continue;
    if (keyword(body[i], 'update') && keyword(body[i - 1], 'for')) continue; // row lock
    if (keyword(body[i], 'update') && keyword(body[i - 1], 'on')) continue; // ON UPDATE in DDL text is already refused
    let depth = 0; let found = false;
    for (let j = i + 1; j < body.length; j++) {
      if (symbol(body[j], '(')) depth++;
      if (symbol(body[j], ')') && --depth < 0) break;
      if (depth === 0 && (symbol(body[j], ';') || keyword(body[j], 'returning') || keyword(body[j], 'loop'))) break;
      if (depth === 0 && keyword(body[j], 'where')) { found = true; break; }
    }
    if (!found) reject('where-missing');
  }
}
function functionDefinition(ts) {
  commonRisks(ts.filter(t => t.kind !== 'block'));
  let i = 1;
  if (keyword(ts[i], 'or') && keyword(ts[i + 1], 'replace')) i += 2;
  if (!keyword(ts[i], 'function')) reject('function-shape');
  i++;
  if (!simpleName(ts[i]) || !['public', 'private'].includes(ts[i].value) || !symbol(ts[i + 1], '.') || !simpleName(ts[i + 2])
      || !symbol(ts[i + 3], '(')) reject('function-shape');
  const name = `${ts[i].value}.${ts[i + 2].value}`;
  // Skip argument list, then RETURNS ..., then options.
  let depth = 0; i += 3;
  for (; i < ts.length; i++) {
    if (symbol(ts[i], '(')) depth++;
    if (symbol(ts[i], ')') && --depth === 0) break;
  }
  i++;
  if (!keyword(ts[i], 'returns')) reject('function-shape');
  const blocks = ts.filter(t => t.kind === 'block');
  if (blocks.length !== 1) reject('function-shape');
  const options = topLevel(ts.slice(i)).filter(isCode).map(t => t.value);
  let language = null; let security = null; let searchPath = 0;
  for (let k = 0; k < options.length; k++) {
    if (options[k] === 'language') language = options[k + 1];
    if (options[k] === 'security') security = options[k + 1];
    if (options[k] === 'set') {
      if (options[k + 1] !== 'search_path') reject('function-shape');
      searchPath++;
    }
    if (options[k] === 'window' || options[k] === 'leakproof' || options[k] === 'transform' || options[k] === 'support') reject('function-shape');
  }
  if (!['sql', 'plpgsql'].includes(language) || searchPath > 1 || !['invoker', 'definer', null].includes(security)
      || options.filter(v => v === 'language').length !== 1 || options.filter(v => v === 'security').length > 1) reject('function-shape');
  if (security === 'definer' && searchPath !== 1) reject('function-definer-path');
  // The body must be the dollar block right after AS.
  const asIndex = ts.findIndex((t, k) => k > i && keyword(t, 'as') && ts[k + 1]?.kind === 'block');
  if (asIndex < 0) reject('function-shape');
  functionBody(ts[asIndex + 1]);
  return { name, definer: security === 'definer' };
}

function grantStatement(ts, state) {
  const c = code(ts);
  const top = topLevel(ts).filter(isCode).map(t => t.value);
  if (has(c, 'with grant option') || has(c, 'with admin option') || has(c, 'granted by')) reject('grant-option');
  const toIndex = top.lastIndexOf('to');
  if (!top.includes('on') || toIndex < 0) reject('grant-bulk'); // role membership grant
  // Grantee list: everything after the top-level TO.
  const tsTop = topLevel(ts);
  const toTok = tsTop.findLastIndex(t => keyword(t, 'to'));
  const [roles, end] = roleList(tsTop, toTok + 1, 'grant-anon-public');
  if (end !== tsTop.length) reject('grant-anon-public');
  if (roles.some(r => !['authenticated', 'service_role'].includes(r))) reject('grant-anon-public');
  const onTok = tsTop.findIndex(t => keyword(t, 'on'));
  let i = onTok + 1;
  if (['all', 'schema', 'sequence', 'sequences', 'database', 'tablespace', 'language', 'type', 'domain', 'foreign', 'large', 'parameter',
    'procedure', 'procedures', 'routine', 'routines', 'functions', 'tables'].includes(tsTop[i]?.value)) reject('grant-bulk');
  if (keyword(tsTop[i], 'function')) {
    // Must be EXECUTE only.
    const privileges = top.slice(1, top.indexOf('on'));
    if (privileges.join(' ') !== 'execute') reject('grant-bulk');
    const fullOn = ts.findIndex(t => keyword(t, 'on'));
    const [names] = functionRefs(ts, fullOn + 2);
    for (const name of names) {
      const fn = state.functions.get(name);
      if (!fn) reject('grant-existing');
      if (!fn.revoked.has('public') || !fn.revoked.has('anon')) reject('function-grant-order');
      fn.grants.push(...roles);
    }
    return;
  }
  if (keyword(tsTop[i], 'table')) i++;
  const [tables, end2] = tableList(tsTop, i);
  if (!keyword(tsTop[end2], 'to')) reject('grant-bulk');
  for (const table of tables) if (!state.createdTables.has(table)) reject('grant-existing');
}

function revokeStatement(ts, state) {
  const top = topLevel(ts).filter(isCode).map(t => t.value);
  if (!top.includes('from')) return; // role membership revoke narrows; nothing to record
  const onTok = ts.findIndex(t => keyword(t, 'on'));
  if (onTok < 0 || !keyword(ts[onTok + 1], 'function')) return; // table/schema revoke narrows access
  const [names, end] = functionRefs(ts, onTok + 2);
  if (!keyword(ts[end], 'from')) reject('function-shape');
  const [roles] = roleList(ts, end + 1, 'function-shape');
  for (const name of names) {
    const fn = state.functions.get(name);
    if (fn) roles.forEach(r => fn.revoked.add(r));
  }
}

// --- Policy replacement (OPS-DB워크플로정책교체) ------------------------------
// `drop policy X on public.T;` is accepted only when the same file later runs
// `create policy X on public.T ...` again (same name, same table) and the new
// policy does not widen access. What the new policy is compared against (the
// current roles / command / permissive of production) cannot be read from files:
// compareReplacements() does that against pg_policies in the run phase, and any
// failure to read or compare refuses the run before anything is written.
const POLICY_COMMANDS = new Set(['all', 'select', 'insert', 'update', 'delete']);
const policyFail = () => reject('policy-drop-alter');
function groupAfter(ts, open) {
  // Tokens strictly inside the parenthesis opened at ts[open]; returns [inner, next index].
  if (!symbol(ts[open], '(')) policyFail();
  let depth = 0;
  for (let k = open; k < ts.length; k++) {
    if (symbol(ts[k], '(')) depth++;
    if (symbol(ts[k], ')') && --depth === 0) return [ts.slice(open + 1, k), k + 1];
  }
  return policyFail();
}
function alwaysTrue(inner) {
  const words = inner.filter(isCode).map(t => t.value.toLowerCase());
  return words.includes('true') || has(words, '1 = 1');
}
/** Parses `create policy <name> on public.<table> [as ..] [for ..] [to ..] [using (..)] [with check (..)]`. */
export function parsePolicy(ts, fail = policyFail) {
  if (!keyword(ts[0], 'create') || !keyword(ts[1], 'policy') || !simpleName(ts[2]) || !keyword(ts[3], 'on')
      || !keyword(ts[4], 'public') || !symbol(ts[5], '.') || !simpleName(ts[6])) fail();
  const out = { name: ts[2].value, table: ts[6].value, permissive: true, cmd: 'all', roles: null, using: null, check: null };
  const seen = new Set();
  let i = 7;
  while (i < ts.length) {
    const t = ts[i];
    const once = key => { if (seen.has(key)) fail(); seen.add(key); };
    if (keyword(t, 'as') && (keyword(ts[i + 1], 'permissive') || keyword(ts[i + 1], 'restrictive'))) {
      once('as'); out.permissive = ts[i + 1].value === 'permissive'; i += 2;
    } else if (keyword(t, 'for') && POLICY_COMMANDS.has(ts[i + 1]?.value)) {
      once('for'); out.cmd = ts[i + 1].value; i += 2;
    } else if (keyword(t, 'to')) {
      once('to');
      const roles = [];
      i++;
      for (;;) {
        if (ts[i]?.kind !== 'word' && ts[i]?.kind !== 'quoted') fail();
        roles.push(ts[i].value.toLowerCase()); i++;
        if (!symbol(ts[i], ',')) break;
        i++;
      }
      out.roles = roles;
    } else if (keyword(t, 'using')) {
      once('using'); const [inner, next] = groupAfter(ts, i + 1); out.using = inner; i = next;
    } else if (keyword(t, 'with') && keyword(ts[i + 1], 'check')) {
      once('check'); const [inner, next] = groupAfter(ts, i + 2); out.check = inner; i = next;
    } else fail();
  }
  return out;
}
const policyKey = (table, name) => `${table}.${name}`;
function checkReplacementPolicy(p) {
  // Roles must be named and only `authenticated`: no default PUBLIC, anon or service_role.
  if (!p.roles || !p.roles.length || p.roles.some(r => r !== 'authenticated')) policyFail();
  // The expressions that apply to this command must exist, be non-empty and not always true.
  for (const expr of [p.using, p.check]) if (expr && (!expr.length || alwaysTrue(expr))) policyFail();
  if (p.cmd === 'insert' ? !p.check : !p.using) policyFail();
  if (['select', 'delete'].includes(p.cmd) && p.check) policyFail();
  if (p.cmd === 'insert' && p.using) policyFail();
}
function dropPolicyStatement(ts, state) {
  let i = 2;
  if (keyword(ts[i], 'if') && keyword(ts[i + 1], 'exists')) i += 2;
  if (!simpleName(ts[i]) || !keyword(ts[i + 1], 'on') || !keyword(ts[i + 2], 'public') || !symbol(ts[i + 3], '.')
      || !simpleName(ts[i + 4]) || i + 5 !== ts.length) policyFail();
  const name = ts[i].value; const table = ts[i + 4].value;
  const key = policyKey(table, name);
  if (state.createdTables.has(table) || state.dropped.has(key) || state.replacements.some(r => policyKey(r.table, r.name) === key)) policyFail();
  state.dropped.set(key, { name, table });
}

function policyStatement(ts, state) {
  const top0 = topLevel(ts);
  if (simpleName(top0[2]) && keyword(top0[3], 'on') && keyword(top0[4], 'public') && symbol(top0[5], '.') && simpleName(top0[6])
      && state.dropped.has(policyKey(top0[6].value, top0[2].value))) {
    // Replacement of a policy dropped earlier in this file.
    const p = parsePolicy(ts);
    checkReplacementPolicy(p);
    state.dropped.delete(policyKey(p.table, p.name));
    state.replacements.push({ name: p.name, table: p.table, cmd: p.cmd, permissive: p.permissive, roles: p.roles });
    return;
  }
  const top = topLevel(ts);
  const c = top.filter(isCode).map(t => t.value);
  // create policy <name> on public.<table> [as permissive|restrictive] [for cmd] [to roles] [using (...)] [with check (...)]
  if (!simpleName(top[2]) || !keyword(top[3], 'on')) reject('policy-roles');
  const [table, after] = publicTable(top, 4);
  const restrictive = keyword(top[after], 'as') && keyword(top[after + 1], 'restrictive');
  if (restrictive) return; // restrictive policies can only narrow access
  if (!state.createdTables.has(table)) reject('policy-existing-table');
  const toTok = top.findIndex(t => keyword(t, 'to'));
  if (toTok < 0) reject('policy-roles');
  const [roles] = roleList(top, toTok + 1, 'policy-roles');
  if (roles.some(r => !['authenticated', 'service_role'].includes(r))) reject('policy-roles');
  // USING (true) / WITH CHECK (true): literal always-true expression.
  const text = code(ts).join(' ');
  if (/\b(?:using|check) \( (?:true|1 = 1|\( true \)) \)/.test(text)) reject('policy-true');
  void c;
}

function triggerStatement(ts, state) {
  const top = topLevel(ts);
  const words = top.filter(isCode).map(t => t.value);
  const onTok = top.findIndex(t => keyword(t, 'on'));
  if (onTok < 0) reject('trigger-shape');
  publicTable(top, onTok + 1);
  const exec = top.findIndex(t => keyword(t, 'execute'));
  if (exec < 0 || !['function', 'procedure'].includes(top[exec + 1]?.value)) reject('trigger-shape');
  const fullExec = ts.findIndex((t, k) => keyword(t, 'execute') && ['function', 'procedure'].includes(ts[k + 1]?.value));
  const [names, end] = functionRefs(ts, fullExec + 2);
  if (names.length !== 1 || end !== ts.length || !state.functions.has(names[0])) reject('trigger-shape');
  if (words.filter(v => v === 'execute').length !== 1) reject('trigger-shape');
}

function historyInsert(ts, version, name) {
  const c = code(ts);
  if (c.slice(0, 5).join(' ') !== 'insert into supabase_migrations . schema_migrations') reject('history');
  const top = topLevel(ts);
  const words = top.filter(isCode).map(t => t.value);
  if (words.some(v => ['select', 'on', 'returning', 'default'].includes(v)) || words.filter(v => v === 'values').length !== 1) reject('history');
  const open = ts.findIndex(t => symbol(t, '('));
  const columns = []; let i = open + 1;
  for (; i < ts.length && !symbol(ts[i], ')'); i++) if (!symbol(ts[i], ',')) columns.push(ts[i].value);
  if (new Set(columns).size !== columns.length || !columns.includes('version') || !columns.includes('name')
      || columns.some(v => !['version', 'name', 'statements'].includes(v))) reject('history');
  const valuesAt = ts.findIndex(t => keyword(t, 'values'));
  if (!symbol(ts[valuesAt + 1], '(') || !symbol(ts.at(-1), ')')) reject('history');
  const values = []; let current = []; let depth = 0;
  for (const t of ts.slice(valuesAt + 2, -1)) {
    if (symbol(t, '(') || symbol(t, '[')) depth++;
    if (symbol(t, ')') || symbol(t, ']')) depth--;
    if (depth === 0 && symbol(t, ',')) { values.push(current); current = []; } else current.push(t);
  }
  values.push(current);
  if (values.length !== columns.length) reject('history');
  for (const [column, expected] of [['version', version], ['name', name]]) {
    const v = values[columns.indexOf(column)];
    if (v.length !== 1 || v[0].kind !== 'string' || v[0].value !== expected) reject('history');
  }
  const statementsValue = values[columns.indexOf('statements')];
  if (statementsValue && code(statementsValue).some(v => !['array', '[', ']', ','].includes(v))) reject('history');
}

const where = ts => topLevel(ts).some(t => keyword(t, 'where'));

/**
 * Expanded validation for apply/dry-run. Returns the same shape as validateSQL
 * plus `expanded: true` and a human-review list (definer functions, policies,
 * grants) for the plan summary.
 */
export function validateExpanded(sql, { version, name }) {
  if (!/^[0-9]{14}$/.test(version) || !/^[a-z0-9][a-z0-9_]{0,80}$/.test(name)) reject('structure');
  const lines = sql.trimEnd().split(/\r?\n/);
  if (!/^begin;$/i.test(lines[0].trim()) || !/^commit;$/i.test(lines.at(-1).trim())) reject('structure');
  const ss = statements(lex(sql));
  if (ss.length < 3 || code(ss[0]).join(' ') !== 'begin' || code(ss.at(-1)).join(' ') !== 'commit') reject('structure');
  const state = { createdTables: new Set(), rlsTables: new Set(), functions: new Map(), dropped: new Map(), replacements: [] };
  const targets = new Set();
  const review = { definer: [], policies: 0, restrictive: 0, grants: 0, triggers: 0, revokes: 0 };
  let inserts = 0;
  const body = ss.slice(1, -1);
  body.forEach((ts, index) => {
    const root = code(ts);
    if (root[0] === 'create' && (root[1] === 'function' || root[1] === 'or' && root[3] === 'function')) {
      const fn = functionDefinition(ts);
      if (state.functions.has(fn.name)) reject('function-duplicate');
      state.functions.set(fn.name, { revoked: new Set(), grants: [], definer: fn.definer });
      if (fn.definer) review.definer.push(fn.name);
      return;
    }
    const c = commonRisks(ts);
    if (c.includes('supabase_migrations') && root[0] !== 'do') {
      if (root[0] !== 'insert' || index !== body.length - 1) reject('history');
      historyInsert(ts, version, name); inserts++;
      return;
    }
    switch (root[0]) {
      case 'set':
        if (!(root[1] === 'local' && ['lock_timeout', 'statement_timeout'].includes(root[2]))) reject('set-other');
        return;
      case 'lock': {
        let i = 1; if (keyword(ts[i], 'table')) i++;
        tableList(ts, i); return;
      }
      case 'do': doBlock(ts); return;
      case 'create': {
        if (root[1] === 'table') {
          let i = 2;
          if (keyword(ts[i], 'if') && keyword(ts[i + 1], 'not') && keyword(ts[i + 2], 'exists')) i += 3;
          const [table] = publicTable(ts, i);
          const top = topLevel(ts).filter(isCode).map(t => t.value);
          if (top.includes('as') || top.includes('like') || code(ts).includes('like') && code(ts).includes('including')) reject('create-table-as');
          state.createdTables.add(table);
          return;
        }
        if (root[1] === 'index' || root[1] === 'unique' && root[2] === 'index') {
          const onTok = ts.findIndex(t => keyword(t, 'on'));
          let i = onTok + 1; if (keyword(ts[i], 'only')) i++;
          publicTable(ts, i); return;
        }
        if (root[1] === 'policy') { policyStatement(ts, state); review.policies++; if (code(topLevel(ts)).join(' ').includes('as restrictive')) review.restrictive++; return; }
        if (root[1] === 'trigger' || root[1] === 'constraint' && root[2] === 'trigger'
            || root[1] === 'or' && root[2] === 'replace' && root[3] === 'trigger') { triggerStatement(ts, state); review.triggers++; return; }
        return reject('unknown-statement');
      }
      case 'alter': {
        if (root[1] !== 'table') return reject(root[1] === 'policy' ? 'policy-drop-alter' : 'unknown-statement');
        let i = 2;
        if (keyword(ts[i], 'if') && keyword(ts[i + 1], 'exists')) i += 2;
        if (keyword(ts[i], 'only')) i++;
        const [table] = publicTable(ts, i);
        const top = topLevel(ts).filter(isCode).map(t => t.value);
        if (top.includes('rename') && top.includes('to') && !top.includes('constraint') && !top.includes('column')) reject('alter-table');
        if (top.includes('set') && top.includes('schema')) reject('alter-table');
        if (top.includes('drop') && top.includes('cascade')) reject('alter-table');
        if (top.includes('enable') && top.includes('row') && top.includes('level') && top.includes('security')) state.rlsTables.add(table);
        if (!state.createdTables.has(table)) targets.add(table);
        return;
      }
      case 'grant': grantStatement(ts, state); review.grants++; return;
      case 'revoke': revokeStatement(ts, state); review.revokes++; return;
      case 'drop':
        if (root[1] !== 'policy') return reject('unknown-statement');
        dropPolicyStatement(ts, state); return;
      case 'insert': {
        if (root[1] !== 'into') reject('insert-target');
        publicTable(ts, 2); return;
      }
      case 'update': case 'delete': {
        if (!where(ts)) reject('where-missing');
        let i = root[0] === 'update' ? 1 : 2;
        if (root[0] === 'delete' && root[1] !== 'from') reject('unknown-statement');
        if (keyword(ts[i], 'only')) i++;
        const [table] = publicTable(ts, i);
        if (!state.createdTables.has(table)) targets.add(table);
        return;
      }
      default: return reject('unknown-statement');
    }
  });
  if (inserts !== 1) reject('history');
  if (state.dropped.size) reject('policy-drop-alter'); // every dropped policy must be recreated (same name, same table)
  for (const table of state.createdTables) if (!state.rlsTables.has(table)) reject('table-without-rls');
  for (const fn of state.functions.values()) if (!fn.revoked.has('public') || !fn.revoked.has('anon')) reject('function-revoke-missing');
  if (targets.size > 16) reject('too-many-targets');
  return {
    targets: [...targets].sort(), functions: [...state.functions.keys()].sort(), createdTables: [...state.createdTables].sort(),
    expanded: true, review, policyReplacements: state.replacements,
    risks: '확장 규칙 통과: 권한 확대 거절 목록·기록 일치·트랜잭션 경계 확인',
  };
}

/**
 * The rollback file must drop and recreate every replaced policy (same name, same
 * table, drop first). Returns the recreated header (roles / command / permissive)
 * per policy; the run phase checks it against the current production definition,
 * so "rollback restores the original" is verified, not assumed.
 */
export function policyRollbackHeaders(rollbackSql, replacements) {
  const failRollback = () => reject('policy-rollback');
  const ss = statements(lex(rollbackSql));
  return replacements.map(r => {
    const key = policyKey(r.table, r.name);
    const dropAt = ss.findIndex(ts => {
      const c = code(ts);
      if (c[0] !== 'drop' || c[1] !== 'policy') return false;
      let i = 2;
      if (keyword(ts[i], 'if') && keyword(ts[i + 1], 'exists')) i += 2;
      return ts[i]?.value === r.name && keyword(ts[i + 1], 'on') && keyword(ts[i + 2], 'public') && symbol(ts[i + 3], '.')
        && ts[i + 4]?.value === r.table && i + 5 === ts.length;
    });
    if (dropAt < 0) failRollback();
    const create = ss.slice(dropAt + 1).filter(ts => keyword(ts[0], 'create') && keyword(ts[1], 'policy') && ts[2]?.value === r.name
      && keyword(ts[3], 'on') && ts[6]?.value === r.table);
    if (create.length !== 1) failRollback();
    let p;
    try { p = parsePolicy(create[0], failRollback); } catch { return failRollback(); }
    if (policyKey(p.table, p.name) !== key || !p.roles?.length) failRollback();
    return { roles: p.roles, cmd: p.cmd, permissive: p.permissive };
  });
}

const SAFE_ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
/** Read-only lookup of the current definition of each replaced policy (no policy text, no row data). */
export function policyLookupSQL(replacements) {
  const pairs = replacements.map(r => {
    if (!SAFE_ROLE.test(r.table) || !SAFE_ROLE.test(r.name)) throw new Error('Invalid policy identifier');
    return `('${r.table}','${r.name}')`;
  });
  return "select p.tablename::text as tbl, p.policyname::text as name, p.permissive::text as permissive, p.cmd::text as cmd, "
    + "array_to_string(p.roles, ',') as roles from pg_catalog.pg_policies p where p.schemaname = 'public' "
    + `and (p.tablename::text, p.policyname::text) in (${pairs.join(', ')});`;
}
/**
 * Compare each replacement with production's current definition. Fail closed:
 * a missing, duplicate or malformed row, or anything that is not clearly the same
 * or narrower, refuses the run. Returns { ok, lines } (lines are safe to print).
 */
export function compareReplacements(replacements, rows) {
  const lines = []; const readable = Array.isArray(rows); let ok = readable;
  for (const r of replacements) {
    const label = `${r.table}.${r.name}`;
    const found = readable ? rows.filter(row => row && typeof row === 'object' && row.tbl === r.table && row.name === r.name) : [];
    const old = found.length === 1 ? found[0] : null;
    const valid = old && typeof old.permissive === 'string' && /^(PERMISSIVE|RESTRICTIVE)$/.test(old.permissive)
      && typeof old.cmd === 'string' && /^(ALL|SELECT|INSERT|UPDATE|DELETE)$/.test(old.cmd)
      && typeof old.roles === 'string' && old.roles.split(',').every(v => SAFE_ROLE.test(v));
    if (!valid) { ok = false; lines.push(`| \`${label}\` | 운영 정의 확인 불가(없음·중복·형식 오류) | 아니오 |`); continue; }
    const oldRoles = new Set(old.roles.split(','));
    const problems = [];
    if ((old.permissive === 'PERMISSIVE') !== r.permissive) problems.push('permissive/restrictive 바뀜');
    if (old.cmd !== 'ALL' && old.cmd.toLowerCase() !== r.cmd) problems.push('명령 종류 넓어짐');
    if (!oldRoles.has('public') && r.roles.some(role => !oldRoles.has(role))) problems.push('대상 역할 넓어짐');
    if (r.rollback) {
      const back = r.rollback;
      if (back.permissive !== (old.permissive === 'PERMISSIVE') || back.cmd.toUpperCase() !== old.cmd
          || back.roles.length !== oldRoles.size || back.roles.some(role => !oldRoles.has(role))) problems.push('rollback이 원래 정의가 아님');
    } else problems.push('rollback 정의 없음');
    if (problems.length) ok = false;
    lines.push(`| \`${label}\` | 운영: ${old.permissive.toLowerCase()} · ${old.cmd.toLowerCase()} · ${[...oldRoles].join(', ')} → 새: ${r.permissive ? 'permissive' : 'restrictive'} · ${r.cmd} · ${r.roles.join(', ')} | ${problems.length ? '아니오: ' + problems.join(', ') : '예'} |`);
  }
  return { ok, lines };
}

/** Public tables created by the file itself: they have no earlier rows to back up. */
export function createdTables(sql) {
  const out = new Set();
  for (const ts of statements(lex(sql))) {
    const c = code(ts);
    if (c[0] !== 'create' || c[1] !== 'table') continue;
    let i = 2;
    if (c[2] === 'if' && c[3] === 'not' && c[4] === 'exists') i = 5;
    if (c[i] === 'public' && c[i + 1] === '.' && /^[a-z_][a-z0-9_]*$/.test(c[i + 2] ?? '')) out.add(c[i + 2]);
  }
  return out;
}

// --- Pair-file helpers -------------------------------------------------------

const EXPECT_VALUE = /^(?:예|아니오|기록|-?\d{1,18}|\d{1,18}~\d{1,18})$/;
const LABEL = /^[\p{L}\p{N} _/()=:+.,·*-]{1,100}$/u;
/** `-- expect: <item> = <value>` comment lines. value: 예 · 아니오 · 기록 · integer · a~b. */
export function parseExpectations(sql) {
  const map = new Map();
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^\s*--\s*expect:\s*(.+?)\s*=\s*(\S+)\s*$/);
    if (!m) continue;
    if (!LABEL.test(m[1]) || !EXPECT_VALUE.test(m[2]) || map.has(m[1])) throw new ExpandedRejection('expect-format');
    map.set(m[1], m[2]);
  }
  return map;
}
// `-- expect: policy * = 기록` covers every item starting with `policy `.
export function expectationFor(expect, item) {
  if (expect.has(item)) return expect.get(item);
  for (const [key, value] of expect) if (key.endsWith(' *') && item.startsWith(key.slice(0, -1))) return value;
  return undefined;
}
export function meetsExpectation(value, expected) {
  if (expected === '기록') return true;
  if (/^\d+~\d+$/.test(expected)) {
    const [low, high] = expected.split('~').map(Number);
    return /^-?\d+$/.test(value) && Number(value) >= low && Number(value) <= high;
  }
  return value === expected;
}

// Snapshot SQL goes to a workflow artifact. On a public repository artifacts can
// be public, so the snapshot may read only catalog metadata: no application
// table, no user function, no statistics views that hold sample values.
const CATALOGS = new Set(['pg_class', 'pg_attribute', 'pg_attrdef', 'pg_constraint', 'pg_policies', 'pg_trigger', 'pg_policy',
  'pg_proc', 'pg_namespace', 'pg_default_acl', 'pg_index', 'pg_indexes', 'pg_type', 'pg_depend', 'pg_description', 'pg_tables',
  'pg_views', 'pg_sequence', 'pg_sequences', 'pg_inherits', 'pg_am', 'pg_roles', 'pg_auth_members', 'pg_extension', 'pg_enum',
  'pg_rewrite', 'pg_publication_tables']);
const FROM_FUNCTIONS = new Set(['unnest', 'aclexplode', 'generate_series']);
const SNAPSHOT_CALLS = new Set(['coalesce', 'nullif', 'greatest', 'least', 'md5', 'string_agg', 'array_agg', 'array_to_string',
  'count', 'min', 'max', 'sum', 'bool_and', 'bool_or', 'unnest', 'aclexplode', 'acldefault', 'format_type', 'to_regclass',
  'to_regprocedure', 'to_regproc', 'to_regrole', 'to_regnamespace', 'to_regtype', 'length', 'lower', 'upper', 'concat',
  'concat_ws', 'replace', 'regexp_replace', 'btrim', 'trim', 'left', 'right', 'substr', 'array_length', 'cardinality',
  'quote_ident', 'obj_description', 'col_description', 'generate_series', 'array_position', 'current_setting']);
const SNAPSHOT_KEYWORDS = new Set(['select', 'from', 'in', 'exists', 'any', 'all', 'some', 'array', 'cast', 'values', 'filter', 'over',
  'as', 'not', 'and', 'or', 'when', 'then', 'else', 'on', 'where', 'using', 'row', 'join', 'union', 'with', 'by', 'lateral',
  'case', 'distinct', 'is', 'like', 'escape', 'order', 'group', 'having', 'limit', 'between']);
export function checkSnapshotSQL(sql) {
  const ts = lex(sql);
  const words = ts.filter(isCode);
  const ctes = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].kind === 'word' && (keyword(words[i + 1], 'as') && symbol(words[i + 2], '('))) ctes.add(words[i].value);
  }
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (t.kind === 'word' && /^pg_stat|^pg_statistic|^pg_largeobject|^pg_authid|^pg_shadow|^pg_user|_to_xml|^xpath|^query_to|^table_to|^cursor_to|^database_to|^schema_to/.test(t.value)) reject('blocked-command');
    // Every relation after FROM/JOIN must be a catalog, CTE or subquery.
    if (keyword(t, 'from') || keyword(t, 'join')) {
      const next = words[i + 1];
      if (symbol(next, '(')) continue;
      if (next?.kind !== 'word' && next?.kind !== 'quoted') reject('blocked-command');
      if (symbol(words[i + 2], '.')) {
        const schema = next.value; const rel = words[i + 3]?.value;
        if (!(schema === 'pg_catalog' && CATALOGS.has(rel) || schema === 'information_schema'
            || schema === 'supabase_migrations' && rel === 'schema_migrations')) reject('blocked-command');
      } else if (!(CATALOGS.has(next.value) || ctes.has(next.value) || FROM_FUNCTIONS.has(next.value) && symbol(words[i + 2], '('))) {
        reject('blocked-command');
      }
    }
    // Function calls: catalog helpers only; no schema-qualified user function.
    if (t.kind === 'word' && symbol(words[i + 1], '(') && !SNAPSHOT_KEYWORDS.has(t.value) && !ctes.has(t.value)) {
      const qualified = symbol(words[i - 1], '.');
      if (qualified && words[i - 2]?.value !== 'pg_catalog') reject('blocked-command');
      if (!(SNAPSHOT_CALLS.has(t.value) || /^(?:pg_get_|has_[a-z_]+_privilege$)/.test(t.value))) reject('blocked-command');
    }
  }
}
