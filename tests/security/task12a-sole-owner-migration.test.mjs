import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync} from 'node:fs';

const ROOT=new URL('../../',import.meta.url);
const migrationDir=new URL('supabase/migrations/',ROOT);
const snapshotDir=new URL('scripts/sql/snapshots/',ROOT);
const rollbackDir=new URL('scripts/sql/rollback/',ROOT);

function task12aFiles(){
  const names=readdirSync(migrationDir).filter(name=>/^\d{14}_task12a_sole_owner_db\.sql$/.test(name));
  assert.equal(names.length,1,'exactly one CLI-generated Task 12A migration is required');
  const name=names[0];
  const snapshot=new URL(name,snapshotDir);
  const rollback=new URL(name,rollbackDir);
  assert.equal(existsSync(snapshot),true,`missing production snapshot ${name}`);
  assert.equal(existsSync(rollback),true,`missing rollback ${name}`);
  return {
    name,
    migration:readFileSync(new URL(name,migrationDir),'utf8'),
    snapshot:readFileSync(snapshot,'utf8'),
    rollback:readFileSync(rollback,'utf8')
  };
}

function assertTransaction(sql,label){
  assert.match(sql,/^\s*begin\s*;/i,`${label} must begin transactionally`);
  assert.match(sql,/commit\s*;\s*$/i,`${label} must commit transactionally`);
  assert.match(sql,/set\s+local\s+lock_timeout\s*=\s*'5s'/i,`${label} must bound lock waits`);
  assert.match(sql,/set\s+local\s+statement_timeout\s*=\s*'60s'/i,`${label} must bound execution time`);
}

function declarations(sql,kind){
  if(kind==='policy'){
    return [...sql.matchAll(/create\s+policy\s+(?:"([^"]+)"|([a-zA-Z0-9_]+))\s+on\s+(?:public\.)?(?:"([^"]+)"|([a-zA-Z0-9_]+))/gi)]
      .map(match=>`${match[3]||match[4]}.${match[1]||match[2]}`);
  }
  return [...sql.matchAll(/create\s+or\s+replace\s+function\s+(?:"?([a-zA-Z0-9_]+)"?\.)?"?([a-zA-Z0-9_]+)"?\s*\(([^)]*)\)/gi)]
    .map(match=>`${match[1]||'public'}.${match[2]}(${match[3].replace(/\s+/g,' ').trim()})`);
}

test('Task 12A forward and rollback SQL are paired, bounded, and reversible',()=>{
  const files=task12aFiles();
  assertTransaction(files.migration,'migration');
  assertTransaction(files.rollback,'rollback');

  const policies=declarations(files.migration,'policy');
  assert.ok(policies.length>0,'migration must create at least one reviewed owner-only policy');
  for(const policy of policies){
    const [table,name]=policy.split('.');
    const escapedTable=table.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const escapedName=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(files.rollback,new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"?${escapedName}"?\\s+on\\s+(?:public\\.)?"?${escapedTable}"?`,'i'),`rollback does not remove ${policy}`);
  }

  const functions=declarations(files.migration,'function');
  const rollbackFunctions=new Set(declarations(files.rollback,'function').map(fn=>fn.replace(/\(.*/,'')));
  for(const fn of functions){
    const identity=fn.replace(/\(.*/, '');
    const [schema,name]=identity.split('.');
    const dropped=new RegExp(`drop\\s+function\\s+if\\s+exists\\s+"?${schema}"?\\."?${name}"?\\s*\\(`,'i').test(files.rollback);
    assert.ok(dropped||rollbackFunctions.has(identity),`rollback does not restore or remove ${fn}`);
  }
});

test('Task 12A SQL stays inside the DB/RLS/RPC scope',()=>{
  const {migration,rollback,snapshot}=task12aFiles();
  const mutableSql=`${migration}\n${rollback}`;
  assert.doesNotMatch(mutableSql,/\brtw_/i);
  assert.doesNotMatch(mutableSql,/\bstorage\s*\./i);
  assert.doesNotMatch(mutableSql,/\bapp_google_/i);
  assert.doesNotMatch(mutableSql,/supabase\/functions|document-actions|workspace-drive|library-files|meeting-files|meeting-ai-draft|page-ai-draft|event-media/i);
  assert.doesNotMatch(mutableSql,/delete\s+from\s+public\.app_workspace_members/i);
  assert.doesNotMatch(mutableSql,/drop\s+(?:table|schema)\b/i);
  assert.match(snapshot,/20260925032810/,'snapshot must record the pre-change production migration head');
  assert.match(snapshot,/p\.proname\s+not\s+like\s+'app\\_google\\_%'/i,'snapshot must exclude Google functions');
});

test('Task 12A SQL actor matrix covers all four actors and mandatory regressions',()=>{
  const matrix=readFileSync(new URL('supabase/tests/authz_sole_owner.sql',ROOT),'utf8');
  const workflow=readFileSync(new URL('.github/workflows/authz-security-check.yml',ROOT),'utf8');

  assert.match(matrix,/^begin\s*;/im,'actor matrix must be transactional');
  assert.match(matrix,/^rollback\s*;/im,'actor matrix must roll back every fixture');
  for(const actor of ['anon','non_member','admin','owner']){
    assert.match(matrix,new RegExp(`['\"]${actor}['\"]`),`missing ${actor} actor`);
  }
  for(const surface of ['meetings','documents','events','organizations','profiles','ai','tasks']){
    assert.match(matrix,new RegExp(`['\"]${surface}['\"]`),`missing ${surface} matrix surface`);
  }
  assert.match(matrix,/app_public_post\('task12a-public'\)/i,'public page projection regression is required');
  assert.match(matrix,/public-doc-eeeeeeeeeeee/i,'public document projection regression is required');
  assert.match(matrix,/gimpo-publicization/i,'allowed unlisted projection regression is required');
  assert.match(matrix,/OWNER CRUD UPDATED/i,'owner CRUD regression is required');
  assert.match(workflow,/supabase\/tests\/authz_sole_owner\.sql/,'CI must require the Task 12A actor matrix');
});

test('Task 12A gates active database RPC bypasses while preserving the Web1 projection',()=>{
  const {migration}=task12aFiles();
  for(const fn of [
    'app_can_edit_page_rpc','app_create_invite','app_delete_pages',
    'app_open_share','app_save_page_v2','app_set_workspace_member_role','app_update_event_body'
  ]) assert.match(migration,new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`,'i'),`missing owner gate for ${fn}`);

  for(const signature of [
    'app_accept_invite\\s*\\(text\\)','app_claim_owner\\s*\\(text\\s*,\\s*text\\)',
    'app_request_workspace_access\\s*\\(text\\)','app_respond_project_invitation\\s*\\(uuid\\s*,\\s*boolean\\)',
    'app_public_workspace_snapshot\\s*\\(\\)'
  ]) assert.match(migration,new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+authenticated`,'i'),`missing authenticated revoke for ${signature}`);

  assert.doesNotMatch(migration,/create\s+or\s+replace\s+function\s+public\.app_public_post\s*\(/i,'Web1 public projection body must stay unchanged');
  assert.doesNotMatch(migration,/revoke\s+execute\s+on\s+function\s+public\.app_public_post/i,'Web1 public projection grants must stay unchanged');
  assert.doesNotMatch(migration,/revoke\s+execute\s+on\s+function\s+public\.app_public_workspace_index/i,'public index grant must stay unchanged');
});
