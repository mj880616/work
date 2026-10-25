import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPlan} from '../../app/press-import-model.mjs';

// PRESS-자료실편입: 가져오기 결과를 Web1 원본 목록과 대조하는 운영 확인 SQL은 읽기 전용(select 한 문장)이고 비밀값·개인정보가 없다.
const sql=readFileSync(new URL('../../docs/ops/press-import-check.sql',import.meta.url),'utf8');
const code=sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
const statements=code.split(/;\s*$/m).map(x=>x.trim()).filter(Boolean);

test('press import check SQL is one read-only statement',()=>{
  assert.equal(statements.length,1);
  assert.match(statements[0],/^with\b[\s\S]*\bselect\b/i);
  const noStrings=code.replace(/'(?:[^']|'')*'/g,"''");
  assert.doesNotMatch(noStrings,/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|call|do)\b\s/i);
  assert.doesNotMatch(noStrings,/\bfor\s+update\b|\bpg_sleep|set_config|nextval/i);
  assert.match(code,/public\.app_documents/);
});
test('press import check SQL expected list equals the import plan (archive.json + off-list + attachments)',()=>{
  const {plan,errors}=buildPlan(JSON.parse(readFileSync(new URL('../../press/archive.json',import.meta.url),'utf8')));
  assert.deepEqual(errors,[]);
  assert.equal(plan.length,48);
  const rows=[...code.matchAll(/^\s+\('((?:[^']|'')*)', '(page|attachment)', date '(\d{4}-\d{2}-\d{2})', '((?:[^']|'')*)', '((?:[^']|'')*)'\),?$/gm)]
    .map(m=>({file_name:m[1].replace(/''/g,"'"),kind:m[2],date:m[3],label:m[4].replace(/''/g,"'"),title:m[5].replace(/''/g,"'")}));
  assert.deepEqual(rows,plan.map(r=>({file_name:r.fileName,kind:r.kind,date:r.fields.document_date,label:r.fields.tags[0]||'',title:r.fields.title})));
  assert.equal(new Set(rows.map(r=>r.file_name)).size,rows.length);
});
test('press import check SQL carries no secrets, emails, phone numbers or ids',()=>{
  assert.doesNotMatch(sql,/eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\d{2,3}-\d{3,4}-\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
