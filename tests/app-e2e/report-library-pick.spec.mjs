import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
import {addReport} from './helpers/report-add.mjs';
// S67-39(사용자 11/20 20:20 "자료 + 자료실에서 추가도 가능하게", 20:25 "사업보고 사진 지우기 가능하게"):
// ① 사업 보고 '자료 +'는 작은 메뉴 [기기에서 올리기]·[자료실에서 선택] 두 갈래다.
// ② 자료실에서 고른 자료는 저장 전엔 '저장하면 붙어요' 칩, 저장하면 그 자료 행의 사업 보고 칸만 채운다(파일 다시 올리기 없음 — 올리기 요청 0).
//    다른 보고에 붙은 자료는 흐리게 '다른 보고에 있음'(고를 수 없음). 보기 창 [+]에서 고르면 바로 붙는다.
// ③ 붙은 사진은 크게 보기 ⋯ [빼기]로 이 보고에서만 뺀다(한 번 묻기). 자료 행·Drive 원본은 그대로(삭제 요청 0), [되돌리기]로 다시 붙는다.
// 이름·번호는 모두 합성 값(네트워크 없음).
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const meeting={id:'meeting-1',workspace_id:'ws',title:'자료 확인 회의',series_name:'자료 확인 회의',meeting_at:'2026-10-10T10:00:00Z',transcript_text:'회의 원문',created_by:'owner',activity_kind:'meeting'};
const ID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PHOTO=ID(1),FREE1=ID(2),FREE2=ID(3),OTHER=ID(4);
const doc=(id,name,extra={})=>({id,workspace_id:'ws',meeting_id:null,file_name:name,title:name,category:'기타',tags:[],created_at:'2026-10-09T00:00:00Z',...extra});

