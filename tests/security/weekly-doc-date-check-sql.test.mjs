import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// WEEKLY-자료날짜: 잘못 붙은 자료 날짜 건수를 세는 운영 확인 SQL은 읽기 전용(select 한 문장)이고, 제목·파일 이름·내용을 내보내지 않는다(건수·연도만).
const sql=readFileSync(new URL('../../docs/ops/weekly-doc-date-check.sql',import.meta.url),'utf8');
const code=sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
const statements=code.split(/;\s*$/m).map(x=>x.trim()).filter(Boolean);

test('weekly doc date check SQL is one read-only statement that outputs counts and years only',()=>{
  assert.equal(statements.length,1);
  assert.match(statements[0],/^with\b[\s\S]*\bselect\b/i);
  const noStrings=code.replace(/'(?:[^']|'')*'/g,"''");
  assert.doesNotMatch(noStrings,/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|call|do)\b\s/i);
  assert.doesNotMatch(noStrings,/\bfor\s+update\b|\bpg_sleep|set_config|nextval|information_schema/i);
  assert.match(code,/from public\.app_documents doc/);
  // 바깥 select 목록은 kind·연도·origin·건수뿐(name·title·file_name을 내보내지 않음).
  const outer=statements[0].slice(statements[0].search(/\)\s*\nselect\b/i)+1);
  const parts=outer.split(/\bunion all\b/i);
  assert.equal(parts.length,5);
  for(const part of parts.map(p=>p.slice(p.search(/\bselect\b/i)))){
    const list=part.slice(0,part.search(/\bfrom\b/i));
    assert.doesNotMatch(list,/\b(name|title|file_name|description|extracted_text)\b/,list);
  }
});
