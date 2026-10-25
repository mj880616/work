import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// LEDGER-반영기준점검: 운영 DB에서 '메모만 남긴 고치기' 뒤 약속이 목록에서 빠진 경로를 보는 확인 SQL은 읽기 전용(select만)이고 비밀값·개인정보가 없다.
const sql=readFileSync(new URL('../../docs/ops/ledger-fix-check-1025.sql',import.meta.url),'utf8');
const code=sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
const statements=code.split(';').map(x=>x.trim()).filter(Boolean);
test('ledger fix check SQL is three read-only statements',()=>{
  assert.equal(statements.length,3);
  for(const st of statements) assert.match(st,/^(with\b[\s\S]*\bselect\b|select\b)/i);
  assert.doesNotMatch(code,/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|call|do)\b\s/i);
  assert.doesNotMatch(code,/\bfor\s+update\b/i);
  assert.doesNotMatch(code,/\bpg_sleep|set_config|nextval|app_apply_ledger_fix|app_undo_ledger_fix|app_auto_ledger/i);
});
test('ledger fix check SQL shows no record text columns (title, summary, note, counterparty values)',()=>{
  // 제목 일부 검색 조건에만 title을 쓰고, 결과 칸으로는 내보내지 않는다.
  const selectLists=statements.map(st=>st.split(/\bfrom\b/i)[0]).join('\n');
  assert.doesNotMatch(selectLists,/\br\.title\b|\br\.summary\b|\br\.counterparty\s+as\b|\br\.note\s+as\b/);
});
test('ledger fix check SQL carries no secrets, emails, phone numbers or ids',()=>{
  assert.doesNotMatch(sql,/eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\d{2,3}-\d{3,4}-\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
