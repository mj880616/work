// OPS-DB워크플로정책교체: the approved DB workflow accepts a policy replacement (same name, same table) only when it
// cannot widen access. Static rules + comparison with the production definition (fake DB here). No database, no production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateExpanded, ExpandedRejection, compareReplacements, policyLookupSQL, REJECT_REASONS } from '../../scripts/ops/db-migration-expanded.mjs';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';
import { runFullPlan } from '../../scripts/ops/db-migration-run.mjs';

const version = '20261099000000';
const name = 'policy_replace_example';
const wrap = body => `begin;\nset local lock_timeout = '5s';\n${body}\ninsert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array['test']);\ncommit;\n`;
const drop = 'drop policy app_notes_owner on public.app_notes;';
const create = (tail = 'for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id))') =>
  `create policy app_notes_owner on public.app_notes ${tail};`;
const reason = sql => {
  try { validateExpanded(sql, { version, name }); return 'accepted'; }
  catch (error) { assert.ok(error instanceof ExpandedRejection, error.message); return error.reason; }
};

test('policy replacement: same name, same table, authenticated only, real conditions -> accepted and reported', () => {
  const ok = [
    `${drop}\n${create()}`,
    `drop policy if exists app_notes_owner on public.app_notes;\n${create('as permissive for all to authenticated using (private.app_is_workspace_owner(workspace_id))')}`,
    `${drop}\n${create('for select to authenticated using (private.app_is_workspace_owner(workspace_id))')}`,
    `${drop}\n${create('for insert to authenticated with check (private.app_is_workspace_owner(workspace_id))')}`,
  ];
  for (const body of ok) assert.equal(reason(wrap(body)), 'accepted', body);
  const result = validateExpanded(wrap(`${drop}\n${create()}`), { version, name });
  assert.deepEqual(result.policyReplacements.map(r => [r.table, r.name, r.cmd, r.permissive, r.roles.join()]), [['app_notes', 'app_notes_owner', 'all', true, 'authenticated']]);
});

test('policy replacement: every widening or malformed replacement is refused', () => {
  const refused = [
    ['anon added', `${drop}\n${create('for all to authenticated, anon using (private.app_is_workspace_owner(workspace_id))')}`, 'policy-drop-alter'],
    ['PUBLIC role', `${drop}\n${create('for all to public using (private.app_is_workspace_owner(workspace_id))')}`, 'policy-drop-alter'],
    ['no TO (default PUBLIC)', `${drop}\n${create('for all using (private.app_is_workspace_owner(workspace_id))')}`, 'policy-drop-alter'],
    ['service_role', `${drop}\n${create('for all to service_role using (private.app_is_workspace_owner(workspace_id))')}`, 'policy-drop-alter'],
    ['using (true)', `${drop}\n${create('for all to authenticated using (true)')}`, 'policy-drop-alter'],
    ['with check (true)', `${drop}\n${create('for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (true)')}`, 'policy-drop-alter'],
    ['using (1 = 1)', `${drop}\n${create('for all to authenticated using (1 = 1)')}`, 'policy-drop-alter'],
    ['true inside or', `${drop}\n${create('for all to authenticated using (private.app_is_workspace_owner(workspace_id) or true)')}`, 'policy-drop-alter'],
    ['empty expression', `${drop}\n${create('for all to authenticated using ()')}`, 'policy-drop-alter'],
    ['no expression', `${drop}\n${create('for all to authenticated')}`, 'policy-drop-alter'],
    ['different name', `${drop}\ncreate policy app_notes_other on public.app_notes for all to authenticated using (private.app_is_workspace_owner(workspace_id));`, 'policy-existing-table'],
    ['different table', `${drop}\ncreate policy app_notes_owner on public.app_tasks for all to authenticated using (private.app_is_workspace_owner(workspace_id));`, 'policy-existing-table'],
    ['drop without create', drop, 'policy-drop-alter'],
    ['create before drop', `${create()}\n${drop}`, 'policy-existing-table'],
    ['dropped twice', `${drop}\n${drop}\n${create()}`, 'policy-drop-alter'],
    ['drop on a table of another schema', 'drop policy app_notes_owner on private.app_notes;', 'policy-drop-alter'],
    ['drop cascade', 'drop policy app_notes_owner on public.app_notes cascade;', 'policy-drop-alter'],
    ['alter policy', 'alter policy app_notes_owner on public.app_notes using (true);', 'policy-drop-alter'],
    ['unknown clause', `${drop}\n${create('for all to authenticated using (private.app_is_workspace_owner(workspace_id)) bogus')}`, 'policy-drop-alter'],
    ['select policy with check', `${drop}\n${create('for select to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id))')}`, 'policy-drop-alter'],
  ];
  for (const [label, body, expected] of refused) assert.equal(reason(wrap(body)), expected, label);
  assert.ok(Object.hasOwn(REJECT_REASONS, 'policy-rollback'));
});

