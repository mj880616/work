import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

// ORG-자료더하기먹통: 조직 상세 창의 자료 [+]·끌어 놓기가 자료 등록 창을 조직 상세 창 위에 열고, 조직이 채워진 채 [등록]까지 된다.
// 원인: 자료 등록 창(#documentModal)을 상세 창(#wdModal, body 끝에 붙음)보다 위에 올리는 규칙(z-index 51)이 프로젝트·회의 화면 CSS에만 있어,
// 조직 보고 화면에서는 두 창이 같은 층(50)이 되어 나중에 붙은 상세 창이 등록 창을 덮었다(눌러도 아무 일 없는 것처럼 보임).
// Supabase REST·Edge 경계만 합성이고 화면은 실제 앱이다. 합성 자료만 쓴다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const O='30000000-0000-4000-8000-000000000001';
const WIDTHS=[412,690,884,1440];

async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 await openHome(page);
 const tables={
  app_suborganizations:[{id:O,workspace_id:'w',name:'합성 한빛지부',active:true,created_by:'home-test'}],
  app_suborganization_assignees:[{organization_id:O,user_id:'home-test'}],
  app_documents:[],app_record_links:[],app_spaces:[],app_notes:[],app_suborganization_updates:[],
 };
 const state={tables,uploads:0,patches:[]};
 const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>['select','order','limit','offset'].includes(key)||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value==='is.null'?row[key]==null:value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key]??'')):true)));
 await page.route(SB+'/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
  if(!Object.hasOwn(tables,table))return route.fallback();
  const rows=matching(tables[table],url.searchParams);
  if(method==='PATCH'){const body=req.postDataJSON();state.patches.push({table,body});rows.forEach(r=>Object.assign(r,body))}
  return route.fulfill({json:rows});
 });
 await page.route(SB+'/functions/v1/library-files',route=>{if(/^\{"action":"drive-auto"\}$/.test(route.request().postData()||''))return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:{ok:true,added:0}}); // S70-73: 자료실을 열 때 자동 등록 부탁 — 올리기가 아님
  state.uploads++;
  tables.app_documents.push({id:'new-doc',workspace_id:'w',title:'합성',file_name:'a.pdf',mime_type:'application/pdf',category:'기타',organization_id:null,created_at:stamp});
  return route.fulfill({json:{document:{id:'new-doc',title:'합성',project_id:null}}});
 });
 return state;
}
async function openOrg(page){
 await page.evaluate(async id=>{await window.KPTUViewLoader.load('team');await window.KPTUWorkplace.open(id);},O);
 await expect(page.locator('#wdModal')).toBeVisible();
}
// S67-39: 자료 [+] = 작은 메뉴 [기기에서 올리기]·[자료실에서 선택]. 올리기 시험은 [기기에서 올리기]를 고른다.
async function device(page,tap){const b=page.locator('#reportAddMenu [data-report-add="device"]');await expect(b).toBeVisible();await (tap?b.tap():b.click())}
// 등록 창의 한가운데 윗부분을 실제로 누를 수 있는가(= 다른 창에 덮이지 않았는가).
const documentModalOnTop=page=>page.evaluate(()=>{const m=document.querySelector('#documentModal'),c=m.querySelector('.modal-card').getBoundingClientRect(),el=document.elementFromPoint(c.x+c.width/2,c.y+24);return !!el&&m.contains(el)});
async function registerAndCheck(page,state){
 await page.locator('#libraryFileInput').setInputFiles({name:'합성.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 합성')});
 await expect(page.locator('#librarySelectedFiles')).toContainText('합성.pdf');
 await page.locator('#saveDocumentBtn').click();
 await expect.poll(()=>state.uploads).toBe(1);
 await expect.poll(()=>state.patches.find(p=>p.table==='app_documents'&&p.body.organization_id===O)?1:0).toBe(1);
 await expect(page.locator('#documentModal')).toBeHidden();
}
for(const width of WIDTHS){
 test(`조직 상세 자료 [+]: 창이 상세 위에 뜨고 조직이 채워져 등록된다 ${width}`,async({page})=>{
  const state=await fixture(page,width);
  await openOrg(page);
  const add=page.locator('#wdDocAdd');await expect(add).toBeVisible();
  await (width<761?add.tap():add.click());await device(page,width<761);
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(await documentModalOnTop(page)).toBe(true);
  await expect(page.locator('#libraryUploadOrg')).toContainText('합성 한빛지부');
  await registerAndCheck(page,state);
 });
}
test('조직 상세 끌어 놓기: 같은 창이 상세 위에 뜨고 파일이 미리 골라진다',async({page})=>{
 const state=await fixture(page,1440);
 await openOrg(page);
 await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4'],'끌어놓기.pdf',{type:'application/pdf'}));document.querySelector('#wdDocs').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))});
 await expect(page.locator('#documentModal')).toBeVisible();
 expect(await documentModalOnTop(page)).toBe(true);
 await expect(page.locator('#libraryUploadOrg')).toContainText('합성 한빛지부');
 await expect(page.locator('#librarySelectedFiles')).toContainText('끌어놓기.pdf');
 await page.locator('#saveDocumentBtn').click();
 await expect.poll(()=>state.uploads).toBe(1);
 await expect.poll(()=>state.patches.some(p=>p.body.organization_id===O)).toBe(true);
});
// UX-먼저묻고뒤에처리 3차(S56-56): [저장]하면 창이 바로 닫히고 올리기는 뒤에서. 올리는 중에 [+]를 또 눌러도 거절('잠시 후 다시 눌러 주세요') 없이 창이 열리고,
// 두 번째 저장은 앞 올리기 뒤에 줄 서서 이어 올린다. 다른 화면으로 옮겨도 끝까지 가고 끝을 작은 알림으로 알린다.
test('조직 상세 자료 [+]: 저장하면 창이 바로 닫히고, 올리는 중에 또 눌러도 열려 줄 서서 이어 올린다 (412)',async({page})=>{
 const state=await fixture(page,412);
 let release;const hold=new Promise(r=>{release=r});const names=[];
 await page.unroute(SB+'/functions/v1/library-files');
 await page.route(SB+'/functions/v1/library-files',async route=>{if(/^\{"action":"drive-auto"\}$/.test(route.request().postData()||''))return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:{ok:true,added:0}}); // S70-73: 자료실을 열 때 자동 등록 부탁 — 올리기가 아님
  const n=++state.uploads;names.push(n);if(n===1)await hold;
  const id='new-doc-'+n;state.tables.app_documents.push({id,workspace_id:'w',title:'합성'+n,file_name:'a'+n+'.pdf',mime_type:'application/pdf',category:'기타',organization_id:null,created_at:stamp});
  return route.fulfill({json:{document:{id,title:'합성'+n,project_id:null}}});
 });
 await openOrg(page);
 const add=page.locator('#wdDocAdd');
 await add.tap();await device(page,true);
 // 창이 다 열린 뒤(조직이 채워진 뒤)에 파일을 고른다 — 창은 열릴 때 고른 파일을 비우므로, 열리기 전에 넣은 파일은 사라진다(사람은 창이 뜬 뒤에만 고를 수 있다).
 await expect(page.locator('#documentModal')).toBeVisible();
 await expect(page.locator('#libraryUploadOrg')).toContainText('합성 한빛지부');
 await page.locator('#libraryFileInput').setInputFiles({name:'첫째.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 a')});
 await expect(page.locator('#librarySelectedFiles')).toContainText('첫째.pdf');
 await page.locator('#saveDocumentBtn').click();
 await expect(page.locator('#documentModal')).toBeHidden();
 await expect.poll(()=>state.uploads).toBe(1);
 await add.tap();await device(page,true);
 await expect(page.locator('#documentModal')).toBeVisible();
 await expect(page.locator('#libraryUploadOrg')).toContainText('합성 한빛지부');
 await page.locator('#libraryFileInput').setInputFiles({name:'둘째.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 b')});
 await expect(page.locator('#librarySelectedFiles')).toContainText('둘째.pdf');
 await page.locator('#saveDocumentBtn').click();
 await expect(page.locator('#documentModal')).toBeHidden();
 await page.waitForTimeout(300);
 expect(state.uploads).toBe(1); // 둘째는 앞 올리기 뒤에 줄 서 있다(동시에 보내지 않음)
 await page.locator('#wdModal [data-wd-close], #wdModal .icon-btn').first().click().catch(()=>{});
 await page.evaluate(()=>window.KPTURouter.go('library',{source:'qa'}));
 release();
 await expect.poll(()=>state.uploads).toBe(2);
 await expect.poll(()=>state.patches.filter(p=>p.table==='app_documents'&&p.body.organization_id===O).length).toBe(2);
 await expect(page.locator('#uploadDock:not([hidden])')).toContainText('올렸');
});

