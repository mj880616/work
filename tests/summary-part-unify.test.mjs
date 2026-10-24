import test from 'node:test';
import assert from 'node:assert/strict';
// UPD-요약부품통일·UPD-사진요약기록: 화면 요약 부품의 순수 규칙(요청 몸통·첨부 글자 상태·기본값 넣기)과 사업 보고 연결 요약 보내기.
const A=await import('../app/basket-ai-summary.js');
const M=await import('../app/report-links-model.mjs');
const N='10000000-0000-4000-8000-000000000001',T='20000000-0000-4000-8000-000000000001';

test('linkSummaryBody: exactly one material id; files only with a note; reference only with a note',()=>{
  assert.deepEqual(A.linkSummaryBody({noteId:N,targetKind:'organization',targetId:T}),{kind:'link_summary',note_id:N,target_kind:'organization',target_id:T});
  assert.deepEqual(A.linkSummaryBody({noteId:N,use:'files',targetKind:'reference',targetId:T}),{kind:'link_summary',note_id:N,use:'files',target_kind:'reference',target_id:T});
  assert.deepEqual(A.linkSummaryBody({meetingId:N,targetKind:'project',targetId:T}),{kind:'link_summary',meeting_id:N,target_kind:'project',target_id:T});
  assert.deepEqual(A.linkSummaryBody({documentId:N,targetKind:'organization',targetId:T}),{kind:'link_summary',document_id:N,target_kind:'organization',target_id:T});
  for(const bad of [{noteId:N,meetingId:N,targetKind:'project',targetId:T},{meetingId:N,use:'files',targetKind:'project',targetId:T},{meetingId:N,targetKind:'reference',targetId:T},
    {noteId:N,use:'text',targetKind:'project',targetId:T},{noteId:'x',targetKind:'project',targetId:T},{noteId:N,targetKind:'bundle',targetId:T},{targetKind:'project',targetId:T}])
    assert.equal(A.linkSummaryBody(bad),null,JSON.stringify(bad));
});

test('requestLinkSummary refuses a bad body without any request',async()=>{
  let called=false;const r=await A.requestLinkSummary({meetingId:N,targetKind:'reference',targetId:T},{fetcher:()=>{called=true}});
  assert.equal(r.code,'invalid_request');assert.equal(called,false);
});

test('attachmentTextState: ready / pending / none, AI-excluded or archived is none',()=>{
  const ph=(o,t='image/jpeg')=>({drive_file_id:'a',mime_type:t,ocr:o});
  const base={kind:'basket',archived_at:null,ai_export_allowed:true};
  assert.equal(A.attachmentTextState({...base,attachments:[ph({state:'done',text:'글자'})]}),'ready');
  assert.equal(A.attachmentTextState({...base,attachments:[ph({state:'done',text:'글자'}),ph({state:'reading'})]}),'pending');
  assert.equal(A.attachmentTextState({...base,attachments:[ph({state:'empty',text:''}),ph(undefined)]}),'none');
  assert.equal(A.attachmentTextState({...base,attachments:[{drive_file_id:'h',mime_type:'application/x-hwp'}]}),'ready');
  assert.equal(A.attachmentTextState({...base,attachments:[]}),'none');
  assert.equal(A.attachmentTextState({...base,ai_export_allowed:false,attachments:[ph({state:'done',text:'x'})]}),'none');
  assert.equal(A.attachmentTextState({...base,archived_at:'2026-10-01',attachments:[ph({state:'done',text:'x'})]}),'none');
});

test('placeDefaultSummary: an existing summary fills only an empty box; a written box keeps its text',()=>{
  assert.equal(A.placeDefaultSummary('','핵심 내용'),'핵심 내용');
  assert.equal(A.placeDefaultSummary('직접 쓴 글','핵심 내용'),'직접 쓴 글');
  assert.equal(A.placeDefaultSummary('','  '),'');
  assert.equal(A.placeDefaultSummary('','가'.repeat(2001)),'');
});

test('readDocumentBrief: only a b1: row of my workspace; anything else is empty (then [AI 요약])',async()=>{
  const rt=rows=>({context:{read:()=>({workspace:{id:'w'}})},api:async path=>{rt.last=path;return rows}});
  const r1=rt([{document_id:N,content_hash:'b1:'+'0'.repeat(32),summary:'올릴 때 요약.'}]);
  assert.equal(await A.readDocumentBrief(N,{rt:r1}),'올릴 때 요약.');assert.match(rt.last,/content_hash=like\.b1%3A\*/);
  assert.equal(await A.readDocumentBrief(N,{rt:rt([{document_id:N,content_hash:'old',summary:'옛 요약'}])}),'');
  assert.equal(await A.readDocumentBrief(N,{rt:rt([])}),'');
  assert.equal(await A.readDocumentBrief('x',{rt:rt([])}),'');
});

test('the files button uses its own attribute names, a waiting note replaces the button',()=>{
  const esc=v=>String(v);
  const html=A.aiSummaryMarkup(A.newAiState(),'organization:1','data-manual',esc,{label:'요약해서 기록으로',slot:'files'});
  assert.match(html,/data-manual-files-run="organization:1"/);assert.match(html,/>요약해서 기록으로</);
  const wait=A.aiSummaryMarkup(A.newAiState(),'k','data-manual',esc,{slot:'files',waiting:'글자 읽는 중'});
  assert.doesNotMatch(wait,/<button/);assert.match(wait,/글자 읽는 중/);
  assert.match(A.aiSummaryMarkup(A.newAiState(),'k','data-report',esc,{cls:'mini secondary'}),/class="ai-summary-run mini secondary"/);
});

test('사업 보고 연결: written summaries go only for places with text; an empty box keeps the saved summary (DB rule)',()=>{
  const P={kind:'project',id:'p'},O={kind:'organization',id:'o'};
  const s=new Map([['project:p','  프로젝트 요약 '],['organization:o','  ']]);
  assert.deepEqual(M.rpcTargets([P,O],s),[{kind:'project',target_id:'p',summary:'프로젝트 요약'},{kind:'organization',target_id:'o'}]);
  assert.deepEqual(M.rpcTargets([P,O]),[{kind:'project',target_id:'p'},{kind:'organization',target_id:'o'}]);
  assert.throws(()=>M.rpcTargets([P],new Map([['project:p','가'.repeat(2001)]])),RangeError);
  assert.equal(M.summariesChanged([P],s,new Map([['project:p','프로젝트 요약']])),false);
  assert.equal(M.summariesChanged([P],new Map([['project:p','새 글']]),new Map([['project:p','프로젝트 요약']])),true);
  assert.equal(M.summariesChanged([P],new Map([['project:p','']]),new Map([['project:p','프로젝트 요약']])),false);
  const t=M.targetsFromLinkRows([{id:'l',project_id:'p',summary:'보낸 요약'}]);assert.equal(t[0].summary,'보낸 요약');
  const rows=M.linkedReportRows([{id:'l',summary:'줄 요약',report:{id:'m',meeting_at:'2026-10-01T00:00:00Z'}}]);assert.equal(rows[0].linkSummary,'줄 요약');
});
