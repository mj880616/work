// MEET-결과정리 ①: 회의 카드 시각 = 직접 지정한 시각 → 회의 결과 글의 일시 → 날짜만.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meetingTimeFromText,storedTimeIsSet,meetingWhen,formatMeetingWhen} from '../app/meeting-when.js';

test('결과 글의 회의 일시를 여러 표기로 읽는다',()=>{
  const cases=[
    ['일시: 2026. 10. 19.(월) 14:00','14:00'],
    ['□ 일 시 : 2026. 10. 19.(월) 14:30~16:00','14:30'],
    ['회의 일시: 2026년 10월 19일 14시','14:00'],
    ['일시 : 10. 19.(월) 14시 30분','14:30'],
    ['일시: 2026.10.19 오후 2시','14:00'],
    ['일시: 2026.10.19(월) 오후 2시 반','14:30'],
    ['○ 일시 : 2026. 10. 19. 오전 10:30','10:30'],
    ['일시: 10월 19일 오전 12시','00:00'],
    ['일시: 10월 19일 저녁 7시','19:00'],
    ['1. 일시: 2026-10-19 PM 3:15','15:15'],
    ['시간 : 15:00 ~ 17:00','15:00'],
  ];
  for(const [line,want] of cases)assert.equal(meetingTimeFromText(`궤도협의회 3차 회의 결과\n${line}\n장소: 본부 회의실`),want,line);
});

test('일시 줄이 없으면 앞쪽 줄 중 날짜와 시각이 함께 있는 줄만 본다',()=>{
  assert.equal(meetingTimeFromText('가상협의회 2차 (2026. 10. 19. 14:00)\n1. 안건'),'14:00');
  // 날짜 없는 본문 속 시각·걸린 시간·숫자는 회의 시각으로 읽지 않는다.
  assert.equal(meetingTimeFromText('가상협의회 결과\n1. 다음 회의는 3시에 다시 논의\n2. 회의 2시간 진행'),'');
  assert.equal(meetingTimeFromText('일시: 2026. 10. 19.(월)\n장소: 회의실'),'');
  assert.equal(meetingTimeFromText('소요 시간: 2시간'),'');
  assert.equal(meetingTimeFromText(''),'');
  assert.equal(meetingTimeFromText(null),'');
  assert.equal(meetingTimeFromText('일시: 2026. 10. 19. 25:00'),'');
});

test('저장된 시각이 직접 지정한 값인지',()=>{
  assert.equal(storedTimeIsSet('2026-10-19T05:00:00Z'),true);   // 14:00 KST, 분 단위
  assert.equal(storedTimeIsSet('2026-10-18T15:00:00Z'),false);  // 00:00 KST(파일로 만들기에서 시각을 못 읽음)
  assert.equal(storedTimeIsSet('2026-10-19T05:12:37.481Z'),false); // 초·밀리초 있음 = 저장 순간 시각
  assert.equal(storedTimeIsSet(''),false);
  assert.equal(storedTimeIsSet(null),false);
});

for(const tz of ['Europe/Rome','Asia/Seoul','UTC'])test(`보여 줄 회의 시각(${tz})`,()=>{
  const previous=process.env.TZ;process.env.TZ=tz;
  try{
    // 1) 직접 지정한 시각이 있으면 그것(글의 일시보다 우선).
    const set={meeting_at:'2026-10-19T05:30:00Z',transcript_text:'일시: 2026. 10. 19. 10:00'};
    assert.deepEqual(meetingWhen(set),{at:'2026-10-19T05:30:00.000Z',date:'2026-10-19',time:'14:30',source:'set'});
    assert.match(formatMeetingWhen(set),/10\. 19\. 14:30/);
    // 2) 0시 0분이면 결과 글의 일시.
    const text={meeting_at:'2026-10-18T15:00:00Z',transcript_text:'가상회의 결과\n일시: 2026. 10. 19.(월) 오후 2시'};
    assert.equal(meetingWhen(text).source,'text');assert.equal(meetingWhen(text).time,'14:00');
    assert.match(formatMeetingWhen(text),/10\. 19\. 14:00/);
    // 저장 순간 시각(초·밀리초)도 글의 일시로 바꿔 보인다.
    const uploaded={meeting_at:'2026-10-20T03:12:37.481Z',transcript_text:'일시: 2026. 10. 20. 09:00'};
    assert.match(formatMeetingWhen(uploaded),/10\. 20\. 09:00/);
    // 3) 글에도 없으면 시각 없이 날짜만(올린 시각·빈 시각을 회의 시각처럼 보이지 않게).
    const none={meeting_at:'2026-10-20T03:12:37.481Z',transcript_text:'회의 결과 원문'};
    assert.deepEqual(meetingWhen(none),{at:'2026-10-20',date:'2026-10-20',time:'',source:'none'});
    assert.equal(formatMeetingWhen(none),'10. 20.');
    assert.equal(formatMeetingWhen({meeting_at:'2026-10-18T15:00:00Z'}),'10. 19.');
    assert.equal(formatMeetingWhen({meeting_at:'2026-10-18T15:00:00Z'},{year:'numeric'}),'2026. 10. 19.');
    assert.equal(formatMeetingWhen({meeting_at:null}),'');
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
