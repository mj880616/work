import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// LEDGER-첫화면정리 PR 2: 운영 DB에서 참고 자료 의심 기록을 뽑는 확인 SQL은 읽기 전용(select만)이고 비밀값·개인정보가 없다.
const sql=readFileSync(new URL('../../docs/ops/ledger-auto-reference-check.sql',import.meta.url),'utf8');
const code=sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
test('ledger reference check SQL is read-only',()=>{
  assert.match(code,/^\s*with\b[\s\S]*\bselect\b/i);
  assert.doesNotMatch(code,/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|call|do)\b\s/i);
  assert.doesNotMatch(code,/\bselect\b[^;]*\bfor\s+update\b/i);
  assert.doesNotMatch(code,/\bpg_sleep|set_config|nextval|app_apply_ledger_fix|app_undo_ledger_fix|app_auto_ledger/i);
  assert.equal((code.match(/;/g)||[]).length,1,'a single statement');
});
test('ledger reference check SQL carries no secrets, emails, phone numbers or ids',()=>{
  assert.doesNotMatch(sql,/eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\d{2,3}-\d{3,4}-\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
