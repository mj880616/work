import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';

// UX-먼저묻고뒤에처리 3차 (2)(S57-1): 자료 등록 창은 [저장]하면 바로 닫히고 올리기는 뒤 줄에서 한다.
// - 프로젝트 상세 자료 [+]: 올리는 중에 또 눌러도 거절('잠시 후 다시 눌러 주세요') 없이 창이 열리고, 두 번째 저장은 앞 올리기 뒤에 줄 선다.
// - 다른 화면에 있으면 진행은 하단바 위 한 줄(#uploadDock), 끝·실패는 공용 작은 알림(#kptuNotice). 실패는 [다시] = 못 올린 파일만 다시.
// - 화면을 옮겨도 끝까지 간다(처리를 시작한 사업영역 id로).
// 실제 앱을 띄우고 Supabase REST·Edge 경계만 합성이다. 합성 자료만 쓴다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',owner='home-test',workspace='w',stamp='2026-09-01T01:00:00Z';
const P='main';
const project=(id,name)=>({id,name,workspace_id:workspace,owner_id:owner,created_by:owner,parent_id:null,status:'active',visibility:'private',sort_order:10,created_at:stamp,updated_at:stamp,description:'',metadata:{project_system:'v2',objective:'',color:'green'}});
const pdf=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 '+name)});
const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>key.includes('.')||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):value==='is.null'?row[key]==null:true)));

// plan(n, name): n번째 올리기 요청에 줄 답. {hold:true} = release()까지 붙잡음, {status:503} = 실패 응답. 없으면 성공.
async function fixture(page,width,plan=()=>null){
  await page.setViewportSize({width,height:900});
  await openHome(page);
  const tables={
    app_spaces:[project(P,'합성 사업영역')],
    app_project_modules:[],app_project_workstreams:[],app_project_progress_updates:[],app_project_comments:[],app_project_milestones:[],
    app_documents:[],app_record_links:[],app_suborganizations:[],app_suborganization_assignees:[],app_profiles:[{user_id:owner,display_name:'합성 사용자'}],
  };
  const state={tables,uploads:[],release:()=>{}};
  await page.route(SB+'/functions/v1/google-tasks**',route=>new URL(route.request().url()).searchParams.get('action')==='linked'?route.fulfill({status:200,json:{tasks:[],removed:0}}):route.fallback());
  await page.route(SB+'/rest/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
    if(!Object.hasOwn(tables,table))return route.fallback();
    if(table==='app_record_links'&&url.searchParams.get('select')?.includes('note:app_notes'))return route.fulfill({status:200,json:[]});
    let result=matching(tables[table],url.searchParams);
    if(table==='app_spaces'&&url.searchParams.get('select')?.includes('milestones:'))result=result.map(row=>({id:row.id,milestones:[]}));
    if(method==='PATCH')result.forEach(row=>Object.assign(row,req.postDataJSON()));
    return route.fulfill({status:200,json:result});
  });
  await page.route(SB+'/functions/v1/library-files',async route=>{
    const raw=route.request().postDataBuffer().toString('utf8'),name=raw.match(/filename="([^"]+)"/)?.[1]||'',n=state.uploads.length+1;
    const answer=plan(n,name)||{};
    state.uploads.push({name,project:raw.match(/name="project_id"\r\n\r\n([^\r]*)/)?.[1]||''});
    if(answer.hold)await new Promise(resolve=>{state.release=resolve});
    if(answer.status)return route.fulfill({status:answer.status,json:{message:'synthetic failure'}});
    const doc={id:'new-doc-'+n,workspace_id:workspace,project_id:P,title:name,file_name:name,mime_type:'application/pdf',category:'기타',created_at:stamp};
    tables.app_documents.push(doc);
    return route.fulfill({json:{document:{id:doc.id,title:name,project_id:P}}});
  });
  return state;
}
async function openProject(page){
  await clickView(page,'projects');
  await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
  await expect(page.locator('#projectGrid[data-ps3-ready="1"]')).toBeVisible();
  await page.locator(`[data-ps3-project="${P}"]`).first().click();
  await expectProjectTitle(page,'합성 사업영역');
}
const addDoc=page=>page.locator('#ps3-documents .ps3-section-head').getByRole('button',{name:'자료 올리기'});
const noticeLine=page=>page.locator('#kptuNotice:not([hidden]) .kptu-notice-text');
const retryButton=page=>page.locator('#kptuNotice:not([hidden]) .kptu-notice-action',{hasText:'다시'});
const dock=page=>page.locator('#uploadDock:not([hidden])');

