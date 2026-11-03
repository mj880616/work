// HOTFIX-회의첨부칸 ②(S48-53): PC 사업 보고 창에 파일을 끌어 놓으면 이 사업 보고에 붙는다.
// - 수정 화면: 결과 칸에 놓은 결과 파일은 본문을 결과 칸에 넣을지 묻고, 파일은 [+]와 같은 자료실 올리기 창(library-files, meeting_id)으로 올라간다. 수정 저장 뒤 보기 화면에 파일이 남는다.
// - 보기 화면: 회의자료 줄에 놓으면 묻지 않고 올리기 창, 이름으로 모르는 파일을 면에 놓으면 결과/자료를 고르고, 결과면 본문을 서버 결과 글 뒤에 더해 저장한다.
// 가짜 서버만 쓴다(운영 서버 호출 없음).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
import {tinyPdf} from './helpers/tiny-pdf.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const MEETING={id:'meeting-1',workspace_id:'ws',title:'자료 확인 회의',series_name:'자료 확인 회의',meeting_at:'2026-10-10T10:00:00Z',transcript_text:'회의 원문',created_by:'owner'};

async function boot(page){
  await page.setViewportSize({width:1280,height:900});
  const state={meeting:{...MEETING},docs:['first.pdf','second.pdf'].map((name,i)=>({id:'doc-'+i,workspace_id:'ws',meeting_id:MEETING.id,file_name:name,title:name,category:'회의자료',tags:[],created_at:'2026-10-10T00:00:00Z'})),uploads:[],patches:[],errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')state.errors.push(m.text())});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings'){
      if(req.method()==='PATCH'){const body=req.postDataJSON();state.patches.push(body);Object.assign(state.meeting,body)}
      return ok([state.meeting]);
    }
    if(path==='/rest/v1/app_documents'){
      const id=url.searchParams.get('id')?.replace(/^eq\./,''),mid=url.searchParams.get('meeting_id')?.replace(/^eq\./,'');
      return ok(state.docs.filter(d=>(!id||d.id===id)&&(!mid||d.meeting_id===mid)));
    }
    if(['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path)){
      const raw=req.postDataBuffer().toString('latin1');
      state.uploads.push({path,raw});
      const name=raw.match(/filename="([^"]+)"/)?.[1];
      const doc={id:'uploaded-'+state.uploads.length,workspace_id:'ws',file_name:name,title:name,tags:[],meeting_id:raw.includes('name="meeting_id"')?MEETING.id:null,created_at:'2026-10-11T00:00:00Z'};
      state.docs.push(doc);
      return ok({ok:true,document:doc});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    return ok([]);
  });
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(BASE+'/app/?view=meetings')}`);
  await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return state;
}

// 파일을 끌어 그 자리에 놓는 것과 같은 이벤트(dragenter → dragover → [표시 확인] → drop). 같은 DataTransfer를 쓴다.
async function drag(page,selector,files,types){
  await page.evaluate(({selector,files,types})=>{
    if(!window.__dropDT){const dt=new DataTransfer();for(const f of files)dt.items.add(new File([new Uint8Array(f.bytes)],f.name,{type:'application/pdf'}));window.__dropDT=dt}
    const target=document.querySelector(selector);
    for(const type of types)target.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:window.__dropDT}));
    if(types.includes('drop'))window.__dropDT=null;
  },{selector,files:files.map(f=>({name:f.name,bytes:[...f.bytes]})),types});
}
async function dropOn(page,selector,files){
  await drag(page,selector,files,['dragenter','dragover']);
  await expect(page.locator('#meetingRoundDetailModal .drop-zone-active')).toHaveCount(1);
  await drag(page,selector,files,['drop']);
  await expect(page.locator('#meetingRoundDetailModal .drop-zone-active')).toHaveCount(0);
}
const pdf=(name,lines=['x'])=>({name,bytes:tinyPdf(lines)});

test('PC 수정 화면: 결과 칸에 결과 파일을 끌어 놓으면 본문을 넣을지 묻고 첨부 → 수정 저장 → 보기 화면에 파일',async({page})=>{
  const state=await boot(page);
  await openMeetingResult(page,'meeting-1');
  const modal=page.locator('#meetingRoundDetailModal');
  await expect(modal.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
  await modal.locator('#mrdMore').click();
  await modal.locator('#mrdMoreMenu [data-mrd-more="edit"]').click();
  await expect(modal.locator('#mrdEditor')).toBeVisible();
  // 놓는 동안 결과 칸에만 '여기에 놓기' 테두리.
  await drag(page,'#mrdEditTranscript',[pdf('drop-result.pdf',['Dropped result body'])],['dragenter','dragover']);
  await expect(modal.locator('.drop-zone-active')).toHaveCount(1);
  await expect(modal.locator('label[data-drop-zone="result"]')).toHaveClass(/drop-zone-active/);
  expect(await modal.locator('label[data-drop-zone="result"]').evaluate(el=>getComputedStyle(el,'::after').content)).toBe('"여기에 놓기"');
  await drag(page,'#mrdEditTranscript',[pdf('drop-result.pdf',['Dropped result body'])],['drop']);
  expect(await answerAsk(page,true)).toBe('결과 파일 본문을 결과 칸에 넣을까요?');
  await expect(modal.locator('#mrdEditTranscript')).toHaveValue(/회의 원문\s+Dropped result body/);
  // 파일은 [+]와 같은 자료실 올리기 창으로(놓은 파일이 담겨 있다).
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('[data-lu-upload-file]')).toHaveCount(1);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
  await expect.poll(()=>state.uploads.length).toBe(1);
  expect(state.uploads[0].path).toBe('/functions/v1/library-files');
  expect(state.uploads[0].raw).toContain('name="meeting_id"');expect(state.uploads[0].raw).toContain('drop-result.pdf');
  await expect(modal.locator('#mrdEditAttach #mrdMaterials .mrd-file-row')).toHaveCount(3);
  await modal.locator('#mrdSaveEdit').click();
  await expect.poll(()=>state.patches.length).toBe(1);
  expect(state.patches[0].transcript_text).toContain('Dropped result body');
  await expect(modal.locator('#mrdView')).toBeVisible();
  await expect(modal.locator('#mrdView #mrdMaterials')).toContainText('drop-result.pdf');
  await expect(modal.locator('#mrdResult')).toContainText('Dropped result body');
  expect(state.errors).toEqual([]);
});

test('PC 보기 화면(회의 결과 창): 회의자료 줄에 놓으면 묻지 않고 첨부, 모르는 파일을 결과로 고르면 본문을 결과에 더해 저장',async({page})=>{
  const state=await boot(page);
  await openMeetingResult(page,'meeting-1');
  const modal=page.locator('#meetingRoundDetailModal');
  await expect(modal.locator('#mrdView #mrdMaterials .mrd-file-row')).toHaveCount(2);
  // ① 회의자료 줄 → 묻지 않고 올리기 창.
  await dropOn(page,'#mrdMaterials',[pdf('drop-agenda.pdf')]);
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
  await expect.poll(()=>state.uploads.length).toBe(1);
  expect(state.uploads[0].raw).toContain('name="meeting_id"');expect(state.uploads[0].raw).toContain('drop-agenda.pdf');
  await expect(modal.locator('#mrdView #mrdMaterials .mrd-file-row')).toHaveCount(3);
  expect(state.patches).toEqual([]);
  // ② 이름으로 모르는 파일을 후속 할 일 쪽(정해진 자리 없음)에 놓으면 면 전체가 '여기에 놓기', 결과/회의자료를 고른다 → 결과 → 본문 넣기 → 서버에 저장.
  await drag(page,'#mrdTasksHead',[pdf('scan-0001.pdf',['View drop body'])],['dragenter','dragover']);
  await expect(modal.locator('#mrdView')).toHaveClass(/drop-zone-active/);
  await drag(page,'#mrdTasksHead',[pdf('scan-0001.pdf',['View drop body'])],['drop']);
  await page.locator('.kptu-ask [data-ask-pick="result"]').click();
  expect(await answerAsk(page,true)).toBe('결과 파일 본문을 결과 칸에 넣을까요?');
  await expect.poll(()=>state.patches.length).toBe(1);
  expect(state.patches[0].transcript_text).toBe('회의 원문\n\nView drop body');
  await expect(modal.locator('#mrdResult')).toContainText('View drop body');
  await expect(page.locator('#documentModal')).toBeVisible();
  await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>state.uploads.length).toBe(2);
  expect(state.uploads[1].raw).toContain('scan-0001.pdf');
  await expect(modal.locator('#mrdView #mrdMaterials .mrd-file-row')).toHaveCount(4);
  expect(state.errors).toEqual([]);
});
