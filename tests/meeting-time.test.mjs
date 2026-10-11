import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toMeetingISO,meetingInputValue,formatMeetingTime} from '../app/meeting-time.js';
for(const tz of ['Europe/Rome','Asia/Seoul','UTC'])test(`한국 회의 입력·표시·날짜 경계 ${tz}`,()=>{
  const previous=process.env.TZ;process.env.TZ=tz;
  try{
    for(const [input,iso] of [['2026-10-11T10:00','2026-10-11T01:00:00.000Z'],['2026-10-11T00:30','2026-10-10T15:30:00.000Z'],['2026-01-01T00:00','2025-12-31T15:00:00.000Z']]){
      assert.equal(toMeetingISO(input),iso);assert.equal(meetingInputValue(iso),input);
      assert.equal(toMeetingISO(meetingInputValue(iso)),iso);
    }
    assert.match(formatMeetingTime('2026-10-11T01:00:00Z'),/10:00/);
    assert.equal(meetingInputValue(''),'');
    assert.throws(()=>toMeetingISO('2026-02-30T10:00'),RangeError);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});

// The AI module is intentionally retired from the loader; execute its request path in isolation.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
for(const tz of ['Europe/Rome','Asia/Seoul','UTC'])test(`미로딩 AI 초안도 한국 ISO를 전달 ${tz}`,async()=>{
  const previous=process.env.TZ;process.env.TZ=tz;
  try{
    const source=readFileSync(new URL('../app/workflow-ai-v3.js',import.meta.url),'utf8');
    const fn=source.slice(source.indexOf('async function classifyNewMeeting(){'),source.indexOf('function bind(){'));
    const values={'#meetingTranscript':{value:'원문'},'#meetingTitle':{value:'회의'},'#meetingAt':{value:'2026-10-11T10:00'}};
    let body;
    const context=vm.createContext({document:{querySelector:key=>values[key]},toMeetingISO,workspaceId:'fixture',api:async(_url,options)=>{body=options.body;return {}},normalizeMeetingDraftPayload:()=>({actions:[]}),applyCreateDraft:()=>{},memberIdByDisplayName:()=>null,console,Date});
    vm.runInContext(fn+';this.run=classifyNewMeeting',context);await context.run();
    assert.equal(body.meeting_at,'2026-10-11T01:00:00.000Z');
    values['#meetingAt'].value='2026-10-11T00:30';await context.run();assert.equal(body.meeting_at,'2026-10-10T15:30:00.000Z');
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
