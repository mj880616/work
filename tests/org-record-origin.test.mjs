import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// ORG-기록첨부표시이름 ①(S61-6, B안): 연결의 '만든 곳'(origin)으로 기록 입력칸에서 바로 올린 기록과 잊지 말기에서 옮긴 연결을 가른다.
// record_input → 일반 기록처럼 날짜만(이름표·표시 아이콘 없음, 메뉴 이름 '기록 메뉴'). basket·null(지난 연결) → 지금처럼 '잊지 말기 연결'.
const row=extra=>({id:'l',note_id:'n',organization_id:'o',project_id:null,occurred_at:'2026-11-12T01:00:00Z',summary:null,raw_text:'합성 기록 글',...extra});
const rtFor=api=>({context:{read:()=>({user:{id:'owner'},workspace:{id:'workspace'}})},api});

test('linkRecordHtml: record_input은 날짜만, basket·null은 잊지 말기 연결, 노트는 늘 노트 연결',async()=>{
  const {linkRecordHtml,isDirectRecord,recordMenuLabel}=await import('../app/basket-link-records.js');
  const direct=linkRecordHtml(row({origin:'record_input'}));
  assert.doesNotMatch(direct,/잊지 말기 연결/);assert.doesNotMatch(direct,/data-record-mark/);
  assert.match(direct,/<small><time>[^<]*2026[^<]*<\/time><\/small>/);
  assert.match(direct,/aria-label="기록 메뉴"/);
  for(const origin of ['basket',null,undefined,'other']){
    const html=linkRecordHtml(row({origin}));
    assert.match(html,/잊지 말기 연결 · <time>/,String(origin));assert.match(html,/data-record-mark="update"/);assert.match(html,/aria-label="잊지 말기 기록 메뉴"/);
  }
  const note=linkRecordHtml(row({origin:'record_input',note_kind:'note',title:'합성 노트'}));
  assert.match(note,/노트 연결 · <time>/);assert.equal(isDirectRecord(row({origin:'record_input',note_kind:'note'})),false);
  assert.equal(recordMenuLabel(row({origin:'record_input'})),'기록 메뉴');assert.equal(recordMenuLabel(row({})),'잊지 말기 기록 메뉴');
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

test('사업 보고 기록 줄·큰 창도 같은 판정(isDirectRecord)을 쓴다',()=>{
  const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
  assert.match(src('project-system-v3.js'),/\$\{isDirectRecord\(b\)\?'':`\$\{recordMark\(b,'ps3-rec-mark'\)\} `\}/);
  assert.match(src('project-system-v3.js'),/aria-label="\$\{recordMenuLabel\(b\)\}"/);
  const sheet=src('record-sheet.js');
  assert.match(sheet,/direct\?'':'잊지 말기 연결'/);assert.match(sheet,/direct\?'기록':'잊지 말기 업데이트'/);assert.match(sheet,/direct\?'원문 보기':'잊지 말기에서 열기'/);
});
