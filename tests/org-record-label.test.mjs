import test from 'node:test';
import assert from 'node:assert/strict';
// ORG-기록첨부표시이름(S61-2): 글 없이 사진·파일만 올린 기록의 목록 줄은 '요약 없음' 대신 '사진 3장'·'파일 2개'.
const img=n=>({drive_file_id:'p'+n,file_name:`사진${n}.jpg`,mime_type:'image/jpeg',size_bytes:6});
const hwp={drive_file_id:'h',file_name:'합성 요구안.hwp',mime_type:'application/x-hwp',size_bytes:6};
const pdf={drive_file_id:'d',file_name:'합성 공문.pdf',mime_type:'application/pdf',size_bytes:6};
test('attachmentsLabel: 사진은 장, 다른 파일은 개, 사진 먼저, 없으면 빈 글',async()=>{
  const {attachmentsLabel}=await import('../app/record-file-line.mjs');
  assert.equal(attachmentsLabel([img(1),img(2),img(3)]),'사진 3장');
  assert.equal(attachmentsLabel([hwp,pdf]),'파일 2개');
  assert.equal(attachmentsLabel([hwp,img(1),img(2)]),'사진 2장 · 파일 1개');
  // mime이 비어도 이름으로 사진을 안다(공용 판정 kindOf).
  assert.equal(attachmentsLabel([{drive_file_id:'x',file_name:'붙여넣은 그림.png',mime_type:''}]),'사진 1장');
  assert.equal(attachmentsLabel([]),'');assert.equal(attachmentsLabel(null),'');assert.equal(attachmentsLabel([null,'x']),'');
});
test('기록 줄: 요약·글 없음 + 파일 → 파일 수, 요약이나 글이 있으면 그 글, 아무것도 없으면 요약 없음',async()=>{
  const {recordShownText,linkRecordHtml}=await import('../app/basket-link-records.js');
  const row=extra=>({id:'l',note_id:'n',organization_id:'o',project_id:null,occurred_at:'2026-11-09T01:00:00Z',summary:null,raw_text:'',...extra});
  assert.equal(recordShownText(row({attachments:[img(1),img(2),img(3)]})),'사진 3장');
  assert.equal(recordShownText(row({attachments:[hwp]})),'파일 1개');
  assert.equal(recordShownText(row({raw_text:'합성 기록 글',attachments:[img(1)]})),'합성 기록 글');
  assert.equal(recordShownText(row({summary:'그림 1장 · 사진1.jpg',attachments:[img(1)]})),'그림 1장 · 사진1.jpg');
  assert.equal(recordShownText(row({})),'요약 없음');
  const html=linkRecordHtml(row({attachments:[img(1),img(2),img(3)]}));
  assert.match(html,/data-link-summary-text>사진 3장<\/p>/);
  assert.doesNotMatch(html,/요약 없음/);
});
