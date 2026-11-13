// S61-36 REC-상세녹음(명진 11/13 '회의 상세에 [녹음] 둔다'): 회의(사업 보고) 상세 머리 줄 [녹음] → 맨 위 녹음 띠.
// ① 상세 [녹음]은 지금 연 보고 id로 녹음을 시작한다(rec_start meeting_id). 녹음 중에는 상세·위쪽 [녹음]이 모두 꺼져 두 번 시작하지 않는다.
// ② 녹음 중 다른 메뉴로 옮겨도 녹음은 계속되고, 맨 위 띠 [멈추고 저장]이 처음 연 보고에 붙인다(rec_save meeting_id).
// ③ 새로고침으로 끊긴 녹음을 [이어서 저장]·[이어 녹음]해도 서버가 남긴 회의(rec_pending meeting_id)에 그대로 붙는다.
// 폰 412: 상세에 [녹음]이 보이지 않는다(위쪽 [녹음]과 같은 기기 조건, PC 761px~).
// 실제 마이크·운영 서버는 쓰지 않는다(가짜 녹음기·가짜 Supabase). 이름·글은 모두 합성 값.
// KPTU_SHOTS=1이면 docs/design/screens/s61-36/에 화면 사진을 남긴다.
import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-13T01:00:00Z';
const SHOTS=process.env.KPTU_SHOTS==='1',SHOT_DIR='docs/design/screens/s61-36';
const shot=async(page,name)=>{if(!SHOTS)return;mkdirSync(SHOT_DIR,{recursive:true});await page.waitForTimeout(300);await page.screenshot({path:`${SHOT_DIR}/${name}.png`})};
const SID='00000000-0000-4000-8000-0000000000aa',RID='00000000-0000-4000-8000-000000000001';
const MA='00000000-0000-4000-8000-00000000a001',MB='00000000-0000-4000-8000-00000000b002';

function state(){
  const s=baseState();
  const row=(id,title,round,at)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:round,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  s.meetings=[row(MA,'합성 상집',46,'2026-11-13T00:00:00Z'),row(MB,'합성 집행위',12,'2026-11-12T05:00:00Z')];
  return s;
}
// 가짜 녹음기(laptop-recording·rec-save-library와 같은 흉내).
const fakeRecorder=()=>{
  class FakeRecorder extends EventTarget{
    constructor(stream,opts={}){super();this.mimeType=opts.mimeType||'';this.state='inactive';this.n=0}
    static isTypeSupported(t){return String(t).startsWith('audio/webm')}
    start(){this.state='recording'}
    pause(){this.state='paused'}resume(){this.state='recording'}
    requestData(){this.chunk()}
    chunk(){const e=new Event('dataavailable');e.data=new Blob([`piece-${++this.n}-`.repeat(40)],{type:'audio/webm'});this.dispatchEvent(e)}
    stop(){if(this.state==='inactive')return;this.state='inactive';setTimeout(()=>{this.chunk();this.dispatchEvent(new Event('stop'))},0)}
  }
  window.MediaRecorder=FakeRecorder;
  const track={stop(){}};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track]})}});
};
// 녹음 서버 흉내. pending = 새로고침으로 끊긴 녹음(서버가 남긴 회의 id 포함).
async function recServer(page,{pending=[]}={}){
  const calls=[];
  await page.route(`${SB}/functions/v1/meeting-transcribe**`,async route=>{
    const req=route.request(),url=new URL(req.url()),action=url.searchParams.get('action');
    const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
    calls.push({action,body});
    const ok=d=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});
    if(action==='rec_pending')return ok({ok:true,sessions:pending.filter(p=>!calls.some(c=>c.action==='rec_save'&&c.body?.session_id===p.session_id)),live:[]});
    if(action==='rec_start')return ok({ok:true,recording_id:RID,session_id:body.session_id||SID,segment_no:body.session_id?2:1,piece_seconds:60,segment_seconds:1740,max_pieces:29});
    if(action==='rec_piece')return ok({ok:true,pieces:1});
    if(action==='rec_finish')return ok({ok:true,more:false,session_id:body.session_id,segments:[{segment_no:1,status:'combined',job_id:'00000000-0000-4000-8000-0000000000c1',duration_sec:600}]});
    if(action==='rec_save')return ok({ok:true,session_id:body.session_id,folder_id:'folder-rec',folder_name:'회의 녹음',files:[
      {document_id:'doc-rec-1',file_name:'회의 녹음 2026-11-13 10-00 (1).webm',drive_file_id:'driveRec1',drive_url:'https://drive.google.com/file/d/driveRec1/view',mime_type:'audio/webm',size_bytes:4096,duration_sec:600,meeting_id:body.meeting_id||null}]});
    return ok({ok:true});
  });
  return calls;
}
const of=(calls,action)=>calls.filter(c=>c.action===action).map(c=>c.body);
async function open(page,{width=1280,height=900,pending=[]}={}){
  await page.setViewportSize({width,height});
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(fakeRecorder);
  await mockApp(page,state());
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  const calls=await recServer(page,{pending});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await page.waitForFunction(()=>!!window.KPTUMeetingRecorder,null,{timeout:15000});
  return calls;
}
async function openReport(page,kind,id){
  await page.locator('#meetingList .mcol-kinds [data-meeting-kind]').filter({hasText:kind}).click();
  await page.locator(`#meetingList [data-meeting-round="${id}"]`).click();
  const detail=page.locator('#meetingRoundDetailModal');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-meeting-id',id);
  return detail;
}

