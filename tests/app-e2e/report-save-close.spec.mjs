// BIZ-저장먼저닫기(S58-1, 요청함 11/11 07:01): 새 사업 보고 [저장] = 글 저장이 끝나면 창을 먼저 닫고, 고른 사진·자료는 뒤에서 이어 올린다.
// - 창은 올리기를 기다리지 않고 닫힌다. 진행은 하단바 위 한 줄(#uploadDock)이 묶음 전체로 끝까지, 끝나면 '사진 n장·자료 n개 올렸어요'.
// - 한 번에 하나씩, 놓은 그 사업 보고 id로. 다른 화면으로 옮겨도 끝까지.
// - 올리는 중에 그 보고를 다시 열면 사진·회의자료 칸에 올리는 줄, 끝나면 저절로 채워진다.
// - 못 올린 파일은 그 한 줄에 [다시 올리기](못 올린 파일만). 글 저장이 실패하면 창은 닫히지 않고 아무것도 보내지 않는다.
// 서버는 흉내(page.route), 파일·이름은 모두 가짜다.
import {test,expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult,closeMeetingResult} from './helpers/meeting-open.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NEW_ID='11111111-1111-4111-8111-111111111111';
const photo=n=>({name:`사진${n}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from('jpeg-'+n)});
const paper=(name='자료.hwp')=>({name,mimeType:'application/x-hwp',buffer:Buffer.from('hwp-'+name)});
const dock=page=>page.locator('#uploadDock:not([hidden])');
const reloadAsks=page=>page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{detail}));return detail.otherDraft});

async function boot(page,width,height=900){
  await page.setViewportSize({width,height});
  const state={meetings:[],docs:[],uploads:[],posts:0,hold:false,waiting:[],inFlight:0,most:0,failNames:new Set(),failMeeting:false,errors:[]};
  // 붙잡아 둔 올리기 하나를 놓아 준다(먼저 온 것부터).
  state.release=()=>{const next=state.waiting.shift();if(next)next()};
  state.releaseAll=()=>{state.hold=false;while(state.waiting.length)state.release()};
  page.on('pageerror',e=>state.errors.push(e.message));
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings'){
      if(req.method()==='POST'){
        state.posts++;
        if(state.failMeeting)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'가짜 저장 실패'})});
        const row={id:NEW_ID,workspace_id:'ws',created_by:'owner',...req.postDataJSON()};
        state.meetings=[row];return ok([row]);
      }
      const id=url.searchParams.get('id')?.replace(/^eq\./,'');
      return ok(state.meetings.filter(m=>!id||m.id===id));
    }
    if(path==='/rest/v1/app_documents'){
      const mid=url.searchParams.get('meeting_id')?.replace(/^eq\./,'');
      return ok(state.docs.filter(d=>!mid||d.meeting_id===mid));
    }
    if(path==='/functions/v1/library-files'){
      const raw=req.postDataBuffer().toString('utf8'),name=raw.match(/filename="([^"]+)"/)?.[1]||'';
      const upload={raw,name,meeting:raw.match(/name="meeting_id"\r\n\r\n([^\r]+)/)?.[1]||''};
      state.uploads.push(upload);
      state.inFlight++;state.most=Math.max(state.most,state.inFlight);
      if(state.hold)await new Promise(resolve=>state.waiting.push(resolve));
      state.inFlight--;
      if(state.failNames.has(name))return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'가짜 올리기 실패'})});
      const doc={id:'doc-'+state.uploads.length,workspace_id:'ws',file_id:'drive-'+state.uploads.length,file_name:name,title:name,mime_type:/\.jpg$/.test(name)?'image/jpeg':'application/x-hwp',category:/\.jpg$/.test(name)?'사진':'회의자료',tags:[],meeting_id:upload.meeting,created_at:new Date().toISOString()};
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
// 새 사업 보고 창을 열어 글을 채우고 사진 n장 + 자료를 고른다.
async function fillReport(page,{photos=7,papers=['자료.hwp']}={}){
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  const select=page.locator('#meetingNameSelect');if(await select.isVisible())await select.selectOption('__other__');
  await page.locator('#meetingTitle').fill('가짜 회의');
  await fillDateTime(page,'#meetingAt','2026-11-10T10:00');
  await page.locator('#meetingTranscript').fill('가짜 결과');
  if(photos)await page.locator('#meetingPhotoFiles').setInputFiles(Array.from({length:photos},(_,i)=>photo(i+1)));
  if(papers.length)await page.locator('#meetingFiles').setInputFiles(papers.map(name=>paper(name)));
}
const names=n=>[...Array.from({length:n},(_,i)=>`사진${i+1}.jpg`),'자료.hwp'];

for(const width of [412,1280]){
  test(`사진 7장 + 자료 1개 [저장]: 창이 바로 닫히고 아래 한 줄이 끝까지, 다시 열면 모두 붙어 있다 ${width}px`,async({page})=>{
    // PC는 낮은 화면(640)으로: 오른쪽 칸에 붙는 보고의 사진·회의자료 칸이 처음에는 화면 아래에 있다.
    const state=await boot(page,width,width<761?900:640);
    await fillReport(page);
    state.hold=true;
    await page.locator('#saveMeetingBtn').click();
    // 창은 올리기를 기다리지 않고 닫힌다: 첫 파일이 아직 서버에 붙잡혀 있다.
    await expect(page.locator('#meetingModal')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('사업 보고를 저장했습니다.');
    await expect.poll(()=>state.uploads.length).toBe(1);
    expect(state.posts).toBe(1);
    await expect(page.locator('#newMeetingBtn')).toBeEnabled();
    expect(await reloadAsks(page)).toBe(true); // 올리는 중 새로 고치면 줄에 선 파일이 사라지므로 먼저 묻는다
    // 폰: 창이 닫혀 올리는 줄을 보이는 화면이 없으므로 하단바 위 한 줄이 묶음 전체(8개)를 센다. PC: 저장한 보고가 오른쪽 칸에 붙어 그 칸의 올리는 줄이 맡는다.
    // 창이 닫혔으니 하단바 위 한 줄이 묶음 전체(8개)를 센다. PC는 저장한 보고가 오른쪽 칸에 붙어 그 칸에도 올리는 줄이 있지만,
    // 사진·회의자료 칸이 화면 아래에 있어 보이지 않는 동안은 한 줄이 진행을 알린다. 그 칸을 화면에 올리면 한 줄은 자리를 내준다.
    await expect(dock(page).locator('.up-dock-text')).toHaveText('파일 8개 올리는 중');
    await expect(dock(page).locator('.up-dock-pc')).toHaveText(/^\d+%$|마무리 중…/);
    if(width>=761){
      await expect(page.locator('#mcolResult #mrdPhotoRows .up-row')).toHaveCount(7);
      await expect(page.locator('#mcolResult #mrdDropRows .up-row')).toHaveCount(1);
      await page.locator('#mcolResult #mrdPhotoRows').scrollIntoViewIfNeeded();
      await expect(dock(page)).toHaveCount(0);
      await page.locator('#mcolResult #mrdMeta').scrollIntoViewIfNeeded();
      await page.evaluate(()=>{for(const node of [document.scrollingElement,...document.querySelectorAll('#appView *')])if(node&&node.scrollTop)node.scrollTop=0});
      await expect(dock(page).locator('.up-dock-text')).toHaveText('파일 8개 올리는 중');
    }
    // 한 번에 하나씩, 고른 순서대로.
    for(let sent=1;sent<8;sent++){
      await page.waitForTimeout(120);
      expect(state.uploads.length).toBe(sent);
      state.release();
      await expect.poll(()=>state.uploads.length).toBe(sent+1);
    }
    state.releaseAll();
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 7장·자료 1개 올렸어요');
    await expect(dock(page)).toHaveAttribute('data-state','note');
    expect(state.most).toBe(1);
    expect(state.uploads.map(u=>u.name)).toEqual(names(7));
    expect(state.uploads.every(u=>u.meeting===NEW_ID)).toBe(true);
    // 사진은 제목·종류·날짜를 실어 보내고(AI 채우기 건너뜀), 자료는 그대로.
    expect(state.uploads[0].raw).toContain('name="document_date"');
    expect(state.uploads[7].raw).not.toContain('name="document_date"');
    expect(await reloadAsks(page)).toBe(false);
    // 다시 열면 모두 붙어 있다.
    await openMeetingResult(page,NEW_ID);
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 7');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
    await expect(page.locator('#mrdPhotoRows .up-row,#mrdDropRows .up-row')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });

  test(`못 올린 파일은 아래 한 줄에 [다시 올리기] — 못 올린 파일만 다시 ${width}px`,async({page})=>{
    const state=await boot(page,width);
    state.failNames.add('사진2.jpg');
    await fillReport(page,{photos:2});
    await page.locator('#saveMeetingBtn').click();
    await expect(page.locator('#meetingModal')).toBeHidden();
    await expect.poll(()=>state.uploads.length).toBe(3);
    const line=dock(page);
    await expect(line.locator('.up-dock-text')).toHaveText('사진 1장 못 올렸어요');
    await expect(line).toHaveAttribute('role','alert');
    // 작은 둘째 줄: 올라간 것 + 까닭.
    await expect(line.locator('.up-dock-note')).toHaveText(/^사진 1장·자료 1개 올렸어요 · 파일을 업로드하지 못했어요/);
    const again=line.getByRole('button',{name:'못 올린 파일 다시 올리기'});
    await expect(again).toHaveText('다시 올리기');
    // 저절로 사라지지 않는다(누를 때까지).
    await page.waitForTimeout(600);
    await expect(again).toBeVisible();
    state.failNames.clear();
    await again.click();
    await expect.poll(()=>state.uploads.length).toBe(4);
    expect(state.uploads[3].name).toBe('사진2.jpg');
    expect(state.uploads[3].meeting).toBe(NEW_ID);
    // 다시 올린 뒤의 끝 글은 그 묶음 전체다(모두 붙었다).
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장·자료 1개 올렸어요');
    await expect(dock(page).getByRole('button',{name:'못 올린 파일 다시 올리기'})).toHaveCount(0);
    await openMeetingResult(page,NEW_ID);
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
    expect(state.errors).toEqual([]);
  });
}

test('올리는 중에 다른 화면으로 가도 끝까지 · 그 보고를 다시 열면 사진·자료 칸에 올리는 줄, 끝나면 저절로 채워진다 412px',async({page})=>{
  const state=await boot(page,412);
  await fillReport(page,{photos:3});
  state.hold=true;
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>state.uploads.length).toBe(1);
  // 다른 화면으로: 한 줄이 따라오고 올리기는 이어진다.
  await clickView(page,'home');
  await expect(dock(page).locator('.up-dock-text')).toHaveText('파일 4개 올리는 중');
  state.release();
  await expect.poll(()=>state.uploads.length).toBe(2);
  await expect(dock(page).locator('.up-dock-text')).toHaveText('파일 3개 올리는 중');
  // 그 보고를 다시 연다: 올라간 사진 1장은 이미 붙어 있고, 남은 것은 제 칸에 올리는 줄로 보인다(아래 한 줄은 그 줄에 자리를 내준다).
  await clickView(page,'meetings');
  await openMeetingResult(page,NEW_ID);
  await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 1');
  await expect(page.locator('#mrdPhotoRows .up-row')).toHaveCount(2);
  await expect(page.locator('#mrdPhotoRows .up-sum')).toContainText('올리는 중 2개');
  await expect(page.locator('#mrdPhotoRows .up-row').nth(1)).toContainText('대기');
  await expect(page.locator('#mrdDropRows .up-row')).toHaveCount(1);
  await expect(page.locator('#mrdDropRows .up-row')).toContainText('자료.hwp');
  await expect(page.locator('#mrdDropRows .up-row')).toContainText('대기');
  await expect(dock(page)).toHaveCount(0);
  // 한 장 더 올라가면 사진 칸이 저절로 채워진다.
  state.release();
  await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
  await expect(page.locator('#mrdPhotoRows .up-row')).toHaveCount(1);
  state.releaseAll();
  await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 3');
  await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
  await expect(page.locator('#mrdPhotoRows .up-row,#mrdDropRows .up-row')).toHaveCount(0);
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 3장·자료 1개 올렸어요');
  expect(state.most).toBe(1);
  expect(state.uploads.every(u=>u.meeting===NEW_ID)).toBe(true);
  await closeMeetingResult(page);
  expect(state.errors).toEqual([]);
});

test('차례를 기다리는 파일의 ✕: 그 파일만 보내지 않고 나머지는 끝까지 412px',async({page})=>{
  const state=await boot(page,412);
  await fillReport(page,{photos:2});
  state.hold=true;
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>state.uploads.length).toBe(1);
  await openMeetingResult(page,NEW_ID);
  await page.getByRole('button',{name:'사진2.jpg 올리기 취소'}).click();
  await expect(page.locator('#mrdPhotoRows .up-row')).toHaveCount(1);
  state.releaseAll();
  await expect.poll(()=>state.uploads.length).toBe(2);
  expect(state.uploads.map(u=>u.name)).toEqual(['사진1.jpg','자료.hwp']);
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 1장·자료 1개 올렸어요 · 1개 취소');
  await expect(dock(page).getByRole('button',{name:'못 올린 파일 다시 올리기'})).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('글 저장이 실패하면 창은 닫히지 않고 아무것도 보내지 않는다 · 다시 [저장]하면 닫히고 올라간다 412px',async({page})=>{
  const state=await boot(page,412);
  state.failMeeting=true;
  await fillReport(page,{photos:1});
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingStatus')).toHaveClass(/error/);
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#saveMeetingBtn')).toBeEnabled();
  expect(state.uploads).toEqual([]);
  await expect(dock(page)).toHaveCount(0);
  // 고른 사진·자료는 창에 그대로 남아 있다.
  await expect(page.locator('#meetingSelectedFiles')).toContainText('자료.hwp');
  state.failMeeting=false;
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>state.uploads.length).toBe(2);
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 1장·자료 1개 올렸어요');
  expect(state.posts).toBe(2);
  expect(state.errors).toEqual([]);
});
