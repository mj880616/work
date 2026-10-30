import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {showBasketRow} from './helpers/basket-more.mjs';

// LIB-조직프로젝트자료종류: 담당조직·프로젝트 상세 [자료]의 종류 표시와 종류 칩 거르기. 합성 자료만 쓴다.
// Supabase REST·RPC·Edge 경계만 합성이고 화면은 실제 앱이다. 서버 함수(app_document_category_*)의 동작은 migration 문서대로 흉내 낸다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const ONLY='10000000-0000-4000-8000-000000000001',TEXT='10000000-0000-4000-8000-000000000002';
const P='20000000-0000-4000-8000-000000000001',OLD='20000000-0000-4000-8000-000000000002';
const O='30000000-0000-4000-8000-000000000001',O2='30000000-0000-4000-8000-000000000002';
const HWP={drive_file_id:'drive-hwp',file_name:'합성 요구안.hwp',mime_type:'application/x-hwp',size_bytes:2048};
const PDF={drive_file_id:'drive-pdf',file_name:'합성 공문.pdf',mime_type:'application/pdf',size_bytes:4096};
const DEFAULT=['교섭·합의','투쟁','교육','선전','정책','성명·보도자료','공문','회의','기타'];
const reviewDir=process.env.UI_REVIEW_DIR||'';
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const doc=(id,title,category,date,extra={})=>({id,workspace_id:'w',project_id:null,organization_id:null,meeting_id:null,title,file_id:'f-'+id,file_name:title+'.pdf',mime_type:'application/pdf',category,document_date:date,drive_url:'https://example.org/'+id,created_at:'2026-08-01T01:00:00Z',tags:[],...extra});
const seedDocs=()=>[
 doc('od1','합성 교섭 일정','교섭·합의','2026-10-07',{organization_id:O,project_id:P}),
 doc('od2','합성 집회 계획','투쟁','2026-10-06',{organization_id:O,project_id:P}),
 doc('od3','합성 공문 회신','공문','2026-10-05',{organization_id:O,project_id:P}),
 doc('od4','합성 성명서','성명·보도자료','2026-10-04',{organization_id:O,project_id:P}),
 doc('od5','합성 교육 안내','교육','2026-10-03',{organization_id:O,project_id:P}),
 doc('od6','합성 국토부 지침','정부자료','2026-10-02',{organization_id:O,project_id:P}),
 doc('od7','합성 투쟁 일정 2','투쟁','2026-10-01',{organization_id:O,project_id:P}),
 doc('other','다른 조직 자료','선전','2026-09-30',{organization_id:O2}),
];
const rank=(a,b,key)=>{const x=a[key]??null,y=b[key]??null;return x===y?0:x==null?1:y==null?-1:x<y?1:-1;};

