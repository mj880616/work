// S48-64(REC-전사원문저장 + AI초안실패): 긴 전사본 나눠 요약, 전사 전문을 '회의록 전문' 칸에 남기기, 요약 실패 문구, [원문]/[서식] 글자 버튼.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {splitTranscript,partsText,keepTranscript,draftFailText,DRAFT_FAIL,DRAFT_ONE_CHARS,DRAFT_PART_CHARS,MAX_DRAFT_PARTS,MAX_TRANSCRIPT_CHARS,DRAFT_TIMEOUT_MS} from '../app/meeting-transcript-model.mjs';
import {reportWords} from '../app/report-words.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const line=(i,n=60)=>`화자${i%3+1}: `+'가'.repeat(n);

test('짧은 글은 한 조각, 긴 글은 줄 경계에서 나뉘고 글자를 잃지 않는다',()=>{
  assert.deepEqual(splitTranscript(''),[]);
  assert.deepEqual(splitTranscript('짧은 회의'),['짧은 회의']);
  const short=Array.from({length:100},(_,i)=>line(i)).join('\n');
  assert.ok(short.length<=DRAFT_ONE_CHARS);assert.equal(splitTranscript(short).length,1);
  // 50분 회의쯤(약 7만 자)
  const long=Array.from({length:1100},(_,i)=>line(i)).join('\n');
  const parts=splitTranscript(long);
  assert.ok(parts.length>=3&&parts.length<=4,String(parts.length));
  for(const p of parts){assert.ok(p.length<=DRAFT_PART_CHARS);assert.match(p,/^화자\d: /)}
  assert.equal(parts.join('\n'),long);
});

test('줄바꿈 없는 아주 긴 줄도 조각 크기로 자르고, 상한 조각 수 뒤는 버린다',()=>{
  const one='나'.repeat(DRAFT_PART_CHARS*2+10);
  const parts=splitTranscript(one);
  assert.equal(parts.length,3);assert.equal(parts.join(''),one);
  const huge=Array.from({length:6000},(_,i)=>line(i)).join('\n');
  assert.equal(splitTranscript(huge).length,MAX_DRAFT_PARTS);
  assert.equal(MAX_TRANSCRIPT_CHARS,DRAFT_PART_CHARS*MAX_DRAFT_PARTS);
  assert.ok(MAX_TRANSCRIPT_CHARS>=240000,'2시간 녹음도 요약');
});

test('조각 요약 → 합치기 재료 글',()=>{
  const t=partsText([
    {decisions:'예산 확정',information:'',actions:[{task:'공문 발송',assignee:'명진',due:'2026-11-05'}],attendees:['가'],meetingDate:'2026-11-03'},
    {decisions:'',information:'다음 회의 11월 10일',actions:[],attendees:[],meetingDate:''},
  ]);
  assert.match(t,/^\[부분 1\/2\]\n참석: 가\n결정\n- 예산 확정\n할 일\n- 공문 발송 \(담당 명진\) \(기한 2026-11-05\)\n날짜: 2026-11-03/);
  assert.match(t,/\[부분 2\/2\]\n공유\n- 다음 회의 11월 10일$/);
});

test('회의록 전문 칸: 비어 있으면 전문, 이미 쓴 글은 지우지 않고 아래에, 같은 글은 두 번 넣지 않는다',()=>{
  assert.equal(keepTranscript('','전문'),'전문');
  assert.equal(keepTranscript('예전 특이사항','전문'),'예전 특이사항\n\n전문');
  assert.equal(keepTranscript('예전 특이사항\n\n전문','전문'),'예전 특이사항\n\n전문');
});

test('요약 실패 문구는 이유별(시간 초과·연결·로그인·서버 한 줄)',()=>{
  assert.equal(draftFailText({code:'timeout'}),DRAFT_FAIL.timeout);
  assert.equal(draftFailText({status:546}),DRAFT_FAIL.timeout);
  assert.equal(draftFailText({code:'network_error'}),DRAFT_FAIL.network);
  assert.equal(draftFailText({code:'session_required'}),DRAFT_FAIL.session);
  assert.equal(draftFailText({status:400,code:'http_400',message:'오늘의 팀 AI 사용 한도에 도달했습니다.'}),'오늘의 팀 AI 사용 한도에 도달했습니다. 넣은 글은 그대로 있어요.');
  assert.equal(draftFailText({status:400,message:'AI 응답이 중단되었습니다. 입력한 회의록은 유지됩니다.'}),'AI 응답이 중단되었습니다. 입력한 회의록은 유지됩니다.');
  assert.equal(draftFailText({status:400,message:'Internal error at x'}),DRAFT_FAIL.generic);
  assert.equal(draftFailText(new Error('invalid_meeting_draft')),DRAFT_FAIL.generic);
});

