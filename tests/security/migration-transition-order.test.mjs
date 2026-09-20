import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const ROOT=new URL('../../',import.meta.url);
const expected=[
  ['20260920120000_public_single_post_prepare.sql','ed5bf9979cdd2562a4438adf1698c423ddca617a6a7b6b36168da153f5c4e9c5','5d6ff0a1657a9e40b2702c2597260ecc637a078e94bc6ea14515a1f1f4b1646c'],
  ['20260920121000_project_public_view.sql','c737e45980c99b019e9c0883fde7861d2c35be1c35e29082d01527479b661d5f','eaff2ba212218ad1b33765c3b079b467c67104da65f6c8557ff5fbb2f76ebeb6'],
  ['20260920122000_public_single_post_cutover.sql','5d8c219e65f8c8ed34675431b94561404b2d357cdf2a548ac795f40b686733d0','400b4f19bd2ff65ea54711d2bdffefd6152eb6bf280ee778173213c5ce63fcaf']
];
const forwardRepair='20260921050000_public_workspace_forward_repair.sql';
const sha256=file=>createHash('sha256').update(readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');

test('expand migrations precede cutover with unchanged SQL bodies and rollback pairs',()=>{
  const migrationDir=new URL('supabase/migrations/',ROOT);
  const rollbackDir=new URL('scripts/sql/rollback/',ROOT);
  const actual=readdirSync(migrationDir).filter(name=>name.includes('public_single_post_')||name.includes('project_public_view'));
  assert.deepEqual(actual,expected.map(([name])=>name));
  assert.deepEqual(readdirSync(rollbackDir).filter(name=>name.includes('public_single_post_')||name.includes('project_public_view')).sort(),actual);
  for(const [name,migrationHash,rollbackHash] of expected){
    assert.equal(sha256(new URL(name,migrationDir)),migrationHash,name);
    assert.equal(sha256(new URL(name,rollbackDir)),rollbackHash,`rollback ${name}`);
  }
});

test('forward repair follows the unchanged transition and has a rollback pair',()=>{
  const transitionNames=[...expected.map(([name])=>name),forwardRepair];
  const relevant=name=>transitionNames.includes(name);
  assert.deepEqual(readdirSync(new URL('supabase/migrations/',ROOT)).filter(relevant).sort(),transitionNames);
  assert.deepEqual(readdirSync(new URL('scripts/sql/rollback/',ROOT)).filter(relevant).sort(),transitionNames);
});

test('project public view is independent of the legacy public-post cutover',()=>{
  const projectSql=readFileSync(new URL(`supabase/migrations/${expected[1][0]}`,ROOT),'utf8');
  assert.doesNotMatch(projectSql,/app_public_post|app_open_share|app_pages_public_read|app_public_projects_snapshot|app_public_workspace_snapshot|\bapp_pages\b/i);
});