async function fixture(page,{width=390,scheme='light',docs=seedDocs(),categories=[...DEFAULT],profileFails=false,libraryView=null}={}){
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
 await openHome(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note=(id,raw,attachments)=>({id,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:raw,ai_export_allowed:true,archived_at:null,attachments,metadata:{}});
 const space=(id,name)=>({id,workspace_id:'w',owner_id:'home-test',created_by:'home-test',name,status:'active',visibility:'private',sort_order:10,parent_id:null,created_at:stamp,updated_at:stamp,metadata:{project_system:'v2'}});
 const org=(id,name)=>({id,workspace_id:'w',name,active:true,created_by:'home-test'});
 const tables={
  app_notes:[note(ONLY,'',[HWP,PDF]),note(TEXT,'10/20 교섭 결과\n2차 교섭 일정 합의',[PDF])],
  app_spaces:[space(P,'합성 임단협'),space(OLD,'합성 지난 교섭')],
  app_suborganizations:[org(O,'합성 한빛지부'),org(O2,'합성 샛별지부')],
  app_suborganization_assignees:[{organization_id:O,user_id:'home-test'}],
  app_documents:docs,
  app_record_links:[],app_project_modules:[],app_project_workstreams:[],app_project_progress_updates:[],app_project_milestones:[],app_project_comments:[],app_suborganization_updates:[],
 };
 const server={categories,rpc:[],next:null,profileReads:0,profileFails};
 const state={tables,requests:[],rpc:[],sends:[],errors,server};
 state.calls=(table,method)=>state.requests.filter(r=>r.table===table&&r.method===method);
 await page.route(SB+'/rest/v1/app_profiles?**',route=>{
  server.profileReads++;
  if(server.profileFails)return route.fulfill({status:500,json:{message:'QA failure'}});
  return route.fulfill({json:[{document_categories:server.categories,...(libraryView?{library_view:libraryView}:{})}]});
 });
 // 서버 함수 흉내: migration 20261018112943의 규칙(앞뒤 공백 제거·중복·고정 '기타'·자료 분류 함께 바꾸기).
 const reply=(route,json)=>route.fulfill({json});
 const rpc=(name,handler)=>page.route(SB+'/rest/v1/rpc/'+name,route=>{
  const body=route.request().postDataJSON();server.rpc.push({name,body});
  if(server.next){const next=server.next;server.next=null;return route.fulfill(next);}
  const list=server.categories,docsOf=names=>tables.app_documents.filter(d=>names.includes(d.category));
  return handler(route,body,list,docsOf);
 });
 await rpc('app_document_category_add',(route,body,list)=>{
  const name=String(body.p_name).trim();
  if(!name)return reply(route,{ok:false,error:'INVALID_NAME'});
  if(list.includes(name))return reply(route,{ok:false,error:'CATEGORY_EXISTS'});
  server.categories=[...list,name];return reply(route,{ok:true,categories:server.categories});
 });
 await rpc('app_document_category_rename',(route,body,list,docsOf)=>{
  if(!list.includes(body.p_from))return reply(route,{ok:false,error:'CATEGORY_NOT_FOUND'});
  if(body.p_from==='기타')return reply(route,{ok:false,error:'CATEGORY_LOCKED'});
  const to=String(body.p_to).trim();
  if(list.includes(to))return reply(route,{ok:false,error:'CATEGORY_EXISTS'});
  if(body.p_stored.some(v=>list.includes(v)))return reply(route,{ok:false,error:'INVALID_INPUT'});
  server.categories=list.map(n=>n===body.p_from?to:n);
  const hit=docsOf([...body.p_stored,body.p_from]);hit.forEach(d=>{d.category=to;});
  return reply(route,{ok:true,categories:server.categories,documents:hit.length});
 });
 await rpc('app_document_category_delete',(route,body,list,docsOf)=>{
  if(!list.includes(body.p_name))return reply(route,{ok:false,error:'CATEGORY_NOT_FOUND'});
  if(body.p_name==='기타')return reply(route,{ok:false,error:'CATEGORY_LOCKED'});
  if(body.p_stored.some(v=>list.includes(v)))return reply(route,{ok:false,error:'INVALID_INPUT'});
  server.categories=list.filter(n=>n!==body.p_name);
  const hit=docsOf([...body.p_stored,body.p_name]);hit.forEach(d=>{d.category='기타';});
  return reply(route,{ok:true,categories:server.categories,documents:hit.length});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{
  const body=route.request().postDataJSON();state.rpc.push(body);
  for(const t of body.p_targets)tables.app_record_links.push({id:'40000000-0000-4000-8000-'+String(tables.app_record_links.length+1).padStart(12,'0'),workspace_id:'w',note_id:body.p_note_id,status:'confirmed',summary:t.summary,[t.kind==='project'?'project_id':'organization_id']:t.target_id});
  return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>['select','order','limit','offset'].includes(key)||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):value==='is.null'?row[key]==null:value==='not.is.null'?row[key]!=null:true)));
 await page.route(SB+'/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
  if(!Object.hasOwn(tables,table))return route.fallback();
  const body=method==='GET'?null:req.postDataJSON();state.requests.push({table,method,query:Object.fromEntries(url.searchParams),body});
  let rows=matching(tables[table],url.searchParams);
  if(method==='PATCH')rows.forEach(row=>Object.assign(row,body));
  if(table==='app_documents'&&method==='GET')rows=[...rows].sort((a,b)=>rank(a,b,'document_date')||rank(a,b,'created_at'));
  if(table==='app_record_links'&&method==='GET'){
   const spaceName=id=>tables.app_spaces.find(s=>s.id===id)?.name;
   rows=rows.filter(r=>!url.searchParams.has('google_task_id')).map(r=>({...r,note:tables.app_notes.find(n=>n.id===r.note_id),project:r.project_id?{name:spaceName(r.project_id)}:null,organization:r.organization_id?{name:tables.app_suborganizations.find(o=>o.id===r.organization_id)?.name}:null}));
  }
  const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||rows.length);
  return route.fulfill({json:method==='GET'?rows.slice(offset,offset+limit):rows});
 });
 // register-basket-attachment: the server makes one library document per Drive file.
 await page.route(SB+'/functions/v1/document-actions',route=>{
  const body=route.request().postDataJSON();state.sends.push(body);
  const found=tables.app_documents.find(d=>d.file_id===body.drive_file_id);
  if(found)return route.fulfill({json:{ok:true,result:'exists',document:{id:found.id,title:found.title}}});
  const file=[HWP,PDF].find(f=>f.drive_file_id===body.drive_file_id);
  const created=doc('doc-'+body.drive_file_id.slice(6),file.file_name.replace(/\.[^.]+$/,''),'기타',null,{file_id:file.drive_file_id,file_name:file.file_name,mime_type:file.mime_type,created_at:'2026-10-06T01:00:00Z'});
  tables.app_documents.push(created);return route.fulfill({json:{ok:true,result:'created',document:{id:created.id,title:created.title}}});
 });
 return state;
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
async function openNote(page,id,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,id);
 await tap(page,page.locator(`[data-basket-row="${id}"]`),width);
 const detail=page.locator('[data-basket-detail]');await expect(detail.locator('[data-basket-attachments]')).not.toBeEmpty();return detail;
}
async function pick(page,detail,kind,name,width){
 await tap(page,detail.locator(`[data-manual-pick="${kind}"]`),width);
 const sheet=page.locator('#basketLinkChoiceSheet');await expect(sheet).toBeVisible();
 await tap(page,sheet.getByRole('button',{name,exact:true}),width);await expect(sheet).toBeHidden();
}
async function capture(page,info,name,locator=null){
 const path=reviewDir?`${reviewDir}/${name}.png`:info.outputPath(name+'.png');
 if(reviewDir)mkdirSync(reviewDir,{recursive:true});
 if(locator){await locator.scrollIntoViewIfNeeded();await locator.screenshot({path});}else await page.screenshot({path,fullPage:true});
}
async function openOrg(page,id=O){
 await page.evaluate(async orgId=>{await window.KPTUViewLoader.load('team');await window.KPTUWorkplace.open(orgId);},id);
 await expect(page.locator('#wdModal')).toBeVisible();
}