test('comparison with the production definition: same or narrower passes, anything else stops', () => {
  const r = (over = {}) => ({ name: 'p', table: 't', cmd: 'all', permissive: true, roles: ['authenticated'], rollback: { roles: ['authenticated'], cmd: 'all', permissive: true }, ...over });
  const row = (over = {}) => ({ tbl: 't', name: 'p', permissive: 'PERMISSIVE', cmd: 'ALL', roles: 'authenticated', ...over });
  assert.equal(compareReplacements([r()], [row()]).ok, true);
  assert.equal(compareReplacements([r({ cmd: 'select', rollback: { roles: ['authenticated'], cmd: 'all', permissive: true } })], [row()]).ok, true, 'narrower command');
  assert.equal(compareReplacements([r()], [row({ roles: 'public' })]).ok, false, 'rollback would not restore PUBLIC');
  assert.equal(compareReplacements([r({ rollback: { roles: ['public'], cmd: 'all', permissive: true } })], [row({ roles: 'public' })]).ok, true, 'narrower role than PUBLIC');
  const bad = {
    'role widened': [r({ roles: ['authenticated'] }), row({ roles: 'service_role' })],
    'command widened': [r(), row({ cmd: 'SELECT' })],
    'restrictive vs permissive': [r(), row({ permissive: 'RESTRICTIVE' })],
    'rollback differs': [r({ rollback: { roles: ['authenticated'], cmd: 'select', permissive: true } }), row()],
    'rollback missing': [r({ rollback: undefined }), row()],
    'odd role text': [r(), row({ roles: 'authenticated;drop' })],
  };
  for (const [label, [rep, old]] of Object.entries(bad)) assert.equal(compareReplacements([rep], [old]).ok, false, label);
  assert.equal(compareReplacements([r()], []).ok, false, 'policy not found');
  assert.equal(compareReplacements([r()], [row(), row()]).ok, false, 'duplicate rows');
  assert.equal(compareReplacements([r()], null).ok, false, 'unreadable');
  assert.match(policyLookupSQL([r()]), /pg_catalog\.pg_policies/);
  assert.throws(() => policyLookupSQL([r({ name: "p'; drop" })]));
});

const repo = new URL('../../', import.meta.url).pathname;
const stem = '20261026170000_library_folders_free';
test('library_folders_free (#1269) now passes the dry-run and apply plan checks as an expanded full flow', () => {
  for (const mode of ['dry-run', 'apply']) {
    const plan = prepareMigration({ mode, version: '20261026170000', runId: '1', root: repo });
    assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
    assert.equal(plan.policyReplacements.length, 1);
    assert.equal(plan.policyReplacements[0].name, 'library_folder_items_owner_all');
    assert.deepEqual(plan.policyReplacements[0].rollback, { roles: ['authenticated'], cmd: 'all', permissive: true });
  }
  assert.throws(() => prepareMigration({ mode: 'rollback', version: '20261026170000', runId: '1', root: repo }));
});

test('rollback file without the original policy, or a missing pair file, is refused at plan time', () => {
  const root = mkdtempSync(join(tmpdir(), 'db-policy-'));
  try {
    mkdirSync(join(root, 'supabase/migrations'), { recursive: true }); mkdirSync(join(root, 'docs'));
    copyFileSync(new URL(`../../supabase/migrations/${stem}.sql`, import.meta.url), join(root, `supabase/migrations/${stem}.sql`));
    for (const f of ['summary.md', 'precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql']) copyFileSync(new URL(`../../docs/${stem}.${f}`, import.meta.url), join(root, `docs/${stem}.${f}`));
    const run = () => prepareMigration({ mode: 'apply', version: '20261026170000', runId: '1', root });
    assert.doesNotThrow(run);
    const rb = join(root, `docs/${stem}.rollback.sql`); const good = readFileSync(rb, 'utf8');
    writeFileSync(rb, good.replace('drop policy library_folder_items_owner_all', 'drop policy library_folder_items_other'));
    assert.throws(run, e => e.reason === 'policy-rollback', 'rollback does not drop the policy');
    writeFileSync(rb, good.replace('create policy library_folder_items_owner_all', 'create policy library_folder_items_other'));
    assert.throws(run, e => e.reason === 'policy-rollback', 'rollback does not recreate the policy');
    writeFileSync(rb, good);
    rmSync(rb);
    assert.throws(run, 'pair file missing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('run phase: the production definition is read first; a wider or unreadable result writes nothing', async () => {
  const plan = prepareMigration({ mode: 'apply', version: '20261026170000', runId: '1', root: repo });
  const row = (over = {}) => ({ tbl: 'app_library_folder_items', name: 'library_folder_items_owner_all', permissive: 'PERMISSIVE', cmd: 'ALL', roles: 'authenticated', ...over });
  const fake = policyRows => {
    const sent = [];
    const query = async (sql, opts) => {
      sent.push({ sql, readOnly: opts?.readOnly === true });
      if (sql.includes('schema_migrations')) return [{ count: 0 }];
      if (sql.includes('pg_policies')) { if (policyRows instanceof Error) throw policyRows; return policyRows; }
      throw new Error('stop after comparison');
    };
    return { query, sent };
  };
  // Same definition: the comparison passes and the run moves on (our fake then stops it at the precheck).
  let f = fake([row()]);
  let result = await runFullPlan(plan, f.query);
  assert.match(result.summary, /정책 교체 비교: 1개 모두 같거나 좁음/);
  assert.ok(f.sent.every(s => s.readOnly), 'only read-only requests before the comparison passes');
  // PUBLIC in production: rollback would not restore it -> stop.
  for (const [label, rows] of [['rollback differs', [row({ roles: 'public' })]], ['command differs', [row({ cmd: 'SELECT' })]], ['restrictive', [row({ permissive: 'RESTRICTIVE' })]],
    ['not found', []], ['duplicate', [row(), row()]], ['lookup error', new Error('x')]]) {
    f = fake(rows);
    result = await runFullPlan(plan, f.query);
    assert.equal(result.ok, false, label);
    assert.match(result.summary, /쓰기 요청 전송: 아니오/, label);
    assert.ok(f.sent.every(s => s.readOnly), label);
    assert.doesNotMatch(result.summary, /정책 교체 비교: 1개/, label);
  }
});
