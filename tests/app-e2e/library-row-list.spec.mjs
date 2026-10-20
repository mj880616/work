import {selectFilter,filterOptions} from './helpers/filter-chips.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import {execFileSync} from 'node:child_process';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');
const V2={project_system:'v2',management_version:2};

function baseState(){
  const space=(id,name,sort,extra={})=>({id,workspace_id:'workspace-1',name,description:null,parent_id:null,status:'active',visibility:'private',owner_id:'user-1',sort_order:sort,created_at:`2026-09-01T00:00:${String(sort).padStart(2,'0')}Z`,updated_at:now(),metadata:{...V2},...extra});
  return {
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    spaces:[
      space('legacy-1','기존 일반 공간',5,{metadata:{}}),
      space('top-a','공공기관 기능개혁 대응',10),
      space('child-a1','국토부 대응',20,{parent_id:'top-a',metadata:{}}),
      space('child-a2','산자부 대응',30,{parent_id:'top-a'}),
      space('child-a3','보관된 하위',35,{parent_id:'top-a',status:'archived'}),
      space('top-b','민자철도 정책 대응',40),
      space('child-b1','9/29 국회토론회',50,{parent_id:'top-b',status:'done'}),
      space('top-c','보관된 상위',60,{status:'archived'}),
      space('child-c1','보관 상위의 하위',65,{parent_id:'top-c'}),
      space('orphan-1','고아 하위 프로젝트',70,{parent_id:'legacy-1'}),
      space('other-owner','다른 사용자 프로젝트',15,{owner_id:'user-2'})
    ],
    docs:[
      {id:'doc-a',workspace_id:'workspace-1',project_id:'top-a',title:'상위 자료',category:'정부자료',tags:[],created_at:now()},
      {id:'doc-a1',workspace_id:'workspace-1',project_id:'child-a1',title:'하위 자료',category:'정책자료',tags:[],created_at:now()},
      {id:'doc-none',workspace_id:'workspace-1',project_id:null,title:'미연결 자료',category:'기타',tags:[],created_at:now()},
      {id:'doc-archived',workspace_id:'workspace-1',project_id:'top-c',title:'보관 프로젝트 자료',category:'기타',source:'원래 출처',tags:[],created_at:now()},
      {id:'doc-legacy',workspace_id:'workspace-1',project_id:'legacy-1',title:'기존 공간 자료',category:'기타',tags:[],created_at:now()},
      {id:'doc-missing',workspace_id:'workspace-1',project_id:'gone-1',title:'확인 불가 자료',category:'기타',tags:[],created_at:now()}
    ],
    uploads:[],patches:[],spaceReads:[]
  };
}

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/library-files'){
      const raw=(req.postDataBuffer()||Buffer.from('')).toString('utf8');
      const field=name=>raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]??null;
      state.uploadAttempts?.push(field('project_id'));
      const failure=state.uploadFailures?.shift();
      if(failure)return route.fulfill({status:failure.status,contentType:'application/json',body:JSON.stringify(failure.body)});
      const row={id:`upload-${state.uploads.length+1}`,workspace_id:'workspace-1',project_id:field('project_id'),title:field('title')||'업로드',category:'기타',tags:[],created_at:now()};
      state.uploads.push(row);state.docs.push(row);
      return ok({ok:true,document:row});
    }
    if(path==='/functions/v1/workspace-drive'){state.downloads.push(body);return ok({url:'http://127.0.0.1:8123/tests/app-e2e/library-open-fixture.html?download=1'})}
    if(path==='/functions/v1/document-actions'){state.deletes.push(body);state.docs=state.docs.filter(d=>d.id!==body.document_id);return ok({ok:true})}
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_spaces'){
      if(method==='GET'){
        const id=eq(url,'id'),owner=eq(url,'owner_id');
        state.spaceReads.push(url.search);
        let rows=id?state.spaces.filter(x=>x.id===id):state.spaces;
        rows=rows.filter(x=>!owner||x.owner_id===owner).sort((a,b)=>a.sort_order-b.sort_order);
        return ok(rows);
      }
      if(method==='POST'){const row={...(body||{}),id:`project-new-${state.spaces.length+1}`,created_at:now(),updated_at:now()};state.spaces.push(row);return ok([row])}
      if(method==='PATCH'){const id=eq(url,'id'),row=state.spaces.find(x=>x.id===id);if(row)Object.assign(row,body||{},{updated_at:now()});return ok([])}
    }
    if(path==='/rest/v1/app_meetings')return ok((state.meetings||[{id:'library-qa-meeting',workspace_id:'workspace-1',title:'회귀 확인 회의',meeting_name:'회귀 확인 회의',round_no:2,meeting_at:'2026-10-06T12:00:00',created_by:state.user.id}]).filter(m=>!eq(url,'id')||m.id===eq(url,'id')));
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id'),workspace=eq(url,'workspace_id'),pid=eq(url,'project_id'),mid=eq(url,'meeting_id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!workspace||x.workspace_id===workspace)&&(!pid||x.project_id===pid)&&(!mid||x.meeting_id===mid)));
      if(method==='PATCH'){
        state.patches.push({id,body});
        const rows=state.docs.filter(row=>row.id===id&&(!workspace||row.workspace_id===workspace));
        rows.forEach(row=>Object.assign(row,body||{}));
        return req.headers().prefer?.includes('return=representation')?ok(rows):route.fulfill({status:204,body:''});
      }
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page,target='http://127.0.0.1:8123/app/'){
  await page.goto(target);
  await enterLogin(page);
  await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

const MAIN='96eeb04a16fd93d532222795ada9c09baec9f323';
async function boot(page,{width=390,main=false}={}){
  await page.setViewportSize({width,height:900});
  if(main){const cache=new Map();await page.route(/^http:\/\/127\.0\.0\.1:8123\/app\//,route=>{
    let path=new URL(route.request().url()).pathname.slice(1);if(path.endsWith('/'))path+='index.html';
    if(!/\.(css|js|html)$/.test(path))return route.continue();
    if(!cache.has(path))cache.set(path,execFileSync('git',['show',MAIN+':'+path],{encoding:'utf8'}));
    return route.fulfill({contentType:path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html',body:cache.get(path)});
  })}
  const state=baseState();state.downloads=[];state.deletes=[];
  state.docs=['hwp','pdf','xlsx','docx','pptx','zip','HWPX','xls','doc','ppt'].map((ext,i)=>({
    id:'row-'+i,workspace_id:'workspace-1',project_id:'top-a',title:i===0?'긴 자료 제목 '.repeat(30):'자료 '+i,
    file_name:'sample.'+ext,category:'정책자료',document_date:i===5?null:'2026-10-06',
    source:'목록에 표시하지 않을 출처',file_size:2048,description:'목록에 표시하지 않을 요약',tags:['검색태그'],
    drive_url:'http://127.0.0.1:8123/tests/app-e2e/library-open-fixture.html',created_at:'2026-10-06T00:00:00Z'
  }));
  await mockApp(page,state);await signIn(page,'http://127.0.0.1:8123/app/?view=library');
  await expect(page.locator('[data-lu-document]')).toHaveCount(10);
  return state;
}
async function menu(page,id='row-0'){await page.locator(`[data-lu-document="${id}"] .lu-more-trigger`).click();await expect(page.locator('.lu-more-panel')).toBeVisible()}

for(const width of [390,1440]){
  test('library rows show only compact fields, fit viewport and keep header actions '+width,async({page,browser})=>{
    await boot(page,{width});
    const rows=page.locator('.lu-row');await expect(rows).toHaveCount(10);
    const kind=rows.first().locator('.lu-file-kind');
    for(const [property,value]of [['width','36px'],['height','36px'],['border-radius','8px'],['font-size','11px']])await expect(kind).toHaveCSS(property,value);
    // UI-디자인기준 3/3(8-9e-1): 상자 안 줄 단위(줄 최소 44px), 이름 13px·400, 보조 줄 12px.
    await expect(rows.first()).toHaveCSS('gap','10px');await expect(rows.first()).toHaveCSS('padding','9px 0px');await expect(rows.first()).toHaveCSS('min-height','44px');
    await expect(rows.first().locator('.lu-row-title')).toHaveCSS('font-size','13px');await expect(rows.first().locator('.lu-row-title')).toHaveCSS('font-weight','400');
    await expect(rows.first().locator('.lu-row-meta')).toHaveCSS('font-size','12px');
    expect(await rows.locator('.lu-file-kind').allTextContents()).toEqual(['HWP','PDF','XLS','DOC','PPT','파일','HWP','XLS','DOC','PPT']);
    // UI-바구니첨부메모 ⑪: 분류 꼬리표(정책자료 → 정책) + 날짜. 날짜 없는 자료는 등록일(같은 10.06)로 같은 달 묶음.
    await expect(rows.first().locator('.lu-row-meta')).toHaveText('정책 10.06');
    await expect(rows.nth(5).locator('.lu-row-meta')).toHaveText('정책');
    await expect(rows.locator('.badges,.compact-entry-summary,.lu-document-actions')).toHaveCount(0);
    await expect(page.locator('[data-lu-download]')).toBeHidden();
    await expect(page.locator('[data-lu-edit]')).toBeHidden();
    await expect(page.locator('[data-lu-delete]')).toBeHidden();
    expect(await rows.first().innerText()).not.toMatch(/출처|요약|2.0KB/);
    await expect(page.locator('.lu-row-title').first()).toHaveCSS('white-space','nowrap');
    await expect(page.locator('.lu-row-title').first()).toHaveCSS('text-overflow','ellipsis');
    expect(await page.locator('.lu-row-title').first().evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#libraryView>.section-head.actions-only')).toHaveCount(0);
    expect(await page.locator('#libraryListCard .add-list-head button').evaluateAll(xs=>xs.map(x=>x.id))).toEqual(['manageLibraryBtn','newDocumentBtn']);
    await page.locator('#manageLibraryBtn').click();await expect(page.locator('#libraryManageModal')).toBeVisible();
    await page.locator('#libraryManageClose').click();await expect(page.locator('#libraryManageModal')).toBeHidden();
    const before=await browser.newPage();await boot(before,{width,main:true});
    expect((await rows.first().boundingBox()).height).toBeLessThan((await before.locator('[data-lu-document]').first().boundingBox()).height);
    // UI-디자인기준 3/3(8-9e-1): library and meeting rows are the same line rows in a 0.5px box (they used to match the old
    // meeting card row of main). Compare the real neighboring renderer with the same API data.
    const style=el=>el.evaluate(el=>{const s=getComputedStyle(el);return Object.fromEntries(['paddingTop','paddingBottom','minHeight','borderRadius','boxShadow','backgroundColor'].map(k=>[k,s[k]]))});
    const libraryRow=await style(rows.nth(1));
    // UI-PC회의: PC(≥1024)의 회의는 유형별 열이라 줄 비교는 폰·중간 폭에서만 한다.
    if(width<1024){
      await clickView(page,'meetings');await page.waitForFunction(()=>window.KPTUViewLoader.isLoaded('meetings'));await expect(page.locator('#meetingList .meeting-list-row').first()).toBeVisible();
      const meetingRows=page.locator('#meetingList .meeting-list-row');
      expect(await style(meetingRows.nth(await meetingRows.count()>1?1:0))).toEqual(libraryRow);
    }else{
      await clickView(page,'meetings');await page.waitForFunction(()=>window.KPTUViewLoader.isLoaded('meetings'));await expect(page.locator('#meetingList .mcol-card').first()).toBeVisible();
    }
    expect(libraryRow).toEqual({paddingTop:'9px',paddingBottom:'9px',minHeight:'44px',borderRadius:'0px',boxShadow:'none',backgroundColor:'rgba(0, 0, 0, 0)'});
    await before.close();
  });
  test('library menu closes outside, Escape and Back without opening document '+width,async({page})=>{
    await boot(page,{width});const url=page.url();
    await menu(page);await expect(page).toHaveURL(url);
    const panel=await page.locator('.lu-more-panel').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width);expect(panel.y+panel.height).toBeLessThanOrEqual(900);
    await page.keyboard.press('Escape');await expect(page.locator('.lu-more-panel')).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuLibraryMenu||null)).toBe(null);
    await menu(page);await page.locator('#libraryListCard h2').click();await expect(page.locator('.lu-more-panel')).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuLibraryMenu||null)).toBe(null);
    await menu(page);await page.goBack();await expect(page.locator('.lu-more-panel')).toBeHidden();await expect(page).toHaveURL(url);
    // D-3c pseudo-element: click 4px outside the visible 32px icon.
    const trigger=page.locator('.lu-more-trigger').first(),r=await trigger.boundingBox();expect(r.width).toBe(32);expect(r.height).toBe(32);
    await page.mouse.click(r.x-4,r.y+r.height/2);await expect(page.locator('.lu-more-panel')).toBeVisible();await expect(page).toHaveURL(url);
  });
  test('library row click and Enter use the existing open path '+width,async({page,browser})=>{
    await boot(page,{width});await page.locator('[data-lu-document="row-0"]').click();await expect(page).toHaveURL(/library-open-fixture/);
    const keyboard=await browser.newPage();await boot(keyboard,{width});await keyboard.locator('[data-lu-document="row-0"]').focus();await keyboard.keyboard.press('Enter');await expect(keyboard).toHaveURL(/library-open-fixture/);await keyboard.close();
  });
  test('library menu keeps download, edit and confirmed trash deletion '+width,async({page})=>{
    const state=await boot(page,{width});
    await menu(page);await page.locator('[data-lu-edit]').click();await expect(page.locator('#libraryEditModal')).toBeVisible();
    await expect(page.locator('#libraryEditId')).toHaveValue('row-0');await expect(page.locator('#libraryEditSource')).toHaveValue('목록에 표시하지 않을 출처');
    expect(await page.evaluate(()=>history.state?.kptuLibraryMenu||null)).toBe(null);
    await page.locator('#libraryEditTitle').fill('수정한 자료');await page.locator('#libraryEditSave').click();await expect(page.locator('#libraryEditModal')).toBeHidden();
    await expect(page.locator('.lu-row-title').first()).toHaveText('수정한 자료');expect(state.patches).toHaveLength(1);
    await menu(page);page.once('dialog',d=>{expect(d.type()).toBe('confirm');expect(d.message()).toContain('Drive 휴지통');d.dismiss()});
    await page.locator('[data-lu-delete]').click();await expect(page.locator('.lu-more-panel')).toBeHidden();expect(state.deletes).toHaveLength(0);
    await menu(page);const dialogs=[];const acceptDelete=async d=>{dialogs.push(d.type());if(d.type()==='confirm')expect(d.message()).toContain('자료 등록을 삭제할까요?');else expect(d.message()).toBe('자료 등록을 삭제했습니다. Drive 파일 처리 결과는 확인하지 못했습니다. 원본 상태를 직접 확인해 주세요.');await d.accept()};page.on('dialog',acceptDelete);await page.locator('[data-lu-delete]').click();await expect(page.locator('[data-lu-document="row-0"]')).toHaveCount(0);
    expect(state.deletes).toEqual([{action:'delete',document_id:'row-0'}]);expect(dialogs).toEqual(['confirm','alert']);page.off('dialog',acceptDelete);
    await menu(page,'row-1');await page.locator('[data-lu-download]').click();await expect(page).toHaveURL(/library-open-fixture.*download=1/);
    expect(state.downloads).toEqual([{document_id:'row-1'}]);
  });
}
// UI-디자인기준 3/3(8-9e-1, 원장 CC18): the file kind keeps its own color (HWP 파랑) in every account theme.
test('library file type keeps its kind color in all four themes and search/filter remain intact',async({page})=>{
  await boot(page);
  for(const theme of ['olive','navy','terracotta','sand']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.locator('.lu-file-kind').first()).toHaveAttribute('data-lu-kind','hwp');
    expect(await page.locator('.lu-file-kind').first().evaluate(el=>{const s=getComputedStyle(el);const probe=document.createElement('span');probe.style.color='var(--ds-file-hwp-ink)';probe.style.backgroundColor='var(--ds-file-hwp-soft)';el.append(probe);const p=getComputedStyle(probe),match=s.color===p.color&&s.backgroundColor===p.backgroundColor;probe.remove();return match})).toBe(true);
  }
  await page.locator('#documentSearch').fill('목록에 표시하지 않을 출처');await expect(page.locator('.lu-row')).toHaveCount(10);
  await page.locator('#documentSearch').fill('없는 검색어');await expect(page.locator('.lu-row')).toHaveCount(0);
  await page.locator('#documentSearch').fill('');await selectFilter(page,'#documentProject','top-b');await expect(page.locator('.lu-row')).toHaveCount(0);
  await selectFilter(page,'#documentProject','top-a');await expect(page.locator('.lu-row')).toHaveCount(10);
});

