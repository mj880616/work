// MTG-녹음초안: 전사 글 → 회의 기록 초안 순수 함수와 화면 연결(정적) 검사.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAudioFile,isTranscriptFile,dateFromName,dateFromText,decodeTranscript,cleanTranscript,normalizeDraft,draftText,actionRows,mergeText,pickMeetingAt} from '../app/meeting-transcript-model.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('파일 종류: 녹음(m4a·mp3·audio/*)과 전사 글(txt·md·srt·vtt)을 가른다',()=>{
  assert.equal(isAudioFile('음성 251029_103012.m4a'),true);
  assert.equal(isAudioFile('x.bin','audio/mpeg'),true);
  assert.equal(isAudioFile('회의.txt','text/plain'),false);
  assert.equal(isTranscriptFile('회의.txt'),true);
  assert.equal(isTranscriptFile('자막.srt'),true);
  assert.equal(isTranscriptFile('noext','text/plain'),true);
  assert.equal(isTranscriptFile('회의.m4a','audio/mp4'),false);
  assert.equal(isTranscriptFile('회의.hwp'),false);
});

test('파일 이름 날짜·시각: 삼성 녹음 앱 YYMMDD_HHMMSS, YYYYMMDD_HHMM, YYYY-MM-DD',()=>{
  assert.deepEqual(dateFromName('음성 251029_103012.m4a'),{date:'2025-10-29',time:'10:30'});
  assert.deepEqual(dateFromName('20261029_143000.txt'),{date:'2026-10-29',time:'14:30'});
  assert.deepEqual(dateFromName('2026-10-29 운영위.txt'),{date:'2026-10-29',time:''});
  assert.deepEqual(dateFromName('251029 운영위.txt'),{date:'2025-10-29',time:''});
  assert.deepEqual(dateFromName('회의 녹음.txt'),{date:'',time:''});
  assert.deepEqual(dateFromName('251345_103012.m4a'),{date:'',time:''});
});

test('글 첫 줄 날짜',()=>{
  assert.equal(dateFromText('2026년 10월 29일 오전 10:30\n참석자 1 00:00\n안녕하세요'),'2026-10-29');
  assert.equal(dateFromText('참석자 1\n안녕하세요'),'');
});

test('글 읽기: UTF-8(BOM 있음·없음), UTF-16LE, EUC-KR',()=>{
  const enc=new TextEncoder();
  assert.equal(decodeTranscript(enc.encode('회의 결과')),'회의 결과');
  assert.equal(decodeTranscript(new Uint8Array([0xef,0xbb,0xbf,...enc.encode('회의')])),'회의');
  const s='회의',u16=[0xff,0xfe];for(const ch of s){const c=ch.charCodeAt(0);u16.push(c&0xff,c>>8)}
  assert.equal(decodeTranscript(new Uint8Array(u16)),'회의');
  // '회의' in EUC-KR
  assert.equal(decodeTranscript(new Uint8Array([0xc8,0xb8,0xc0,0xc7])),'회의');
});

test('글 정리: 줄바꿈 통일, 자막 번호·시각 줄 빼기, 빈 줄 줄이기',()=>{
  assert.equal(cleanTranscript('a\r\n\r\n\r\n\r\nb  \r\n'),'a\n\nb');
  const srt='1\n00:00:01,000 --> 00:00:03,000\n안녕하세요\n\n2\n00:00:04,000 --> 00:00:06,000\n회의 시작함\n';
  assert.equal(cleanTranscript(srt,'a.srt'),'안녕하세요\n\n회의 시작함');
  const vtt='WEBVTT\n\n00:01.000 --> 00:03.000\n안녕\n';
  assert.equal(cleanTranscript(vtt,'a.vtt'),'안녕');
  assert.equal(cleanTranscript('1\n안녕','a.txt'),'1\n안녕');
});

test('서버 답 정규화: 확인 필요 담당·기한은 비우고, 참석·날짜는 있을 때만',()=>{
  const d=normalizeDraft({draft:{decisions:'예산안 통과함.',information:'다음 회의 11월임.',actions:[{task:'자료 정리',assignee:'[확인 필요]',due:'[확인 필요]'},{task:'공문 발송',assignee:'김OO',due:'2026-11-03'},{task:' '},'메일 보내기'],attendees:['김OO','[확인 필요]','김OO','이OO'],meeting_date:'2026-10-29'}});
  assert.deepEqual(d.actions,[{task:'자료 정리',assignee:'',due:''},{task:'공문 발송',assignee:'김OO',due:'2026-11-03'},{task:'메일 보내기',assignee:'',due:''}]);
  assert.deepEqual(d.attendees,['김OO','이OO']);
  assert.equal(d.meetingDate,'2026-10-29');
  // 지금 배포된 서버(참석·날짜 없음)의 답도 받는다.
  const old=normalizeDraft({draft:{decisions:'a',actions:[],information:''}});
  assert.deepEqual(old,{decisions:'a',information:'',actions:[],attendees:[],meetingDate:''});
  assert.equal(normalizeDraft({draft:{decisions:'',actions:[],information:''}}),null);
  assert.equal(normalizeDraft(null),null);
  assert.equal(normalizeDraft({draft:{decisions:'a',meeting_date:'10/29'}}).meetingDate,'');
});

