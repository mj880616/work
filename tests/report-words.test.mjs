// MTG-사업보고말바꾸기 + MEET-파일AI분류: 칸에 따른 화면 글자와, 사업 보고 자료 올리기가 자료실 올리기를 쓰는지. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportWords,isMeetingKind} from '../app/report-words.mjs';
import {REPORT_KINDS} from '../app/report-kinds.mjs';
import {normalizeUploadMeeting,uploadMeetingLabel} from '../app/library-upload-meeting.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('회의 칸만 회의 말을 쓴다(회의명·회의 결과·회의 결과 원문·회의자료), 다른 모든 칸은 제목·내용·원문·자료',()=>{
  const m=reportWords('meeting');
  assert.deepEqual([m.nameLabel,m.resultLegend,m.textLabel,m.materials],['회의명','회의 결과','회의 결과 원문','회의자료']);
  for(const k of REPORT_KINDS.filter(k=>k.value!=='meeting')){
    const w=reportWords(k.value);
    assert.equal(isMeetingKind(k.value),false,k.value);
    assert.deepEqual([w.nameLabel,w.resultLegend,w.textLabel,w.materials],['제목','내용','원문','자료'],k.value);
    for(const text of Object.values(w))if(typeof text==='string')assert.doesNotMatch(text,/회의/,k.value+':'+text);
  }
});
test('칸이 없거나 모르는 값이면 옛 행처럼 회의 말',()=>{
  assert.equal(reportWords(undefined).nameLabel,'회의명');assert.equal(reportWords('').meeting,true);
});
test('normalizeUploadMeeting: id가 있어야 대상이 된다, 프로젝트는 있으면 함께',()=>{
  assert.equal(normalizeUploadMeeting({name:'x'}),null);
  assert.deepEqual(normalizeUploadMeeting({id:' m1 ',name:' 본부집행위 3차 ',project_id:'p1'}),{id:'m1',name:'본부집행위 3차',projectId:'p1'});
  assert.match(uploadMeetingLabel({id:'m1',name:'본부집행위'}),/사업 보고 ‘본부집행위’/);
  assert.equal(uploadMeetingLabel(null),'');
});
test('library-upload.js: 사업 보고 올리기는 library-files + meeting_id + AI 채우기, 새 창이 열릴 때마다 지운다, 서버 변경 없음',()=>{
  const s=read('app/library-upload.js');
  assert.match(s,/startUploadForMeeting:luStartUploadForMeeting/);
  assert.match(s,/fd\.append\('meeting_id',luUploadMeeting\.id\)/);
  assert.match(s,/luAiFill\(d\.document\.id,fd\)/);
  assert.match(s,/luSetUploadOrg\(null\);luSetUploadMeeting\(null\)\},true\)/);
  assert.doesNotMatch(s,/meeting-files/);
});
test('meeting-round-detail.js: 자료 [+]는 자료실 올리기 창을 열고 meeting-files를 더는 부르지 않는다',()=>{
  const s=read('app/meeting-round-detail.js');
  assert.match(s,/startUploadForMeeting\?\./);
  assert.doesNotMatch(s,/meeting-files|mrdFiles|mrdUploadSelected/);
  assert.match(s,/reportWords/);
});
test('team.js: 새 사업 보고의 자료도 자료실 올리기 요청, 입력 창 글자는 칸에서 정함',()=>{
  const s=read('app/team.js');
  assert.match(s,/uploadFileForMeeting/);assert.doesNotMatch(s,/functions\/v1\/meeting-files/);
  assert.match(s,/reportWords\(entryKind\(\)\)\.nameMissing/);
  const html=read('app/index.html');
  assert.match(html,/id="meetingTitleLabel">회의명</);assert.match(html,/id="meetingResultLegend">회의 결과</);assert.match(html,/id="meetingTextLabel">회의 결과 원문</);
});
test('meeting-from-files.js는 회의를 만드는 길이라 meeting-files를 그대로 쓰고, 회의 칸이 아니면 닫힌다',()=>{
  const s=read('app/meeting-from-files.js');
  assert.match(s,/functions\/v1\/meeting-files/);assert.match(s,/kptu:report-entry-kind/);
});
