// S56-31 MTG-참석인원칸: [회의] 결과 위 참석인원 한 줄 칸 — 모양(장소 칸과 같은 부품), 저장·고치기·상세·AI 초안 채움.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attendeesLine,ATTENDEES_MAX} from '../app/meeting-transcript-model.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('app/index.html'),team=read('app/team.js'),mrd=read('app/meeting-round-detail.js'),links=read('app/report-links.js'),draft=read('app/meeting-transcript-draft.js'),list=read('app/report-list-read.js');
const migration=read('supabase/migrations/20261110231000_bizreport_meeting_attendees.sql');

test('AI 초안 참석 목록 → 한 줄: 이름이면 사람 수, 숫자가 섞이면 그대로, 200자 이하',()=>{
 assert.equal(attendeesLine({attendees:['김가','이나','박다']}),'3명 (김가, 이나, 박다)');
 assert.equal(attendeesLine({attendees:['위원장 외 11명']}),'위원장 외 11명');
 assert.equal(attendeesLine({attendees:['위원장','조합원 20여 명']}),'위원장, 조합원 20여 명');
 assert.equal(attendeesLine({attendees:[]}),'');assert.equal(attendeesLine(null),'');
 const long=attendeesLine({attendees:Array.from({length:80},(_,i)=>'이름'+'가나다'[i%3])});
 assert.ok(long.length<=ATTENDEES_MAX);assert.equal(ATTENDEES_MAX,200);
 assert.match(migration,/char_length\(attendees\) <= 200/);
});

test('쓰기 창: 회의 결과 묶음 맨 위(원문 위), 장소 칸과 같은 부품·길이, 처음엔 숨김',()=>{
 const fs=html.slice(html.indexOf('<legend data-rw="meetingResultLegend">'));
 const row=fs.indexOf('id="meetingAttendeesRow"'),text=fs.indexOf('id="meetingTranscript"');
 assert.ok(row>0&&row<text,'참석인원 줄이 원문 위');
 assert.match(html,/<label id="meetingAttendeesRow" hidden><span>참석인원 <span class="optional">안 써도 됨<\/span><\/span><input id="meetingAttendees" type="text" maxlength="200"/);
 assert.match(html,/<label id="meetingLocationRow" hidden><span>장소 <span class="optional">안 써도 됨<\/span><\/span><input id="meetingLocation" type="text" maxlength="200">/);
});

test('쓰기 창: [회의] 칸이고 서버 칸이 있을 때만 보이고 보낸다',()=>{
 assert.match(team,/function paintAttendeesRow\(\)\{const row=\$\('#meetingAttendeesRow'\);if\(row\)row\.hidden=!\(entryAttendeesOk&&isMeetingKind\(entryKind\(\)\)\)\}/);
 assert.match(team,/attendeesText=isMeetingKind\(entryKind\(\)\)\?\(\$\('#meetingAttendees'\)\?\.value\|\|''\)\.trim\(\):''/);
 assert.match(team,/const withAttendees=attendeesText&&await attendeesAvailable\(\)\.catch\(\(\)=>false\);/);
 assert.match(team,/\.\.\.\(withAttendees\?\{attendees:attendeesText\}:\{\}\)/);
 assert.match(team,/\$\('#meetingAttendees'\)\.value='';/,'창을 열 때 비운다');
 assert.match(team,/entryRoundRows\.paint\(meeting\);\n  paintAttendeesRow\(\);/,'칸을 바꾸면 다시 칠한다');
});

test('서버 칸 확인은 장소와 같은 방식, 목록 열에는 넣지 않는다(칸 없는 서버에서 목록이 select=*로 무거워지지 않게)',()=>{
 assert.match(links,/export const attendeesAvailable=\(rt\)=>probe\('attendees','\/rest\/v1\/app_meetings\?select=attendees&limit=1',rt\);/);
 assert.doesNotMatch(list,/attendees/);
 assert.doesNotMatch(team,/noteAttendees/);
});

test('보고 고치기·상세: 같은 칸, [회의] 칸만, 바뀐 때만 보내고 비우면 null; 상세 머리 줄에 참석',()=>{
 assert.match(mrd,/<legend data-rw="mrdEditLegend">회의 결과<\/legend><label id="mrdEditAttendeesRow" hidden><span>참석인원 <span class="optional">안 써도 됨<\/span><\/span><input id="mrdEditAttendees" type="text" maxlength="200"/);
 assert.match(mrd,/document\.querySelector\('#mrdEditAttendees'\)\.value=mrdCurrent\.attendees\|\|'';/);
 assert.match(mrd,/if\(meeting\)attendeesAvailable\(\)\.then/);
 assert.match(mrd,/if\(whoKind&&whoNow!==whoStart&&await attendeesAvailable\(\)\.catch\(\(\)=>false\)\)body\.attendees=whoNow\|\|null;/);
 // 서버 칸 확인 기다림은 저장 잠금(pending) 뒤(두 번 저장 막기, 장소와 같은 자리).
 assert.ok(mrd.indexOf('body.attendees=whoNow')>mrd.indexOf("const a={body,draft:mrdEditDraft(),pending:true"));
 assert.match(mrd,/const mrdEditFieldKeys=\[[^\]]*'Attendees'\]/,'고친 내용 확인에 포함');
 assert.match(mrd,/m\.attendees&&String\(m\.attendees\)\.trim\(\)\?`참석 \$\{String\(m\.attendees\)\.trim\(\)\}`:null/);
});

test('AI 초안(녹음 요약·서버 정리 결과 공용 applyDraft)은 참석인원 칸이 비어 있을 때만 채운다',()=>{
 const body=draft.slice(draft.indexOf('function applyDraft('),draft.indexOf('async function run('));
 assert.match(body,/const who=\$\('#meetingAttendees'\),line=attendeesLine\(draft\);\n  if\(who&&line&&!who\.value\.trim\(\)\)\{who\.value=line;/);
});
