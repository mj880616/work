// S67-53 ORG-여러개삭제: 확인 창·결과 글자와 선택 판정(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import {chunks,orgRecordCountPath,orgBulkConfirmText,orgBulkMovedText,orgBulkUndoText,orgPickCount,COUNT_CHUNK} from '../app/org-bulk-delete-model.mjs';

test('담당조직 확인 창: 조직 수·연결된 조직 보고 수, 휴지통·되돌리기 안내(한 개 삭제와 같은 규칙)',()=>{
  assert.equal(orgBulkConfirmText(3,5),'담당조직 3곳을 휴지통으로 옮길까요?\n연결된 조직 보고 5건과 담당자는 그대로 남고, 휴지통에서 되돌릴 수 있어요.');
  assert.equal(orgBulkConfirmText(1,0),'담당조직 1곳을 휴지통으로 옮길까요?\n연결된 조직 보고는 없고, 휴지통에서 되돌릴 수 있어요.');
  assert.equal(orgPickCount(2),'2곳 선택됨');
  assert.equal(orgBulkMovedText(3,0),'담당조직 3곳을 휴지통으로 옮겼어요.');
  assert.match(orgBulkMovedText(2,1),/2곳을 휴지통으로 옮겼고 1곳은 옮기지 못했어요/);
  assert.equal(orgBulkUndoText(3,0),'담당조직 3곳을 되돌렸어요.');
  assert.match(orgBulkUndoText(1,2),/1곳을 되돌렸고 2곳은 되돌리지 못했어요/);
});
test('조직 보고 개수 읽기: 40곳씩 나눠 묻고 id만 읽는다',()=>{
  const ids=Array.from({length:85},(_,i)=>'id-'+i);
  assert.deepEqual(chunks(ids).map(c=>c.length),[COUNT_CHUNK,COUNT_CHUNK,5]);
  assert.equal(orgRecordCountPath(['a b','c']),'/rest/v1/app_suborganization_updates?organization_id=in.(a%20b,c)&select=id');
});