test('초안 글: 참석 · 결정 · 공유 순, 줄머리 표시는 하나로',()=>{
  const text=draftText({attendees:['김OO','이OO'],decisions:'1. 예산안 통과함.\n- 일정 확정함.',information:'다음 회의 11월임.',actions:[]});
  assert.equal(text,'참석: 김OO, 이OO\n\n결정\n- 예산안 통과함.\n- 일정 확정함.\n\n공유\n- 다음 회의 11월임.');
  assert.equal(draftText({attendees:[],decisions:'',information:'x',actions:[]}),'공유\n- x');
  assert.equal(draftText(null),'');
});

test('후속 할 일 줄: 담당이 있으면 괄호, 기한은 날짜일 때만',()=>{
  assert.deepEqual(actionRows({actions:[{task:'공문 발송',assignee:'김OO',due:'2026-11-03'},{task:'자료 정리',assignee:'',due:''}]}),[{title:'공문 발송 (김OO)',due:'2026-11-03'},{title:'자료 정리',due:''}]);
  assert.deepEqual(actionRows(null),[]);
});

test('이미 쓴 글은 지우지 않고 아래에 덧붙인다',()=>{
  assert.equal(mergeText('','초안'),'초안');
  assert.equal(mergeText('  \n','초안'),'초안');
  assert.equal(mergeText('내 메모\n','초안'),'내 메모\n\n초안');
  assert.equal(mergeText('내 메모\n\n초안','초안'),'내 메모\n\n초안');
  assert.equal(mergeText('내 메모',''),'내 메모');
});

test('일시: 파일 이름 > AI 날짜 > 글 첫 줄, 시각은 파일 시각 또는 지금 칸 시각',()=>{
  assert.equal(pickMeetingAt({current:'2026-10-30T09:00',file:{date:'2026-10-29',time:'14:05'},aiDate:'2026-10-01'}),'2026-10-29T14:05');
  assert.equal(pickMeetingAt({current:'2026-10-30T09:00',file:{date:'',time:''},aiDate:'2026-10-28'}),'2026-10-28T09:00');
  assert.equal(pickMeetingAt({current:'2026-10-30T09:00',textDate:'2026-10-27'}),'2026-10-27T09:00');
  assert.equal(pickMeetingAt({current:'',textDate:'2026-10-27'}),'2026-10-27T10:00');
  assert.equal(pickMeetingAt({current:'2026-10-30T09:00'}),'');
  assert.equal(pickMeetingAt({current:'2026-10-29T14:05',file:{date:'2026-10-29',time:'14:05'}}),'');
});

test('화면 연결: [회의] 칸 입력 창에서 기존 meeting-ai-draft 새 회의 길만 쓰고, 자동 저장·기기 저장·[녹음] 버튼이 없다',()=>{
  const s=read('app/meeting-transcript-draft.js');
  assert.match(s,/\/functions\/v1\/meeting-ai-draft/);
  assert.doesNotMatch(s,/meeting_id\s*:/);
  assert.doesNotMatch(s,/\/rest\/v1\//);
  // 기기 저장소 낱말은 저장소 검사(browser-storage-audit)가 글자로 막으므로 조각으로 만든다.
  assert.doesNotMatch(s,new RegExp(['local','session'].map(x=>x+'Storage').concat(['indexed'+'DB']).join('|')));
  assert.doesNotMatch(s,/getUserMedia|MediaRecorder/);
  assert.doesNotMatch(s,/saveMeetingBtn/);
  assert.match(s,/kptu:report-entry-kind/);
  assert.match(s,/isMeetingKind/);
  assert.match(s,/#meetingActionAdd/);
  const loader=read('app/view-loader.js');
  assert.match(loader,/module\('\.\/meeting-transcript-draft\.js'\)/);
  assert.doesNotMatch(loader,/meeting-transcript-draft\.js\?v=/);
});
