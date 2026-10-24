// DB 판 번호(supabase/migrations 파일 이름 앞 14자리) 겹침 검사.
// 두 PR이 같은 번호를 쓰면 승인형 DB workflow(version=파일 이름)와 schema_migrations 기록이 서로 가려진다.
// merge 전 CI에서 잡는다. 파일 이름 모양과 번호 중복만 본다(SQL 내용은 보지 않는다).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';

const names=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort();
const versionOf=n=>n.slice(0,14);

test('migration file names are <14-digit version>_<name>.sql',()=>{
  const bad=names.filter(n=>!/^\d{14}_[a-z0-9_]+\.sql$/.test(n));
  assert.deepEqual(bad,[],`이름 모양이 다른 migration: ${bad.join(', ')}`);
});

test('migration versions are unique (no two PRs share a version number)',()=>{
  const seen=new Map();
  for(const n of names){
    const v=versionOf(n);
    seen.set(v,[...(seen.get(v)||[]),n]);
  }
  const dup=[...seen].filter(([,files])=>files.length>1).map(([v,files])=>`${v}: ${files.join(' / ')}`);
  assert.deepEqual(dup,[],`판 번호가 겹치는 migration: ${dup.join('; ')}`);
});
