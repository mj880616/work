import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// MTG-녹음1분조각 DB: 녹음 구간 조각 수 상한 16 → 64(같은 이름 검사를 다시 만듦). 권한·정책·칸 변경 없음.
const version='20261030120000',stem=`${version}_meeting_recording_pieces_64`;
const strip=s=>s.replace(/--.*$/gm,'');
const code=strip(readFileSync(`supabase/migrations/${stem}.sql`,'utf8'));
const rollback=strip(readFileSync(`docs/${stem}.rollback.sql`,'utf8'));

test('migration: only the pieces check changes (16 → 64), other conditions kept, no grant/policy/function, record row, strict rules',()=>{
 assert.doesNotMatch(code,/\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|security definer|disable row level|create (?:or replace )?function|create table|add column|drop column|rtw_/i);
 assert.equal((code.match(/alter table/g)||[]).length,2);
 assert.match(code,/alter table public\.app_meeting_recordings drop constraint app_meeting_recordings_pieces_check;/);
 const add=code.match(/add constraint app_meeting_recordings_pieces_check check \(([\s\S]*?)\);\n/)[1];
 const old=strip(readFileSync('supabase/migrations/20261029200000_meeting_recordings.sql','utf8')).match(/constraint app_meeting_recordings_pieces_check check \(([\s\S]*?)\),\n/)[1];
 // 상한 숫자만 다르다.
 assert.equal(add.replace(/\s+/g,' ').trim(),old.replace(/\s+/g,' ').trim().replace('<= 16','<= 64'));
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261030120000', 'meeting_recording_pieces_64'/);
 for(const mode of ['apply','dry-run','rollback']){
  const plan=prepareMigration({mode,version,runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'strict');assert.deepEqual(plan.targets,['app_meeting_recordings']);
  if(mode!=='rollback'){assert.equal(plan.flow,'full');assert.equal(plan.summaryLines.length,3)}
 }
});

test('rollback: narrows back to 16 only when no segment holds more, deletes only this record',()=>{
 assert.match(rollback,/where piece_ids\[17\] is not null\)/);
 assert.match(rollback,/add constraint app_meeting_recordings_pieces_check check \(\s*cardinality\(piece_ids\) <= 16\b/);
 assert.doesNotMatch(rollback,/\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|update public|delete from public/i);
 assert.match(rollback,/delete from supabase_migrations\.schema_migrations\s+where version = '20261030120000' and name = 'meeting_recording_pieces_64';\s*commit;\s*$/);
});

test('pair checks: catalog only for the snapshot, no information_schema in read-only checks, summary says DB before Edge',()=>{
 assert.doesNotMatch(readFileSync(`docs/${stem}.snapshot.sql`,'utf8'),/information_schema|from public\.app_/i);
 for(const f of ['precheck','postcheck'])assert.doesNotMatch(strip(readFileSync(`docs/${stem}.${f}.sql`,'utf8')),/information_schema/i);
 const summary=readFileSync(`docs/${stem}.summary.md`,'utf8');
 assert.match(summary,/이 적용을 먼저 하고 서버 함수를 배포/);
});
