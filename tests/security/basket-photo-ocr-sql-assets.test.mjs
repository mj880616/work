import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareMigration,checkSQL,tokens} from '../../scripts/ops/db-migration-plan.mjs';
const version='20261013034836',stem=version+'_basket_photo_ocr_db';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/'+stem+'.sql');
const sqlCode=sql=>tokens(sql).filter(t=>!['string','block'].includes(t.kind)).map(t=>t.value).join(' ');
test('photo preparation pairs apply/dry-run/unused rollback and registers exactly one authenticated RPC',()=>{
 for(const mode of ['apply','dry-run','rollback']){
  const plan=prepareMigration({mode,version,runId:'9451',root:new URL('../../',import.meta.url).pathname});
  assert.deepEqual(plan.targets,['app_notes']);
  if(mode!=='rollback')assert.deepEqual(plan.functions,['public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)']);
  assert.equal(plan.checks.precheck.baselineNull,false);
  if(mode==='dry-run')assert.equal(plan.checks.dryRunPostcheck.baselineNull,false);
 }
 const code=sqlCode(migration);
 assert.doesNotMatch(code,/create table|alter policy|grant (?:select|insert|update|delete)|disable row level security|rtw_|security definer|cascade/i);
 assert.equal((code.match(/create function/g)||[]).length,1);
 assert.match(migration,/security invoker set search_path = ''/);
 assert.match(migration,/revoke all on function public\.app_basket_update_attachment_ocr\(uuid,timestamptz,jsonb,jsonb\) from public, anon, service_role/);
});
test('photo inspection and used-recovery assets are SELECT only and never perform cleanup or discard OCR',()=>{
 for(const suffix of ['version-check','snapshot','precheck','postcheck','dry-run.postcheck','preserve','recovery']){
  const sql=read('docs/'+stem+'.'+suffix+'.sql');assert.equal(checkSQL(sql).baselineNull,false,suffix);
  assert.doesNotMatch(sqlCode(sql),/\b(?:insert|update|delete|drop|alter|create|grant|revoke|execute|call|copy|set)\b/,suffix);
 }
 const rollback=read('docs/'+stem+'.rollback.sql');assert.match(rollback,/OCR_DATA_PRESERVATION_REQUIRED/);
 assert.match(rollback,/drop function public\.app_basket_update_attachment_ocr\(uuid,timestamptz,jsonb,jsonb\)/);
 assert.doesNotMatch(sqlCode(rollback),/\bupdate\b|app_basket_confirm_links|app_basket_update_link_summary|cascade/);
});
test('postcheck binds exact RPC source and production gate explicitly checks trigger/default ACL uncertainty',()=>{
 const body=tokens(migration).filter(t=>t.kind==='block').find(t=>t.value.includes('v_note public.app_notes%rowtype')).value;
 const hash=createHash('md5').update(body).digest('hex');assert.ok(read('docs/'+stem+'.postcheck.sql').includes(hash));
 const pre=read('docs/'+stem+'.precheck.sql');assert.match(pre,/pg_trigger/);assert.match(pre,/pg_default_acl/);assert.match(pre,/btrim\(regexp_replace\(pg_get_constraintdef\(oid\),'\\s\+',' ','g'\)\)=btrim\(regexp_replace\('CHECK \('\|\|'/);
 const recovery=read('docs/'+stem+'.recovery.md');assert.match(recovery,/운영.*미확인/);assert.match(recovery,/사용 후/);assert.match(recovery,/forward fix/);
});

test('unused rollback embeds the same exact RPC source and verifies validation/history/ACL before paired DROP',()=>{
 const body=tokens(migration).filter(t=>t.kind==='block').find(t=>t.value.includes('v_note public.app_notes%rowtype')).value;
 const rollback=read('docs/'+stem+'.rollback.sql');const block=tokens(rollback).find(t=>t.kind==='block'&&t.value.includes('prosrc='));const assertion=tokens(block.value);const index=assertion.findIndex(t=>t.kind==='word'&&t.value==='prosrc');assert.equal(assertion[index+2].kind,'string');assert.equal(assertion[index+2].value,body);
 assert.match(block.value,/convalidated/);assert.match(block.value,/proconfig=/);assert.match(block.value,/proacl=/);assert.match(block.value,/statements=array/);assert.match(block.value,/PHOTO_OCR_ROLLBACK_CHANGED/);
 assert.ok(rollback.indexOf('PHOTO_OCR_ROLLBACK_CHANGED')<rollback.indexOf('alter table public.app_notes drop constraint'));
 const pre=read('docs/'+stem+'.precheck.sql');assert.match(pre,/supported function defaults/);assert.match(pre,/pg_auth_members/);
});

test('photo preparation binds every CHECK attestation and declares PostgreSQL version gate before newer catalog columns',()=>{
 for(const suffix of ['precheck','postcheck','dry-run.postcheck','rollback'])assert.match(read('docs/'+stem+'.'+suffix+'.sql'),/connamespace='public'::regnamespace and conname='app_notes_attachments_check'/,suffix);
 assert.match(migration,/connamespace='public'::regnamespace and conname='app_notes_attachments_check'/);
 assert.ok(migration.indexOf('PHOTO_OCR_POSTGRES_VERSION_UNSUPPORTED')<migration.indexOf('pg_auth_members'));
 const versionSQL=read('docs/'+stem+'.version-check.sql');assert.match(versionSQL,/160000/);assert.doesNotMatch(sqlCode(versionSQL),/pg_auth_members|inherit_option|set_option/);
 assert.match(read('docs/'+stem+'.snapshot.sql'),/version-check/);assert.match(read('docs/'+stem+'.recovery.md'),/PostgreSQL 16/);assert.match(read('docs/'+stem+'.recovery.md'),/17\.6/);
});

test('read-only gates do not depend on the endpoint role and CHECK text compares whitespace-insensitively',()=>{
 for(const suffix of ['precheck','postcheck','dry-run.postcheck']){
  const sql=read('docs/'+stem+'.'+suffix+'.sql');
  // information_schema filters by table owner and current_user is the read-only role.
  assert.doesNotMatch(sqlCode(sql),/information_schema|current_user/,suffix);
  assert.doesNotMatch(sql,/check_clause\s*=\s*'/,suffix);
  assert.match(sql,/btrim\(regexp_replace\(pg_get_constraintdef\(oid\),'\\s\+',' ','g'\)\)/,suffix);
 }
 for(const [file,sql] of [['migration',migration],['rollback',read('docs/'+stem+'.rollback.sql')]]){
  assert.doesNotMatch(sql,/check_clause\s*=\s*'/,file);
  assert.match(sql,/btrim\(regexp_replace\(check_clause,'\\s\+',' ','g'\)\)=btrim\(regexp_replace\('\n/,file);
 }
 // Exact allowlist: NOINHERIT authenticator and Supabase Realtime admin only.
 for(const sql of [migration,read('docs/'+stem+'.precheck.sql'),read('docs/'+stem+'.postcheck.sql')]){
  const lists=[...sql.matchAll(/rolname in\(([^)]*)\) and not rolinherit/g)].map(m=>m[1]);
  assert.ok(lists.length>=1);for(const list of lists)assert.equal(list,"'authenticator','supabase_realtime_admin'");
  assert.doesNotMatch(sql,/rolname='authenticator'/);
 }
});
