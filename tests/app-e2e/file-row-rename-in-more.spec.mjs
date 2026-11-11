import {test,expect} from '@playwright/test';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
// FILE-이름고치기연필먹통(S57-4, 요청함 11/11 07:00 + 명진 "⋯가 있으니 필요한 메뉴면 ⋯ 안으로 넣자"):
// 사업 보고 결과 창 회의자료 줄은 ✎ 없이 ⋯ 안 [이름 수정]으로 고치고, 줄 전체를 덮는 열기 단추(.file-line-open) 위에서도
// 이름 두 번 누르기(PC)·꾹 누르기(폰)가 이름 칸을 열며, 한 번 누르기는 지금처럼 파일 열기다. 이름 칸이 열린 줄은 칸 안을 눌러도 파일이 열리지 않는다.
// 가짜 데이터만(사람·회의 이름 없음).
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const meeting={id:'meeting-1',workspace_id:'ws',title:'가상 점검 회의',series_name:'가상 점검 회의',meeting_at:'2026-10-10T10:00:00Z',transcript_text:'회의 원문',created_by:'owner'};
const doc=(i,name)=>({id:'doc-'+i,workspace_id:'ws',meeting_id:meeting.id,file_id:'driveFile'+i,file_name:name,title:name,mime_type:'application/pdf',drive_url:`https://drive.google.com/file/d/driveFile${i}/view`,file_size:20480,category:'회의자료',tags:[],created_at:'2026-10-10T00:00:00Z'});