test('원인 고침: 요약 호출은 화면 기본 15초가 아니라 긴 기다림 + 나눠 요약 + 전문을 먼저 칸에',()=>{
  const src=read('app/meeting-transcript-draft.js');
  assert.ok(DRAFT_TIMEOUT_MS>=180000);
  assert.match(src,/rt\.api\('\/functions\/v1\/meeting-ai-draft',\{method:'POST',singleFlight:false,timeoutMs:DRAFT_TIMEOUT_MS,/);
  assert.match(src,/stage:'part'/);assert.match(src,/stage:'merge'/);
  // 요약 호출보다 먼저 전문을 칸에 넣는다(실패해도 저장 때 남게).
  const run=src.slice(src.indexOf('async function run(){'));
  assert.ok(run.indexOf('keepFull(text)')>0&&run.indexOf('keepFull(text)')<run.indexOf('askDraft('));
  assert.match(src,/\$\('#meetingNotes'\)/);
  // 로그에는 글을 남기지 않는다(오류 코드만).
  assert.doesNotMatch(src,/console\.error\('meeting transcript draft failed',e\)/);
});

test('서버(meeting-ai-draft): stage part·merge는 회의 행에 저장하지 않고, 앞 회의 맥락에 회의록 전문(notes)을 싣지 않는다',()=>{
  const src=read('supabase/functions/meeting-ai-draft/index.ts');
  assert.match(src,/const stage=draftStage\(b\)/);
  assert.match(src,/if\(meetingId&&!stage\.kind\)\{const \{data:saved/);
  assert.match(src,/select\('title,meeting_at,decisions'\)\.eq\('project_id'/);
  assert.doesNotMatch(src,/select\('title,meeting_at,decisions,notes'\)/);
  // 권한 확인(owner)은 그대로.
  assert.match(src,/if\(member\?\.role!=='owner'\)throw new MeetingAuthError\(403,'RESOURCE_FORBIDDEN'\)/);
});

test('[회의] 칸만 notes 칸 이름이 회의록 전문, 다른 칸은 특이사항 그대로',()=>{
  assert.equal(reportWords('meeting').notesLabel,'회의록 전문');
  assert.equal(reportWords('policy').notesLabel,'특이사항');
  const mrd=read('app/meeting-round-detail.js'),team=read('app/team.js'),html=read('app/index.html');
  assert.match(mrd,/set\('#mrdSpecialHead',w\.notesLabel\);set\('#mrdEditNotesLabel',w\.notesLabel\)/);
  assert.match(mrd,/<details id="mrdSpecialFold" class="mrd-special-fold" open>/);
  assert.match(team,/set\('#meetingNotesLabel',w\.notesLabel\)/);
  assert.match(html,/<span id="meetingNotesLabel">특이사항<\/span>/);
});

test('AI 재료: 특이사항(=회의록 전문)은 맨 뒤 300자만',()=>{
  const ba=read('supabase/functions/ai-assist/business-area.ts');
  assert.ok(ba.indexOf('다음 할 일: ${field(row.next_plan)')<ba.indexOf('특이사항: ${cut(field(row.notes).trim(), AREA_REPORT_NOTES_CHARS)}'));
  assert.match(ba,/const AREA_REPORT_NOTES_CHARS = 300;/);
  assert.match(read('app/report-area-tag.js'),/String\(m\.notes\|\|''\)\.slice\(0,300\)\]/);
});

test('[원문]/[서식]: <> 아이콘 대신 작은 글자 버튼(사업 보고·업데이트 같게)',()=>{
  const v=read('app/record-text-view.js'),b=read('app/basket.js');
  assert.match(v,/hidden>원문<\/button>`/);assert.match(v,/toggle\.textContent = state\.raw \? '서식' : '원문';/);
  assert.match(b,/title="원문 그대로 보기">원문<\/button>/);assert.match(b,/toggle\.textContent = rawView \? '서식' : '원문';/);
  assert.doesNotMatch(v+b,/M5\.5 4\.5 2 8l3\.5 3\.5/);
});
