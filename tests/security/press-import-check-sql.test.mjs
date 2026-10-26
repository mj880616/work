import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

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
test('press import check SQL expected list covers press/archive.json, the 2 off-list posts and the 4 attachments',()=>{
  const archive=JSON.parse(readFileSync(new URL('../../press/archive.json',import.meta.url),'utf8'));
  const rows=[...code.matchAll(/^\s+\('((?:[^']|'')*)', '(page|attachment)', date '(\d{4}-\d{2}-\d{2})', '((?:[^']|'')*)', '((?:[^']|'')*)'\),?$/gm)]
    .map(m=>({file_name:m[1].replace(/''/g,"'"),kind:m[2],date:m[3],label:m[4].replace(/''/g,"'"),title:m[5].replace(/''/g,"'")}));
  const pages=rows.filter(r=>r.kind==='page'),attachments=rows.filter(r=>r.kind==='attachment');
  assert.equal(rows.length,48);
  assert.equal(pages.length,44);
  assert.equal(attachments.length,4);
  assert.equal(new Set(rows.map(r=>r.file_name)).size,rows.length);
  // 목록(archive.json) 42건은 날짜·제목·구분이 모두 맞는 글 줄이 하나씩 있다.
  assert.equal(archive.items.length,42);
  for(const item of archive.items){
    const hit=pages.filter(r=>r.date===item.date&&r.title===String(item.title).replace(/\s+/g,' ').trim()&&r.label===item.type_label);
    assert.equal(hit.length,1,item.title);
  }
  // 목록 밖 옛 글 2건(결정 Q3 ①).
  for(const name of ['2024-09-04-public-rail-policy-conference.html','2024-09-09-public-rail-policy-conference.html'])assert.ok(pages.some(r=>r.file_name===name),name);
  // 첨부는 원본 파일 이름 그대로이고 글 폴더 안에 실제로 있다.
  for(const row of attachments){
    const folder=pages.find(r=>r.title===row.title&&r.date===row.date);
    assert.ok(folder,row.file_name);
    assert.ok(existsSync(new URL(`../../press/${folder.file_name.replace(/\.html$/,'')}/${row.file_name}`,import.meta.url)),row.file_name);
  }
});
test('press import check SQL carries no secrets, emails, phone numbers or ids',()=>{
  assert.doesNotMatch(sql,/eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\d{2,3}-\d{3,4}-\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