// S67-39(명진 11/20 "자료 + 자료실에서 추가도 가능하게", 같은 종류 맞춤): 조직 상세 자료 [+] [자료실에서 선택] — 이미 있는 자료의 담당조직 칸만 채운다(올리기 없음).
// 다른 조직에 붙은 자료는 흐리게 '다른 조직에 있음'.
for(const width of [412,1440])test(`조직 상세 자료 [+] [자료실에서 선택]: 다시 올리지 않고 이 조직에 붙인다 ${width}`,async({page})=>{
 const state=await fixture(page,width);
 state.tables.app_documents.push(
  {id:'30000000-0000-4000-8000-0000000000a1',workspace_id:'w',title:'합성 안건',file_name:'안건.pdf',mime_type:'application/pdf',category:'기타',organization_id:null,meeting_id:null,created_at:stamp},
  {id:'30000000-0000-4000-8000-0000000000a2',workspace_id:'w',title:'합성 다른 조직 자료',file_name:'다른.pdf',mime_type:'application/pdf',category:'기타',organization_id:'30000000-0000-4000-8000-000000000009',meeting_id:null,created_at:stamp});
 await openOrg(page);
 const add=page.locator('#wdDocAdd');await (width<761?add.tap():add.click());
 const menu=page.locator('#reportAddMenu');await expect(menu.getByRole('button')).toHaveText(['기기에서 업로드','자료실에서 선택']);
 await menu.locator('[data-report-add="library"]').click();
 const picker=page.locator('#reportLibPicker');await expect(picker).toBeVisible();
 await expect(picker.locator('.lu-move-item',{hasText:'다른 조직 자료'})).toHaveAttribute('aria-disabled','true');
 await expect(picker.locator('.lu-move-item',{hasText:'다른 조직 자료'})).toContainText('다른 조직에 있음');
 await picker.locator('.lu-move-item',{hasText:'합성 안건'}).click();
 await picker.locator('[data-lu-move-done]').click();
 await expect.poll(()=>state.patches.filter(p=>p.table==='app_documents'&&p.body.organization_id===O).length).toBe(1);
 expect(state.tables.app_documents.find(d=>d.title==='합성 안건').organization_id).toBe(O);
 expect(state.tables.app_documents.find(d=>d.title==='합성 다른 조직 자료').organization_id).toBe('30000000-0000-4000-8000-000000000009');
 expect(state.uploads).toBe(0);
 await expect(page.locator('#wdDocBody')).toContainText('안건');
});