test('library menu waits for close traversal before rapid reopening',async({page})=>{
  await boot(page);await menu(page);
  await page.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('[data-lu-menu="row-1"]').click()});
  await expect(page.locator('.lu-more-panel')).toBeVisible();
  await expect(page.locator('[data-lu-edit="row-1"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuLibraryMenu)).toBe('row-1');
  await page.goBack();await expect(page.locator('.lu-more-panel')).toBeHidden();
});
test('library menu stays within a short viewport after scrolling and resizing',async({page})=>{
  await boot(page);await page.setViewportSize({width:390,height:420});
  await page.locator('[data-lu-menu="row-9"]').scrollIntoViewIfNeeded();await menu(page,'row-9');
  const fits=()=>page.locator('.lu-more-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight});
  await expect.poll(fits).toBe(true);await page.setViewportSize({width:320,height:360});await expect.poll(fits).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator('.lu-more-panel')).toBeHidden();
});

for(const width of [390,1280]){
  test.describe(`meeting-linked views at ${width}px`,()=>{
    test.use({hasTouch:width===390});
    test(`library lists meeting documents with the rest and the [회의] category chip narrows to them at ${width}px`,async({page})=>{
      await page.setViewportSize({width,height:900});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
      const state=baseState();state.downloads=[];state.deletes=[];
      const doc=(id,title,project_id,extra={})=>({id,title,project_id,workspace_id:'workspace-1',file_name:id+'.pdf',category:'정책자료',tags:[],created_at:now(),...extra});
      state.docs=[
        doc('ordinary-a','철도 일반 자료','top-a',{meeting_id:null}),
        doc('category-only','철도 상집 자료','top-a',{category:'회의자료'}),
        doc('ordinary-b','일반 별도 자료','top-b',{meeting_id:null}),
        doc('meeting-a','철도 회의 연결 자료','top-a',{meeting_id:'meeting-1',category:'기타'}),
        doc('meeting-b','철도 다른 회의 자료','top-b',{meeting_id:'meeting-2',category:'회의자료'})
      ];
      const documentQueries=[];
      page.on('request',req=>{const url=new URL(req.url());if(url.pathname==='/rest/v1/app_documents')documentQueries.push(url.searchParams)});
      await mockApp(page,state);await signIn(page,'http://127.0.0.1:8123/app/?view=library');
      await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
      const rows=page.locator('#documentList [data-lu-document]'),ids=()=>rows.evaluateAll(els=>els.map(el=>el.dataset.luDocument));
      const category=page.getByRole('radiogroup',{name:'자료 분류',exact:true});
      // UI-바구니거르기: no [일반 자료|회의자료만] row; meeting-linked documents list with the rest.
      await expect(page.locator('#libraryViewFilter')).toHaveCount(0);await expect(page.getByRole('radiogroup',{name:'자료 종류',exact:true})).toHaveCount(0);
      await expect(rows).toHaveCount(5);
      expect(await ids()).toEqual(['ordinary-a','category-only','ordinary-b','meeting-a','meeting-b']);
      await expect(page.locator('#libraryMeetingToggle')).toHaveCount(0);
      // The project chip row and the category chip row stay; meeting documents are the [회의] category (회의자료·회의결과).
      await expect(page.locator('#documentProject')).toBeVisible();await expect(category).toHaveAttribute('aria-controls','documentList');
      const meetingChip=category.getByRole('radio',{name:'회의',exact:true});
      if(width===390)await meetingChip.tap();else await meetingChip.click();
      await expect(category).toHaveJSProperty('value','회의');expect(await ids()).toEqual(['category-only','meeting-b']);
      await page.screenshot({path:`/tmp/library-two-meetings-${width}.png`,fullPage:true});
      await category.locator('[aria-checked=true]').focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');
      await expect(category).toHaveJSProperty('value','all');await expect(rows).toHaveCount(5);await expect(category.locator('[aria-checked=true]')).toBeFocused();
      await selectFilter(page,'#documentProject','top-a');
      await page.locator('#documentSearch').fill('철도');
      await expect(rows).toHaveCount(3);
      await selectFilter(page,'#libraryCategoryFilter','회의');await expect(rows).toHaveCount(1);await expect(page.locator('[data-lu-document="category-only"]')).toBeVisible();
      await page.locator('#documentSearch').fill('회의 연결');await expect(rows).toHaveCount(0);
      await selectFilter(page,'#libraryCategoryFilter','all');await expect(rows).toHaveCount(1);await expect(page.locator('[data-lu-document="meeting-a"]')).toBeVisible();
      await page.locator('#documentSearch').fill('');await selectFilter(page,'#documentProject','all');
      await expect(rows).toHaveCount(5);
      await page.locator('#manageLibraryBtn').click();
      await expect(page.locator('#libraryManageList [data-library-edit]')).toHaveCount(5);
      await page.locator('#libraryManageClose').click();
      const storageKeys=()=>page.evaluate(()=>({local:Object.keys(localStorage).sort(),session:Object.keys(sessionStorage).sort()}));
      const before=await storageKeys();
      await selectFilter(page,'#libraryCategoryFilter','회의');await selectFilter(page,'#libraryCategoryFilter','all');
      expect(await storageKeys()).toEqual(before);
      await selectFilter(page,'#libraryCategoryFilter','회의');
      await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
      await page.evaluate(()=>window.KPTURouter.go('library'));
      await expect(rows).toHaveCount(5);await expect(category).toHaveJSProperty('value','all');
      // An old address or remembered view (?view=library) lands on the default list.
      await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
      await expect(rows).toHaveCount(5);await expect(category).toHaveJSProperty('value','all');await expect(page.locator('#libraryViewFilter')).toHaveCount(0);
      expect(documentQueries.length).toBeGreaterThan(0);
      for(const params of documentQueries)expect(params.has('meeting_id')).toBe(false);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`/tmp/library-meeting-views-${width}.png`,fullPage:true});
      expect(errors).toEqual([]);
    });

    test(`edit connects and unlinks a document and refreshes an open meeting at ${width}px`,async({page})=>{
      await page.setViewportSize({width,height:900});
      const errors=[],requests=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
      page.on('request',req=>requests.push({url:req.url(),method:req.method()}));
      const state=baseState();state.downloads=[];state.deletes=[];
      state.meetings=[
        {id:'older',workspace_id:'workspace-1',series_name:'정책 회의',title:'이전 제목',round_no:1,meeting_at:'2026-10-01T03:00:00Z',created_by:state.user.id},
        {id:'recent',workspace_id:'workspace-1',series_name:'정책 회의',title:'정책 회의',round_no:2,meeting_at:'2026-10-09T03:00:00Z',project_id:'top-b',created_by:state.user.id}
      ];
      state.docs=state.docs.filter(d=>d.id==='doc-archived');
      const original={...state.docs[0],meeting_id:null,auto_classified:true,classification_note:'자동분류 결과',file_id:'drive-original',file_name:'report.pdf',drive_url:'https://drive.google.com/file/d/drive-original/view'};
      state.docs=[{...original}];
      await mockApp(page,state);await signIn(page,'http://127.0.0.1:8123/app/?view=library');
      await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
      const edit=async()=>{await page.locator('[data-lu-menu="doc-archived"]').click();await page.locator('[data-lu-edit="doc-archived"]').click();await expect(page.locator('#libraryEditModal')).toBeVisible();await expect(page.locator('#libraryEditMeeting option')).toHaveCount(3)};
      await edit();
      const meeting=page.getByRole('combobox',{name:'회의',exact:true});
      await expect(meeting).toHaveValue('');
      expect(await meeting.locator('option').evaluateAll(opts=>opts.map(o=>o.value))).toEqual(['','recent','older']);
      const labels=await meeting.locator('option').allTextContents();
      expect(labels[0]).toBe('연결 안 함');
      const expected=await page.evaluate(m=>['정책 회의','2차',new Date(m.meeting_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})].join(' · '),state.meetings[1]);
      expect(labels[1]).toBe(expected);
      await page.screenshot({path:`/tmp/library-meeting-edit-modal-${width}.png`,fullPage:true});
      await meeting.selectOption('recent');
      await page.locator('#libraryEditSave').click();await expect(page.locator('#libraryEditModal')).toBeHidden();
      expect(state.patches.at(-1)).toMatchObject({id:'doc-archived',body:{meeting_id:'recent'}});
      expect(Object.keys(state.patches.at(-1).body).sort()).toEqual(['meeting_id','updated_at']);
      for(const key of ['project_id','title','category','source','file_id','file_name','drive_url','auto_classified','classification_note'])expect(state.docs[0][key]).toEqual(original[key]);
      // UI-바구니거르기: linking a meeting no longer moves the row to another view; it stays in the one list.
      await expect(page.locator('[data-lu-document="doc-archived"]')).toBeVisible();
      // Existing meeting query/data and display stay shared with the meeting screen.
      await page.evaluate(()=>window.KPTURouter.go('meetings'));await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
      await page.locator('[data-mrd-meeting="recent"]').click();
      await expect(page.locator('#mrdMaterials')).toContainText('report.pdf');
      await page.locator('#mrdClose').click();await page.evaluate(()=>window.KPTURouter.go('library'));
      await edit();
      await expect(meeting).toHaveValue('recent');
      await meeting.selectOption('');await page.locator('#libraryEditSave').click();await expect(page.locator('#libraryEditModal')).toBeHidden();
      expect(state.patches.at(-1).body.meeting_id).toBeNull();
      await expect(page.locator('[data-lu-document="doc-archived"]')).toBeVisible();
      await page.evaluate(()=>window.KPTURouter.go('meetings'));await page.locator('[data-mrd-meeting="recent"]').click();
      await expect(page.locator('#mrdMaterials')).toContainText('회의자료가 없습니다.');
      // Refresh the open material list through the same signal that the edit save emitted.
      // It must leave an in-progress meeting editor intact.
      await page.locator('#mrdEdit').click();await page.locator('#mrdEditTranscript').fill('작성 중 원문');
      state.docs[0].meeting_id='recent';
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));
      await expect(page.locator('#mrdMaterials')).toContainText('report.pdf');
      await expect(page.locator('#mrdEditTranscript')).toHaveValue('작성 중 원문');
      let releaseFirst,materialReads=0;
      await page.route(`${SB}/rest/v1/app_documents?**`,async route=>{
        if(!new URL(route.request().url()).searchParams.has('meeting_id'))return route.fallback();
        materialReads++;
        const snapshot=structuredClone(state.docs.filter(d=>d.meeting_id==='recent'));
        if(materialReads===1)await new Promise(resolve=>{releaseFirst=resolve});
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)});
      });
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));
      await expect.poll(()=>typeof releaseFirst).toBe('function');
      state.docs[0].meeting_id=null;
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));
      releaseFirst();
      await expect(page.locator('#mrdMaterials')).toContainText('회의자료가 없습니다.');
      expect(materialReads).toBe(2);
      await expect(page.locator('#mrdEditTranscript')).toHaveValue('작성 중 원문');
      await page.locator('#mrdClose').click();await page.evaluate(()=>window.KPTURouter.go('library'));
      await expect(page.locator('#libraryViewFilter')).toHaveCount(0);await expect(page.locator('[data-lu-document="doc-archived"]')).toBeVisible();
      expect(state.docs[0].project_id).toBe('top-c');
      expect(requests.filter(r=>r.method!=='GET'&&/functions\/v1\/(library-files|meeting-files|document-actions|drive-summary)/.test(r.url))).toEqual([]);
      expect(requests.filter(r=>r.method==='GET'&&r.url.includes('/rest/v1/app_meetings?')&&!r.url.includes('id=eq.recent'))).toHaveLength(1);
      await page.screenshot({path:`/tmp/library-meeting-edit-${width}.png`,fullPage:true});
      expect(errors).toEqual([]);
    });
  });
}