for(const width of [412,1280]){
  test(`프로젝트 상세 자료 [+]: 저장하면 창이 바로 닫히고, 올리는 중에 또 눌러도 열려 줄 서서 이어 올린다 ${width}`,async({page})=>{
    const state=await fixture(page,width,n=>n===1?{hold:true}:null);
    await openProject(page);
    await addDoc(page).click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(page.locator('#docProject')).toHaveValue(P);
    await page.locator('#libraryFileInput').setInputFiles(pdf('첫째.pdf'));
    await page.locator('#saveDocumentBtn').click();
    // 창은 올리기가 끝나기를 기다리지 않고 닫힌다. 진행은 하단바 위 한 줄.
    await expect(page.locator('#documentModal')).toBeHidden();
    await expect.poll(()=>state.uploads.length).toBe(1);
    await expect(dock(page)).toContainText('파일 1개 올리는 중');
    // 올리는 중에 또 [+]: 거절 없이 같은 창이 이 사업영역으로 열린다.
    await addDoc(page).click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(page.locator('#docProject')).toHaveValue(P);
    await expect(page.locator('[data-lu-upload-file]')).toHaveCount(0);
    await expect(page.locator('#libraryFileInput')).toBeEnabled();
    await page.locator('#libraryFileInput').setInputFiles(pdf('둘째.pdf'));
    await page.locator('#saveDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeHidden();
    await page.waitForTimeout(300);
    expect(state.uploads.map(u=>u.name)).toEqual(['첫째.pdf']); // 둘째는 앞 올리기 뒤에 줄 서 있다(동시에 보내지 않음)
    state.release();
    await expect.poll(()=>state.uploads.map(u=>u.name)).toEqual(['첫째.pdf','둘째.pdf']);
    expect(state.uploads.map(u=>u.project)).toEqual([P,P]);
    await expect(noticeLine(page)).toHaveText('둘째.pdf 올렸어요');
    expect(state.tables.app_documents.map(d=>d.project_id)).toEqual([P,P]);
    await expect(dock(page).locator('.up-dock-text')).not.toContainText('올리는 중');
  });
}

test('자료실: 못 올린 파일은 알림 + [다시]로 그 파일만 다시 올린다(펼친 폴드 884)',async({page})=>{
  const state=await fixture(page,884,(n,name)=>name==='나.pdf'&&n===2?{status:503}:null);
  await clickView(page,'library');
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  await page.locator('#newDocumentBtn').click();
  await page.locator('#libraryFileInput').setInputFiles([pdf('가.pdf'),pdf('나.pdf'),pdf('다.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
  await expect(noticeLine(page)).toHaveText('2개 완료 · 1개 미완료. 파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.');
  await expect(page.locator('#kptuNotice:not([hidden])')).toHaveAttribute('role','alert');
  expect(state.uploads.map(u=>u.name)).toEqual(['가.pdf','나.pdf','다.pdf']);
  // 올리는 동안 잠기지 않았고, 실패 뒤에도 [+ 자료 등록]은 바로 쓸 수 있다.
  await expect(page.locator('#newDocumentBtn')).toBeEnabled();
  await retryButton(page).click();
  await expect(noticeLine(page)).toHaveText('나.pdf 올렸어요');
  expect(state.uploads.map(u=>u.name)).toEqual(['가.pdf','나.pdf','다.pdf','나.pdf']);
  await expect(page.locator('[data-lu-document]')).toHaveCount(3);
});

test('프로젝트 상세에서 저장한 뒤 다른 화면으로 옮겨도 끝까지 올리고, 실패하면 그 화면에서 알림 + [다시](412)',async({page})=>{
  const state=await fixture(page,412,n=>n===1?{hold:true,status:503}:null);
  await openProject(page);
  await addDoc(page).click();
  await page.locator('#libraryFileInput').setInputFiles(pdf('옮김.pdf'));
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
  await expect.poll(()=>state.uploads.length).toBe(1);
  // 올리는 중에 홈으로 옮긴다: 하단바 위 한 줄이 따라오고, 올리기는 멈추지 않는다.
  await page.evaluate(()=>window.KPTURouter.go('home',{source:'qa'}));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(dock(page)).toContainText('파일 1개 올리는 중');
  state.release();
  await expect(noticeLine(page)).toHaveText('파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.');
  // [다시]: 처음 저장할 때 정한 사업영역으로 그 파일을 다시 올린다(지금 화면이 홈이어도).
  await retryButton(page).click();
  await expect(noticeLine(page)).toHaveText('옮김.pdf 올렸어요');
  expect(state.uploads).toEqual([{name:'옮김.pdf',project:P},{name:'옮김.pdf',project:P}]);
  expect(state.tables.app_documents.map(d=>d.project_id)).toEqual([P]);
});
