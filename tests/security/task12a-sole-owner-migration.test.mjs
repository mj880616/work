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
  const rollbackPolicies=new Set(declarations(files.rollback,'policy'));
  for(const policy of policies) assert.ok(rollbackPolicies.has(policy),`rollback does not restore ${policy}`);

  const functions=declarations(files.migration,'function');
  const rollbackFunctions=new Set(declarations(files.rollback,'function'));
  for(const fn of functions) assert.ok(rollbackFunctions.has(fn),`rollback does not restore ${fn}`);
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
