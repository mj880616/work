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
 const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>['select','order','limit','offset'].includes(key)||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):true)));
 await page.route(SB+'/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
  if(!Object.hasOwn(tables,table))return route.fallback();
  const rows=matching(tables[table],url.searchParams);
  if(method==='PATCH'){const body=req.postDataJSON();state.patches.push({table,body});rows.forEach(r=>Object.assign(r,body))}
  return route.fulfill({json:rows});
 });
 await page.route(SB+'/functions/v1/library-files',route=>{
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
  await (width<761?add.tap():add.click());
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
 await page.route(SB+'/functions/v1/library-files',async route=>{
  const n=++state.uploads;names.push(n);if(n===1)await hold;
  const id='new-doc-'+n;state.tables.app_documents.push({id,workspace_id:'w',title:'합성'+n,file_name:'a'+n+'.pdf',mime_type:'application/pdf',category:'기타',organization_id:null,created_at:stamp});
  return route.fulfill({json:{document:{id,title:'합성'+n,project_id:null}}});
 });
 await openOrg(page);
 const add=page.locator('#wdDocAdd');
 await add.tap();
 await page.locator('#libraryFileInput').setInputFiles({name:'첫째.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 a')});
 await page.locator('#saveDocumentBtn').click();
 await expect(page.locator('#documentModal')).toBeHidden();
 await expect.poll(()=>state.uploads).toBe(1);
 await add.tap();
 await expect(page.locator('#documentModal')).toBeVisible();
 await expect(page.locator('#libraryUploadOrg')).toContainText('합성 한빛지부');
 await page.locator('#libraryFileInput').setInputFiles({name:'둘째.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 b')});
 await page.locator('#saveDocumentBtn').click();
 await expect(page.locator('#documentModal')).toBeHidden();
 await page.waitForTimeout(300);
 expect(state.uploads).toBe(1); // 둘째는 앞 올리기 뒤에 줄 서 있다(동시에 보내지 않음)
 await page.locator('#wdModal [data-wd-close], #wdModal .icon-btn').first().click().catch(()=>{});
 await page.evaluate(()=>window.KPTURouter.go('library',{source:'qa'}));
 release();
 await expect.poll(()=>state.uploads).toBe(2);
 await expect.poll(()=>state.patches.filter(p=>p.table==='app_documents'&&p.body.organization_id===O).length).toBe(2);
 await expect(page.locator('#kptuNotice')).toContainText('올렸');
});