const kinds=(root)=>root.locator('.doc-category-tag');
const chip=(host,name)=>host.locator('button',{hasText:new RegExp('^'+name+'$')});

async function openProjectDetail(page){
 await clickView(page,'projects');await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
 await page.locator(`[data-ps3-project="${P}"]`).first().click();
 await expect(page.locator('#ps3-documents')).toBeVisible();
}
const oneLine=async(host)=>{const b=await host.locator('button').evaluateAll(list=>list.map(x=>Math.round(x.getBoundingClientRect().top)));return new Set(b).size===1;};

for(const width of [390,1280])test(`organization documents show each kind and filter by kind chips ${width}`,async({page},info)=>{
 const f=await fixture(page,{width,categories:[...DEFAULT]});
 await openOrg(page);
 const section=page.locator('#wdDocs'),host=section.locator('#wdDocKinds');
 // Every file shows its kind (stored old names map to the list's names); chips are the library's kinds in the library's order.
 await expect(section.locator('.wd-doc-row')).toHaveCount(5);
 await expect(kinds(section)).toHaveText(['교섭·합의','투쟁','공문','성명·보도자료','교육']);
 await expect(host.getByRole('button')).toHaveText(['전체',...DEFAULT]);
 await expect(host).toHaveAttribute('role','group');
 for(const name of DEFAULT)await expect(chip(host,name)).toHaveAttribute('aria-pressed','true');
 // Phone: one line that scrolls sideways. PC(1024px~, UI-점검1030손질 C7): wraps instead (no sideways scroll a mouse cannot reach). Small; touch area 44px.
 if(width<1024)expect(await oneLine(host)).toBe(true);
 else{expect(await host.evaluate(h=>getComputedStyle(h).flexWrap)).toBe('wrap');expect(await host.evaluate(h=>h.scrollWidth<=h.clientWidth)).toBe(true);}
 const box=await chip(host,'투쟁').boundingBox();expect(box.height).toBeLessThanOrEqual(32.5);
 expect(await noWideScroll(page)).toBe(true);
 if(width<761)expect(await host.evaluate(h=>h.scrollWidth>h.clientWidth)).toBe(true);
 // Turning a kind off hides those files and the next ones fill the five lines; the count and 'all N' stay for the whole organization.
 await tap(page,chip(host,'투쟁'),width);
 await expect(chip(host,'투쟁')).toHaveAttribute('aria-pressed','false');
 await expect(chip(host,'전체')).toHaveAttribute('aria-pressed','mixed');
 await expect(section.locator('.wd-doc-main b')).toHaveText(['합성 교섭 일정','합성 공문 회신','합성 성명서','합성 교육 안내','합성 국토부 지침']);
 await expect(section.locator('[data-wd-doc-count]')).toHaveText('7');
 await expect(section.getByRole('button',{name:'전체 7개 보기'})).toBeVisible();
 // [전체] while only some are on turns all on; pressed again (all on) it turns all off (empty line) and then everything on.
 await tap(page,chip(host,'전체'),width);
 await expect(chip(host,'전체')).toHaveAttribute('aria-pressed','true');
 await expect(chip(host,'투쟁')).toHaveAttribute('aria-pressed','true');
 await tap(page,chip(host,'전체'),width);
 await expect(section.locator('[data-wd-doc-nokind]')).toHaveText('고른 종류 없음');
 await expect(chip(host,'전체')).toHaveAttribute('aria-pressed','false');
 await tap(page,chip(host,'전체'),width);
 await expect(chip(host,'전체')).toHaveAttribute('aria-pressed','true');
 await expect(section.locator('.wd-doc-row')).toHaveCount(5);
 // Only 교육 on: the one file of that kind.
 await tap(page,chip(host,'전체'),width);await tap(page,chip(host,'교육'),width);
 await expect(section.locator('.wd-doc-main b')).toHaveText(['합성 교육 안내']);
 expect(f.calls('app_documents','PATCH')).toEqual([]);expect(f.rpc).toEqual([]);
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`project documents show each kind and filter by kind chips ${width}`,async({page})=>{
 const f=await fixture(page,{width,categories:[...DEFAULT]});
 await openProjectDetail(page);
 const section=page.locator('#ps3-documents'),host=section.locator('#ps3DocKinds');
 await expect(section.locator('.ps3-doc-row')).toHaveCount(5);
 await expect(kinds(section)).toHaveText(['교섭·합의','투쟁','공문','성명·보도자료','교육']);
 await expect(host.getByRole('button')).toHaveText(['전체',...DEFAULT]);
 // UI-점검1030손질 C7: phone one sideways line; PC wraps (no hidden sideways part).
 if(width<1024)expect(await oneLine(host)).toBe(true);else expect(await host.evaluate(h=>h.scrollWidth<=h.clientWidth)).toBe(true);
 expect((await chip(host,'공문').boundingBox()).height).toBeLessThanOrEqual(32.5);
 await tap(page,chip(host,'공문'),width);
 await expect(section.locator('.ps3-doc-row b')).toHaveText(['합성 교섭 일정','합성 집회 계획','합성 성명서','합성 교육 안내','합성 국토부 지침']);
 await expect(chip(host,'공문')).toHaveAttribute('aria-pressed','false');
 // [전체] while only some are on turns all on; pressed again (all on) it turns all off.
 await tap(page,chip(host,'전체'),width);await expect(chip(host,'공문')).toHaveAttribute('aria-pressed','true');
 await tap(page,chip(host,'전체'),width);await expect(section.locator('[data-ps3-doc-nokind]')).toHaveText('고른 종류 없음');
 await tap(page,chip(host,'성명·보도자료'),width);
 await expect(section.locator('.ps3-doc-row b')).toHaveText(['합성 성명서']);
 await expect(section.getByRole('button',{name:'전체 7개 보기'})).toBeVisible();
 expect(f.calls('app_documents','PATCH')).toEqual([]);expect(f.rpc).toEqual([]);
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('kind chips follow the changed kind list and unknown or empty kinds count as 기타',async({page})=>{
 const docs=seedDocs();docs.push(doc('od8','합성 종류 없음',null,'2026-09-29',{organization_id:O,project_id:P}));
 const f=await fixture(page,{width:1280,docs,categories:['교섭·합의','투쟁','홍보','기타']});
 await openOrg(page);
 const section=page.locator('#wdDocs'),host=section.locator('#wdDocKinds');
 await expect(host.getByRole('button')).toHaveText(['전체','교섭·합의','투쟁','홍보','기타']);
 await expect(kinds(section)).toHaveText(['교섭·합의','투쟁','기타','기타','기타']);
 await tap(page,chip(host,'기타'),1280);
 await expect(section.locator('.wd-doc-main b')).toHaveText(['합성 교섭 일정','합성 집회 계획','합성 투쟁 일정 2']);
 expect(f.errors).toEqual([]);
});

test('a project or organization with no documents shows no kind chips',async({page})=>{
 const f=await fixture(page,{width:1280,docs:[]});
 await openOrg(page);
 await expect(page.locator('#wdDocKinds')).toBeHidden();
 expect(f.errors).toEqual([]);
});

// 2026-10-24 명진 결정: 담당조직·프로젝트 상세 [자료]는 '회의'를 기본으로 켠 채 연다(회의자료가 처음부터 목록에 보임).
// 자료실은 '회의'만 꺼진 채 열리고 고른 상태를 서버(library_view)에 기억하지만, 상세 칩은 저장하지 않아 그 기억을 쓰지 않는다.
for(const width of [390,1280])test(`organization details open with 회의 on so meeting files show, even when the library remembers 회의 off ${width}`,async({page})=>{
 const docs=[
  doc('m1','합성 노사협의회 안건','회의자료','2026-10-09',{organization_id:O,project_id:P,meeting_id:'meeting-1'}),
  doc('m2','합성 노사협의회 결과','회의결과','2026-10-08',{organization_id:O,project_id:P,meeting_id:'meeting-1'}),
  ...seedDocs(),
 ];
 const f=await fixture(page,{width,docs,libraryView:{categories_off:['회의']}});
 await openOrg(page);
 let section=page.locator('#wdDocs'),host=section.locator('#wdDocKinds');
 await expect(chip(host,'회의')).toHaveAttribute('aria-pressed','true');
 await expect(chip(host,'전체')).toHaveAttribute('aria-pressed','true');
 await expect(section.locator('.wd-doc-main b').first()).toHaveText('합성 노사협의회 안건');
 await expect(section.locator('.wd-doc-main b').nth(1)).toHaveText('합성 노사협의회 결과');
 await expect(kinds(section).first()).toHaveText('회의');
 // 끄면 숨고, 다른 조직을 열었다 돌아오면 다시 기본(켜짐)에서 시작한다.
 await tap(page,chip(host,'회의'),width);
 await expect(section.locator('.wd-doc-main b').first()).toHaveText('합성 교섭 일정');
 await page.evaluate(async id=>{await window.KPTUWorkplace.open(id)},O2);await expect(page.locator('#wdDocs .wd-doc-main b').first()).toHaveText('다른 조직 자료');
 await openOrg(page);section=page.locator('#wdDocs');host=section.locator('#wdDocKinds');
 await expect(chip(host,'회의')).toHaveAttribute('aria-pressed','true');
 await expect(section.locator('.wd-doc-main b').first()).toHaveText('합성 노사협의회 안건');
 expect(f.calls('app_profiles','PATCH')).toEqual([]);expect(f.errors).toEqual([]);
});
for(const width of [390,1280])test(`project details open with 회의 on so meeting files show, even when the library remembers 회의 off ${width}`,async({page})=>{
 const docs=[
  doc('m1','합성 노사협의회 안건','회의자료','2026-10-09',{organization_id:O,project_id:P,meeting_id:'meeting-1'}),
  doc('m2','합성 노사협의회 결과','회의결과','2026-10-08',{organization_id:O,project_id:P,meeting_id:'meeting-1'}),
  ...seedDocs(),
 ];
 const f=await fixture(page,{width,docs,libraryView:{categories_off:['회의']}});
 await openProjectDetail(page);
 const section=page.locator('#ps3-documents'),host=section.locator('#ps3DocKinds');
 await expect(chip(host,'회의')).toHaveAttribute('aria-pressed','true');
 await expect(section.locator('.ps3-doc-row b').first()).toHaveText('합성 노사협의회 안건');
 await expect(section.locator('.ps3-doc-row b').nth(1)).toHaveText('합성 노사협의회 결과');
 await tap(page,chip(host,'회의'),width);await expect(section.locator('.ps3-doc-row b').first()).toHaveText('합성 교섭 일정');
 // 상세의 칩은 저장하지 않는다(자료실 기억을 바꾸지 않음).
 expect(f.calls('app_profiles','PATCH')).toEqual([]);expect(f.calls('app_documents','PATCH')).toEqual([]);
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});
