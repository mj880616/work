import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// ORG-기록첨부표시이름 ①(S61-6, B안)은 연결의 '만든 곳'(origin)으로 기록 입력칸 기록과 잊지 말기에서 옮긴 연결을 갈랐다.
// S71-57 RECORD-잊지말기연결표시삭제(사용자 결정 2026-11-26): 이제 노트가 아닌 연결은 만든 곳과 상관없이 모두 일반 기록 — 날짜·글만,
// 이름표·표시 아이콘·잊지 말기로 가는 링크 없음, 메뉴 이름 '기록 메뉴'. S71-71 RECORD-기록하나로(사용자 결정 2026-11-26 "원문이고 뭐고 없어"):
// 노트에서 연결된 줄도 같다 — '노트 연결'·노트 아이콘·노트로 가는 링크 없음.
const row=extra=>({id:'l',note_id:'n',organization_id:'o',project_id:null,occurred_at:'2026-11-12T01:00:00Z',summary:null,raw_text:'합성 기록 글',...extra});
const rtFor=api=>({context:{read:()=>({user:{id:'owner'},workspace:{id:'workspace'}})},api});

test('linkRecordHtml: 연결 기록은 만든 곳·노트 여부와 상관없이 날짜·글만(표시·링크 없음)',async()=>{
  const {linkRecordHtml}=await import('../app/basket-link-records.js');
  for(const extra of [{origin:'record_input'},{origin:'basket'},{origin:null},{},{origin:'other'},{origin:'record_input',note_kind:'note',title:'합성 노트'}]){
    const html=linkRecordHtml(row(extra)),k=JSON.stringify(extra);
    assert.doesNotMatch(html,/잊지 말기|노트 연결|업데이트/,k);assert.doesNotMatch(html,/data-record-mark/,k);assert.doesNotMatch(html,/<small>/,k);
    assert.doesNotMatch(html,/<a\b|href=|data-basket-link-open/,k); // 원문으로 가는 링크 없음
    // UI-기록카드하나로(S70-42): 날짜는 글 기록 줄과 같은 왼쪽 날짜 칸('MM.DD.' 또는 올해가 아니면 'YY.M.D.'), 긴 날짜·시각은 title로만.
    assert.match(html,/<span class="basket-link-day"><time datetime="2026-11-12T01:00:00.000Z" title="[^"]*2026[^"]*">(26\.)?11\.12\.<\/time><\/span>/);
    assert.match(html,/aria-label="기록 메뉴"/);
  }
});

test('기록 ⋯ 한 벌: [수정][메모][삭제] 셋(조직 직접 기록·연결 기록·사업 기록 같은 표)',async()=>{
  const {recordMenuHtml,RECORD_ACTIONS}=await import('../app/basket-link-records.js');
  assert.deepEqual(RECORD_ACTIONS.map(([,t])=>t),['수정','메모','삭제']);
  const html=recordMenuHtml('x-act',{memo:'메모 2'});
  assert.deepEqual([...html.matchAll(/data-x-act="(\w+)">([^<]+)</g)].map(m=>[m[1],m[2]]),[['edit','수정'],['memo','메모 2'],['delete','삭제']]);
  const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
  for(const f of ['workplace-detail.js','project-system-v3.js','basket-link-records.js'])assert.match(src(f),/recordMenuHtml\('/,f);
  for(const f of ['workplace-detail.js','project-system-v3.js','basket-link-records.js'])assert.doesNotMatch(src(f),/'날짜 수정'|>날짜 수정<|'원문 삭제'|>원문 삭제<|'요약 수정'|>요약 수정<|>노트 열기<|'원래 (글|업데이트|소식|통화)/,f);
});

test('readLinkRecords: origin을 읽어 줄에 싣는다(날짜만 읽기는 그대로 원문·요약·origin 없음)',async()=>{
  const {readLinkRecords}=await import('../app/basket-link-records.js'),calls=[];
  const link={id:'l',workspace_id:'workspace',summary:null,origin:'record_input',note_id:'n',organization_id:'org',status:'confirmed',note:{id:'n',workspace_id:'workspace',occurred_at:'2026-11-12T01:00:00Z',raw_text:'합성'}};
  const rows=await readLinkRecords({kind:'organization',targetIds:['org']},rtFor(async path=>{calls.push(path);return [link,{...link,id:'l2',origin:undefined}];}));
  assert.deepEqual(rows.map(r=>r.origin),['record_input',null]);
  assert.match(new URL(calls[0],'http://x').searchParams.get('select'),/summary,origin,note_id/);
  const dates=await readLinkRecords({kind:'organization',targetIds:['org'],dateOnly:true},rtFor(async path=>{calls.push(path);return [link];}));
  assert.equal(Object.hasOwn(dates[0],'origin'),false);assert.doesNotMatch(new URL(calls.at(-1),'http://x').searchParams.get('select'),/origin/);
});

test('저장 길마다 보내는 origin: 입력칸 record_input, 잊지 말기 basket, 되돌리기는 원래 값, 없으면 키를 보내지 않음',async()=>{
  const {confirmLinks,LINK_ORIGIN}=await import('../app/basket-classification.js');
  assert.deepEqual(LINK_ORIGIN,{RECORD_INPUT:'record_input',BASKET:'basket'});
  const sent=[],rt={api:async(_p,o)=>{sent.push(o.body.p_targets);return {ok:true,created:1,existing:0};}};
  await confirmLinks('n','t',[{kind:'organization',target_id:'o',reason:'직접 연결',origin:'record_input'},{kind:'project',target_id:'p',reason:'직접 연결'},{kind:'project',target_id:'q',reason:'직접 연결',origin:null}],rt);
  assert.deepEqual(sent[0],[{kind:'organization',target_id:'o',reason:'직접 연결',origin:'record_input'},{kind:'project',target_id:'p',reason:'직접 연결'},{kind:'project',target_id:'q',reason:'직접 연결'}]);
  const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
  assert.equal((src('update-places.js').match(/origin:LINK_ORIGIN\.RECORD_INPUT/g)||[]).length,2);
  assert.match(src('basket-manual-link.js'),/reason:MANUAL_LINK_REASON,origin:LINK_ORIGIN\.BASKET/);
  assert.match(src('basket-record-delete.js'),/origin:link\.origin\?\?null/);
  assert.match(src('basket-data.js'),/select=id,note_id,status,summary,origin,/);
});

test('사업 관리 기록 줄도 같은 규칙: 표시·이동 없음, 잊지 말기 글자 없음',()=>{
  const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
  const ps3=src('project-system-v3.js');
  assert.match(ps3,/<div class="ps3-rec ps3-rec-basket" data-basket-link="\$\{esc\(b\.id\)\}"><div class="ps3-rec-line"><time>/);
  assert.doesNotMatch(ps3,/noteMark|ps3-rec-mark|data-ps3-basket-note|openNoteLine|업데이트 열기|basketNoteHref|잊지 말기 기록 메뉴/);
  const sheet=src('record-sheet.js');
  assert.doesNotMatch(sheet,/'잊지 말기 연결'|'잊지 말기 업데이트'|'잊지 말기에서 열기'/);
  assert.doesNotMatch(src('basket-link-records.js'),/:'잊지 말기 연결'|>업데이트 열기<|잊지 말기 기록 (메뉴|관리)|UPDATE_ICON/);
});