test('PC 1280: 상세 [녹음] → 다른 메뉴로 옮겨도 녹음 계속 → 맨 위 띠 [멈추고 저장]이 처음 연 보고에 붙인다',async({page})=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=await open(page);
  const detail=await openReport(page,'합성 상집',MA);
  const rec=detail.locator('#mrdRecordBtn'),top=page.locator('#reportRecordBtn');
  await expect(rec).toBeVisible();await expect(rec).toHaveText('녹음');await expect(rec).toBeEnabled();
  // 작은 낮은 버튼(32px), ⋯ 왼쪽.
  const box=await rec.boundingBox();expect(box.height).toBeLessThanOrEqual(33);
  const more=await detail.locator('#mrdMore').boundingBox();expect(box.x).toBeLessThan(more.x);
  await shot(page,'pc-1280-detail');
  await rec.click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await expect.poll(()=>of(calls,'rec_start')).toEqual([{workspace_id:expect.any(String),mime:'audio/webm',meeting_id:MA}]);
  // 녹음 중: 상세 단추는 '녹음 중'(눌림)·꺼짐, 위쪽 [녹음]도 꺼짐 → 두 번 시작하지 않는다.
  await expect(rec).toHaveText('녹음 중');await expect(rec).toHaveAttribute('aria-pressed','true');await expect(rec).toBeDisabled();
  await expect(top).toBeDisabled();
  await shot(page,'pc-1280-recording');
  await rec.click({force:true});await top.click({force:true});
  expect(of(calls,'rec_start').length).toBe(1);
  // 다른 보고를 열면 그 보고의 단추는 꺼진 '녹음'(지금 녹음은 앞 보고 것).
  await openReport(page,'합성 집행위',MB);
  await expect(rec).toHaveText('녹음');await expect(rec).toBeDisabled();await expect(rec).toHaveAttribute('aria-pressed','false');
  // 다른 메뉴(할 일)로 옮겨도 녹음 띠는 그대로.
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('tasks');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await shot(page,'pc-1280-other-menu');
  await band.getByRole('button',{name:'멈추고 저장'}).click();
  await expect.poll(()=>of(calls,'rec_save'),{timeout:15000}).toEqual([{session_id:SID,meeting_id:MA}]);
  await expect(band.locator('.rec-label')).toHaveText('저장됨');
  await shot(page,'pc-1280-saved');
  expect(errors).toEqual([]);
});

const CUT={session_id:SID,started_at:'2026-11-12T00:00:00Z',duration_sec:1200,meeting_id:MA,segments:[{segment_no:1,status:'closed',job_id:null,job_status:null,duration_sec:1200}]};

test('PC 1280: 새로고침으로 끊긴 회의 녹음 [이어서 저장] → 서버가 남긴 그 회의에 붙인다',async({page})=>{
  test.setTimeout(60000);
  const calls=await open(page,{pending:[CUT]});
  const line=page.locator('#recPendingLine');
  await expect(line).toBeVisible({timeout:15000});
  await shot(page,'pc-1280-pending');
  await line.getByRole('button',{name:'이어서 저장'}).click();
  await expect.poll(()=>of(calls,'rec_save'),{timeout:15000}).toEqual([{session_id:SID,meeting_id:MA}]);
  await expect(page.locator('#recBand .rec-label')).toHaveText('저장됨');
});

test('PC 1280: 끊긴 회의 녹음 [이어 녹음] → 그 회의 단추가 "녹음 중" → [멈추고 저장]도 그 회의에',async({page})=>{
  test.setTimeout(60000);
  const calls=await open(page,{pending:[CUT]});
  const line=page.locator('#recPendingLine');
  await expect(line).toBeVisible({timeout:15000});
  await line.getByRole('button',{name:'이어 녹음'}).click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  // 같은 녹음(session_id)의 다음 구간. 회의 id는 서버가 그 녹음에 남긴 것을 쓰므로 다시 보내지 않는다.
  await expect.poll(()=>of(calls,'rec_start')).toEqual([{workspace_id:expect.any(String),mime:'audio/webm',session_id:SID}]);
  const detail=await openReport(page,'합성 상집',MA);
  await expect(detail.locator('#mrdRecordBtn')).toHaveText('녹음 중');
  await band.getByRole('button',{name:'멈추고 저장'}).click();
  await expect.poll(()=>of(calls,'rec_save'),{timeout:15000}).toEqual([{session_id:SID,meeting_id:MA}]);
});

test('폰 412: 상세에 [녹음]이 보이지 않는다(위쪽 [녹음]과 같은 기기 조건)',async({page})=>{
  test.setTimeout(60000);
  const calls=await open(page,{width:412,height:915});
  await page.evaluate(id=>window.KPTUMeetingDetail?.open?.(id)??document.dispatchEvent(new CustomEvent('kptu:open-meeting',{detail:{id}})),MA).catch(()=>{});
  const card=page.locator(`#meetingList [data-mrd-meeting="${MA}"], #meetingList [data-meeting-round="${MA}"]`).first();
  if(!(await page.locator('#meetingRoundDetailModal:not(.hidden)').count())){
    const kind=page.locator('#meetingList .mcol-kinds [data-meeting-kind]').filter({hasText:'합성 상집'});
    if(await kind.count())await kind.click();
    await card.click();
  }
  const detail=page.locator('#meetingRoundDetailModal');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-meeting-id',MA);
  await expect(detail.locator('#mrdRecordBtn')).toBeHidden();
  await expect(page.locator('#reportRecordBtn')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot(page,'phone-412-detail');
  expect(of(calls,'rec_start')).toEqual([]);
});