async function boot(page,width){
  await page.setViewportSize({width,height:900});
  const state={docs:[doc(0,'first.pdf'),doc(1,'second.pdf')],renames:[],errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')state.errors.push(m.text())});
  // 파일 열기는 숨은 링크(<a target=_blank hidden>) 누르기 — 새 탭을 열지 않고 눌린 주소만 센다.
  await page.addInitScript(()=>{window.__opens=[];document.addEventListener('click',e=>{const a=e.target instanceof Element?e.target.closest('a[target="_blank"]'):null;if(a&&a.hidden){window.__opens.push(a.href);e.preventDefault()}},true)});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner',email:'owner@example.org'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings')return ok([meeting]);
    if(path==='/rest/v1/app_documents'){
      const id=url.searchParams.get('id')?.replace(/^eq\./,''),mid=url.searchParams.get('meeting_id')?.replace(/^eq\./,'');
      return ok(state.docs.filter(d=>(!id||d.id===id)&&(!mid||d.meeting_id===mid)));
    }
    if(path==='/functions/v1/document-actions'){
      const body=req.postDataJSON();
      if(body.action==='rename-file'){
        state.renames.push(body);
        const d=state.docs.find(x=>x.id===body.id),ext=d.file_name.slice(d.file_name.lastIndexOf('.')),name=body.base+ext;
        d.file_name=name;d.title=name;
        return ok({ok:true,name,drive_file_id:body.drive_file_id,notes:[],updated:{documents:1}});
      }
      return ok({ok:true});
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
const opens=page=>page.evaluate(()=>window.__opens.slice());
const nameBox=async(page,id)=>{const box=await page.locator(`#mrdMaterials [data-mrd-doc-row="${id}"] .file-line-main b`).boundingBox();expect(box).toBeTruthy();return box};
const rowMore=(page,id)=>page.locator(`#mrdMaterials [data-mrd-doc-row="${id}"] .file-line-more > summary`);
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);

for(const width of [412,1280])test(`보고 자료 ⋯ [이름 수정]: ✎ 없이 ⋯ 안, 그 자리 칸에서 고치면 Drive 이름 요청이 가고 파일은 열리지 않는다 ${width}px`,async({page})=>{
  const state=await boot(page,width);
  await openMeetingResult(page,'meeting-1');
  const rows=page.locator('#mrdMaterials .mrd-file-row');await expect(rows).toHaveCount(2);
  await expect(page.locator('#mrdMaterials .fr-edit')).toHaveCount(0); // 줄에 ✎ 따로 없음
  await rowMore(page,'doc-0').click();
  const panel=page.locator('#mrdMaterials [data-mrd-doc-row="doc-0"] .file-line-more-panel');
  await expect(panel.getByRole('button')).toHaveText(['Drive에서 열기','내려받기','이름 수정','빼기','삭제']);
  expect(await noOverflow(page)).toBeLessThanOrEqual(1);
  if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/rename-menu-${width}.png`});
  await panel.getByRole('button',{name:/이름 수정/}).click();
  const row=page.locator('#mrdMaterials [data-mrd-doc-row="doc-0"]'),input=row.locator('.fr-input');
  await expect(input).toBeVisible();await expect(input).toBeFocused();await expect(input).toHaveValue('first');
  await expect(row.locator('.fr-ext')).toHaveText('.pdf');
  await expect(row.locator('details.file-line-more')).not.toHaveAttribute('open','');
  if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/rename-open-${width}.png`});
  // 칸 안을 마우스로 눌러도 줄의 열기가 눌리지 않는다(이름 글자의 pointer-events:none을 물려받지 않음).
  await input.click();
  await expect(input).toBeFocused();
  expect(await opens(page)).toEqual([]);
  await input.fill('새 이름');
  await row.locator('[data-fr-save]').click(); // [저장]도 마우스로 닿는다
  await expect(row.locator('.file-line-main b')).toHaveText('새 이름.pdf');
  await expect(input).toHaveCount(0);
  expect(state.renames).toEqual([{action:'rename-file',target:'document',id:'doc-0',drive_file_id:'driveFile0',base:'새 이름'}]);
  await expect(page.locator('#toast')).toHaveText('Drive 원본 이름도 바꿨어요.');
  expect(await opens(page)).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('보고 자료 ⋯ [이름 수정]: 고치는 동안 줄의 빈 자리를 눌러도 열리지 않고, [취소]·Esc로 닫으면 이름 그대로다 (412px)',async({page})=>{
  const state=await boot(page,412);
  await openMeetingResult(page,'meeting-1');
  await rowMore(page,'doc-1').click();
  await page.locator('#mrdMaterials [data-mrd-doc-row="doc-1"] .file-line-more-panel').getByRole('button',{name:/이름 수정/}).click();
  const row=page.locator('#mrdMaterials [data-mrd-doc-row="doc-1"]'),input=row.locator('.fr-input');
  await expect(input).toBeVisible();
  // 줄 맨 왼쪽 종류 표시 자리를 눌러 본다 — 고치는 동안 덮개는 눌림을 받지 않는다.
  const kind=await row.locator('.file-kind').boundingBox();
  await page.mouse.click(kind.x+kind.width/2,kind.y+kind.height/2);
  await page.waitForTimeout(400);
  expect(await opens(page)).toEqual([]);
  await input.fill('다른 이름');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(row.locator('.file-line-main b')).toHaveText('second.pdf');
  expect(state.renames).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('열기 덮개 위 이름 손짓 (PC 1280px): 한 번 누르기는 파일 열기, 두 번 누르기는 이름 칸 — 열기는 일어나지 않는다',async({page})=>{
  const state=await boot(page,1280);
  await openMeetingResult(page,'meeting-1');
  // 한 번 누르기(이름 글자 위): 두 번 누르기를 잠깐(0.28초) 기다린 뒤 열기.
  let box=await nameBox(page,'doc-0');
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect.poll(()=>opens(page)).toHaveLength(1);
  expect((await opens(page))[0]).toContain('driveFile0');
  // 이름 글자가 아닌 빈 자리 한 번 누르기도 열기(덮개 본래 동작).
  const row1=await page.locator('#mrdMaterials [data-mrd-doc-row="doc-1"]').boundingBox();
  await page.mouse.click(row1.x+row1.width-120,row1.y+row1.height/2);
  await expect.poll(()=>opens(page)).toHaveLength(2);
  // 두 번 누르기: 이름 칸이 열리고 더 열리지 않는다.
  box=await nameBox(page,'doc-1');
  await page.mouse.dblclick(box.x+Math.min(12,box.width/2),box.y+box.height/2);
  const input=page.locator('#mrdMaterials [data-mrd-doc-row="doc-1"] .fr-input');
  await expect(input).toBeVisible();await expect(input).toHaveValue('second');
  await page.waitForTimeout(500);
  expect(await opens(page)).toHaveLength(2);
  expect(state.errors).toEqual([]);
});

test('열기 덮개 위 이름 손짓 (폰 412px): 이름 꾹 누르기(0.5초) 손 떼면 이름 칸, 짧게 누르면 파일 열기',async({page})=>{
  const state=await boot(page,412);
  await openMeetingResult(page,'meeting-1');
  const touch=(type,x,y)=>page.evaluate(([type,x,y])=>{
    const t=document.elementFromPoint(x,y);
    t.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,pointerId:5,pointerType:'touch',isPrimary:true,clientX:x,clientY:y}));
    return t.className;
  },[type,x,y]);
  const box=await nameBox(page,'doc-0'),x=box.x+Math.min(12,box.width/2),y=box.y+box.height/2;
  // 꾹 누르기: 덮개가 눌림을 받는 자리(이름 글자 위)에서 시작해도 이름 칸이 열린다.
  expect(await touch('pointerdown',x,y)).toContain('file-line-open');
  await page.waitForTimeout(650);
  await touch('pointerup',x,y);
  const input=page.locator('#mrdMaterials [data-mrd-doc-row="doc-0"] .fr-input');
  await expect(input).toBeVisible();await expect(input).toHaveValue('first');
  expect(await opens(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  // 짧게 눌러 손 떼기는 이름 칸이 열리지 않는다(열기는 덮개 본래 누르기).
  await touch('pointerdown',x,y);await touch('pointerup',x,y);
  await page.waitForTimeout(200);
  await expect(page.locator('#mrdMaterials .fr-input')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

for(const width of [360,412])test(`파일 줄 상태 글자는 좁은 칸에서도 한 글자씩 세로로 꺾이지 않는다 ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:800});
  await page.goto(`${BASE}/tests/app-e2e/file-line-state-fixture.html`);
  for(const state of await page.locator('.file-line-state').all()){
    const text=(await state.textContent()).trim(),box=await state.boundingBox();
    // 짧은 글('업로드 중' 등)은 한 줄, 긴 안내 글은 띄어쓰기에서 몇 줄로 — 어느 쪽이든 한 글자 폭으로 세로로 쌓이지 않는다.
    if([...text].length<=8)expect(box.height,text).toBeLessThan(22);
    else{expect(box.width,text).toBeGreaterThan(60);expect(box.height,text).toBeLessThan(80)}
  }
  expect(await noOverflow(page)).toBeLessThanOrEqual(1);
});