async function boot(page,width){
  await page.setViewportSize({width,height:900});
  const state={docs:[
    doc(PHOTO,'현장.jpg',{meeting_id:meeting.id,mime_type:'image/jpeg',file_id:'drive-photo-on',drive_url:'https://drive.google.com/file/d/drive-photo-on/view'}),
    doc(FREE1,'예산안.pdf',{mime_type:'application/pdf',file_id:'drive-free-1'}),
    doc(FREE2,'결의문.hwp',{file_id:'drive-free-2'}),
    doc(OTHER,'다른 보고 자료.pdf',{meeting_id:'meeting-other',file_id:'drive-other-1'}),
  ],patches:[],uploads:[],deletes:[],errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings')return ok([{...meeting,...(['POST','PATCH'].includes(req.method())?req.postDataJSON():{})}]);
    if(path==='/rest/v1/app_documents'){
      // PostgREST 거르기 흉내: id=eq.x|in.(a,b), meeting_id=eq.x|is.null, workspace_id=eq.x.
      const q=Object.fromEntries(url.searchParams),idQ=q.id||'',midQ=q.meeting_id||'';
      const ids=idQ.startsWith('in.(')?idQ.slice(4,-1).split(','):idQ?[idQ.replace(/^eq\./,'')]:null;
      const match=d=>(!ids||ids.includes(d.id))&&(!midQ||(midQ==='is.null'?d.meeting_id==null:d.meeting_id===midQ.replace(/^eq\./,'')))&&(!q.workspace_id||'eq.'+d.workspace_id===q.workspace_id);
      if(req.method()==='PATCH'){const body=req.postDataJSON();state.patches.push({q,body});const hit=state.docs.filter(match);hit.forEach(d=>Object.assign(d,body));return ok(hit.map(d=>({id:d.id,meeting_id:d.meeting_id})));}
      if(req.method()!=='GET')return ok([]);
      return ok(state.docs.filter(match));
    }
    if(path==='/functions/v1/library-files'&&req.method()==='GET')return route.fulfill({status:200,contentType:'image/png',body:PNG});
    if(['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path)){state.uploads.push(path);return ok({ok:true})}
    if(path==='/functions/v1/document-actions'){state.deletes.push(req.postDataJSON());return ok({ok:true})}
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
const menu=page=>page.locator('#reportAddMenu');
const picker=page=>page.locator('#reportLibPicker');

for(const width of [412,1280]){
  test(`새 사업 보고: 자료 + 는 두 갈래, 자료실에서 고른 자료는 칩으로 있다가 저장하면 붙고 다시 올리지 않는다 ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await addReport(page);
    await page.locator('#meetingNameSelect').selectOption('__other__');
    await page.locator('#meetingTitle').fill('자료 고르기 회의');
    await fillDateTime(page,'#meetingAt','2026-10-10T10:00');
    // ① 두 갈래 메뉴
    await page.locator('#meetingPickFiles').click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('button')).toHaveText(['기기에서 업로드','자료실에서 선택']);
    // 두 줄은 서로 덮지 않는다(공용 글자 버튼의 넓힌 누르는 자리가 옆 줄을 가리던 것 — CI에서 [기기에서 올리기]를 못 누름).
    expect(await menu(page).evaluate(m=>[...m.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.height>=40&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b}))).toBe(true);
    // [기기에서 올리기] = 지금까지처럼 파일 고르기
    const chooser=page.waitForEvent('filechooser');
    await menu(page).locator('[data-report-add="device"]').click();
    await (await chooser).setFiles([]);
    await expect(menu(page)).toBeHidden();
    // ② [자료실에서 선택]
    await page.locator('#meetingPickFiles').click();
    await menu(page).locator('[data-report-add="library"]').click();
    await expect(picker(page)).toBeVisible();
    const item=name=>picker(page).locator('.lu-move-item',{hasText:name});
    await expect(item('다른 보고 자료')).toHaveAttribute('aria-disabled','true');
    await expect(item('다른 보고 자료')).toContainText('다른 보고에 있음');
    await expect(item('현장')).toHaveAttribute('aria-disabled','true'); // 다른 보고(meeting-1)에 붙은 사진
    await item('예산안').click();await item('결의문').click();
    await picker(page).locator('[data-lu-move-done]').click();
    await expect(picker(page)).toBeHidden();
    const chips=page.locator('#meetingSelectedFiles [data-meeting-pick]');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText('저장하면 붙어요');
    // 칩 × = 선택 취소(서버 요청 없음)
    await page.locator(`#meetingSelectedFiles [data-meeting-remove-pick="${FREE2}"]`).click();
    await expect(chips).toHaveCount(1);
    // 다시 열면 고른 것은 '이미 있음'
    await page.locator('#meetingPickFiles').click();await menu(page).locator('[data-report-add="library"]').click();
    await expect(item('예산안')).toHaveAttribute('aria-disabled','true');await expect(item('예산안')).toContainText('이미 있음');
    await page.keyboard.press('Escape');await expect(picker(page)).toBeHidden();
    expect(state.patches).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    // 저장 → 그 자료 행만 이 보고에(안 붙은 줄만), 올리기 요청 없음
    await page.locator('#meetingTranscript').fill('원문');
    await page.locator('#saveMeetingBtn').click();
    await expect(page.locator('#meetingModal')).toBeHidden();
    await expect.poll(()=>state.patches.length).toBe(1);
    expect(state.patches[0].q).toMatchObject({workspace_id:'eq.ws',id:`in.(${FREE1})`,meeting_id:'is.null'});
    expect(state.patches[0].body).toMatchObject({meeting_id:'meeting-1'});
    expect(state.docs.find(d=>d.id===FREE1).meeting_id).toBe('meeting-1');
    expect(state.docs.find(d=>d.id===FREE2).meeting_id).toBe(null);
    expect(state.uploads).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test(`보고 창: 자료 + [자료실에서 선택]은 바로 붙이고, 사진 ⋯ [빼기]는 연결만 끊고 원본을 남긴다 ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await openMeetingResult(page,'meeting-1');
    const modal=page.locator('#meetingRoundDetailModal');
    await expect(modal.locator('#mrdPhotosHead')).toHaveText('사진 1');
    // 자료실에서 선택 → 바로 붙음
    await modal.locator('#mrdPickFiles').click();
    await expect(menu(page).getByRole('button')).toHaveText(['기기에서 업로드','자료실에서 선택']);
    await menu(page).locator('[data-report-add="library"]').click();
    const item=name=>picker(page).locator('.lu-move-item',{hasText:name});
    await expect(item('현장')).toContainText('이미 있음');
    await item('예산안').click();
    await picker(page).locator('[data-lu-move-done]').click();
    await expect(modal.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
    await expect(modal.locator('#mrdMaterials')).toContainText('예산안.pdf');
    expect(state.patches[0].q).toMatchObject({workspace_id:'eq.ws',id:`in.(${FREE1})`,meeting_id:'is.null'});
    expect(state.uploads).toEqual([]);
    // 사진 ⋯ [빼기]
    await expect(modal.locator('#mrdPhotos .act-photo-thumb[data-state="shown"] img')).toHaveCount(1);
    await modal.locator('#mrdPhotos .act-photo-thumb').first().click();
    const view=page.locator('.basket-photo-view');await expect(view).toBeVisible();
    await view.locator('.basket-photo-more-btn').click();
    const panel=view.locator('.basket-photo-more-panel');
    await expect(panel).toContainText('빼기');await expect(panel).toContainText('삭제');
    await panel.getByRole('button',{name:'빼기',exact:true}).click();
    expect(await answerAsk(page,true)).toBe('“현장.jpg”을(를) 이 보고에서 뺄까요?');
    await expect(modal.locator('#mrdPhotosHead')).toHaveText('사진');
    const last=state.patches.at(-1);
    expect(last.q).toMatchObject({id:'eq.'+PHOTO,workspace_id:'eq.ws',meeting_id:'eq.meeting-1'});
    expect(last.body).toMatchObject({meeting_id:null});
    // 원본은 그대로: 자료 행 남음, 삭제 요청 없음
    expect(state.docs.find(d=>d.id===PHOTO)).toBeTruthy();
    expect(state.deletes).toEqual([]);
    const undo=page.locator('[data-undo-notice]');
    await expect(undo.locator('[data-undo-text]')).toHaveText('이 보고에서 뺐어요. 사진은 자료실에 그대로 있어요.');
    await undo.locator('[data-undo-action]').click();
    await expect(modal.locator('#mrdPhotosHead')).toHaveText('사진 1');
    expect(state.errors).toEqual([]);
  });
}
