import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {showBasketRow} from './helpers/basket-more.mjs';

// UI-바구니첨부메모 PR 3: 조직 쪽 ⑨⑩(조직에 자료로 넣기·조직 상세 [자료] 묶음·자료실을 조직으로 걸러 열기)와 분류 목록 편집.
// Supabase REST·RPC·Edge 경계만 합성이고 화면은 실제 앱이다. 서버 함수(app_document_category_*)의 동작은 migration 문서대로 흉내 낸다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const ONLY='10000000-0000-4000-8000-000000000001',TEXT='10000000-0000-4000-8000-000000000002';
const P='20000000-0000-4000-8000-000000000001',OLD='20000000-0000-4000-8000-000000000002';
const O='30000000-0000-4000-8000-000000000001',O2='30000000-0000-4000-8000-000000000002';
const HWP={drive_file_id:'drive-hwp',file_name:'합성 요구안.hwp',mime_type:'application/x-hwp',size_bytes:2048};
const PDF={drive_file_id:'drive-pdf',file_name:'합성 공문.pdf',mime_type:'application/pdf',size_bytes:4096};
const DEFAULT=['교섭','투쟁','교육','선전','정책','회의','기타'];
const reviewDir=process.env.UI_REVIEW_DIR||'';
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const doc=(id,title,category,date,extra={})=>({id,workspace_id:'w',project_id:null,organization_id:null,meeting_id:null,title,file_id:'f-'+id,file_name:title+'.pdf',mime_type:'application/pdf',category,document_date:date,drive_url:'https://example.org/'+id,created_at:'2026-08-01T01:00:00Z',tags:[],...extra});
const seedDocs=()=>[
 doc('doc-hwp','합성 요구안','교섭자료','2026-09-14',{project_id:OLD,file_id:'drive-hwp',file_name:'합성 요구안.hwp',mime_type:'application/x-hwp'}),
 doc('od1','합성 교섭 일정','교섭자료','2026-10-05',{organization_id:O}),
 doc('od2','합성 집회 계획','투쟁','2026-10-01',{organization_id:O}),
 doc('od3','합성 교육 안내','교육자료','2026-09-20',{organization_id:O}),
 doc('od4','합성 국토부 지침','정부자료','2026-09-02',{organization_id:O}),
 doc('other','다른 조직 자료','선전','2026-09-30',{organization_id:O2}),
];
const rank=(a,b,key)=>{const x=a[key]??null,y=b[key]??null;return x===y?0:x==null?1:y==null?-1:x<y?1:-1;};

async function fixture(page,{width=390,scheme='light',docs=seedDocs(),categories=[...DEFAULT],profileFails=false}={}){
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
  return route.fulfill({json:[{document_categories:server.categories}]});
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
const titles=page=>page.locator('#documentList .lu-row-title');

for(const width of [390,1280])test(`files-only memo goes into the organization as library documents, with no record ${width}`,async({page})=>{
 const f=await fixture(page,{width}),detail=await openNote(page,ONLY,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);
 await expect(detail.locator('#basketManualLinkTitle')).toHaveText('조직·프로젝트 자료로 넣기');
 await pick(page,detail,'organization','합성 한빛지부',width);
 const target=detail.locator(`[data-manual-target="organization:${O}"]`);
 // No summary box by default; the files are said to go in as that organization's documents. One document moves from another organization? No: the HWP sits in a project only.
 await expect(target.locator('textarea')).toHaveCount(0);
 await expect(target.locator('[data-manual-file-note]')).toHaveText('파일 2개를 이 담당조직 자료로 넣어요.');
 await expect(target.getByRole('button',{name:'기록도 남기기'})).toHaveAttribute('aria-pressed','false');
 await expect(detail.getByRole('button',{name:'자료로 넣기',exact:true})).toBeVisible();
 await tap(page,detail.getByRole('button',{name:'자료로 넣기',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('파일 2개를 합성 한빛지부 자료로 넣었어요.');
 // Only organization_id is written; the HWP keeps its project; no record link; one library document per Drive file.
 expect(f.rpc).toEqual([]);expect(f.tables.app_record_links).toEqual([]);
 expect(f.sends).toEqual([{action:'register-basket-attachment',note_id:ONLY,drive_file_id:'drive-pdf'}]);
 expect(f.calls('app_documents','PATCH').map(c=>[c.query.id,Object.keys(c.body).sort().join(',')])).toEqual([['eq.doc-hwp','organization_id,updated_at'],['eq.doc-pdf','organization_id,updated_at']]);
 expect(f.tables.app_documents.find(d=>d.id==='doc-hwp')).toMatchObject({project_id:OLD,organization_id:O});
 expect(f.tables.app_documents.find(d=>d.id==='doc-pdf')).toMatchObject({project_id:null,organization_id:O});
 // The memo is classified: the line names the organization, with no 미분류.
 await expect(detail.locator('[data-basket-filed-org]')).toHaveText('담당조직 자료: 합성 한빛지부 · 자료');
 await expect(detail.locator('.basket-note-meta')).not.toContainText('미분류');
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`[기록도 남기기] on an organization adds a required summary and also records ${width}`,async({page})=>{
 const f=await fixture(page,{width}),detail=await openNote(page,ONLY,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);await pick(page,detail,'organization','합성 한빛지부',width);
 const target=detail.locator(`[data-manual-target="organization:${O}"]`);
 await tap(page,target.getByRole('button',{name:'기록도 남기기'}),width);
 await expect(target.locator('textarea')).toBeFocused();
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);
 await expect(detail.locator('[data-manual-status]')).toContainText('요약');expect(f.rpc).toEqual([]);expect(f.calls('app_documents','PATCH')).toEqual([]);
 await target.locator('textarea').fill('한빛지부 요구안 전달');
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요. 파일 2개를 합성 한빛지부 자료로 넣었어요.');
 expect(f.rpc[0].p_targets).toEqual([{kind:'organization',target_id:O,reason:'직접 연결',summary:'한빛지부 요구안 전달'}]);
 expect(f.calls('app_documents','PATCH')).toHaveLength(2);
 expect(f.errors).toEqual([]);
});

test('a memo with text keeps the required summary and its file goes into the organization automatically',async({page})=>{
 const f=await fixture(page,{width:1280}),detail=await openNote(page,TEXT,1280);
 await detail.getByRole('button',{name:'연결하기'}).click();
 await expect(detail.locator('#basketManualLinkTitle')).toHaveText('조직·프로젝트에 연결');
 await pick(page,detail,'organization','합성 한빛지부',1280);
 const target=detail.locator(`[data-manual-target="organization:${O}"]`);
 await expect(target.getByRole('button',{name:'기록도 남기기'})).toHaveCount(0);
 await expect(target.locator('[data-manual-file-note]')).toHaveText('파일 1개를 이 담당조직 자료로 넣어요.');
 await target.locator('textarea').fill('2차 교섭 일정 합의');
 await detail.getByRole('button',{name:'연결',exact:true}).click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요. 파일 1개를 합성 한빛지부 자료로 넣었어요.');
 expect(f.rpc[0].p_targets).toEqual([{kind:'organization',target_id:O,reason:'직접 연결',summary:'2차 교섭 일정 합의'}]);
 expect(f.tables.app_documents.find(d=>d.file_id==='drive-pdf').organization_id).toBe(O);
 expect(f.errors).toEqual([]);
});

test('a project and an organization together take the files in one write per document and move them from another organization',async({page})=>{
 const docs=seedDocs();docs.find(d=>d.id==='doc-hwp').organization_id=O2;
 const f=await fixture(page,{width:1280,docs}),detail=await openNote(page,ONLY,1280);
 await detail.getByRole('button',{name:'연결하기'}).click();
 await pick(page,detail,'project','합성 임단협',1280);await pick(page,detail,'organization','합성 한빛지부',1280);
 await expect(detail.locator(`[data-manual-target="project:${P}"] [data-manual-file-note]`)).toHaveText('파일 2개를 이 프로젝트 자료로 넣어요. 합성 지난 교섭에서 옮겨요.');
 await expect(detail.locator(`[data-manual-target="organization:${O}"] [data-manual-file-note]`)).toHaveText('파일 2개를 이 담당조직 자료로 넣어요. 합성 샛별지부에서 옮겨요.');
 // A second project of the same kind is told the files go to the first one only.
 await detail.getByRole('button',{name:'자료로 넣기',exact:true}).click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('파일 2개를 합성 임단협·합성 한빛지부 자료로 넣었어요.');
 expect(f.calls('app_documents','PATCH').map(c=>[c.query.id,Object.keys(c.body).sort().join(',')])).toEqual([['eq.doc-hwp','organization_id,project_id,updated_at'],['eq.doc-pdf','organization_id,project_id,updated_at']]);
 expect(f.tables.app_documents.filter(d=>['doc-hwp','doc-pdf'].includes(d.id)).map(d=>[d.project_id,d.organization_id])).toEqual([[P,O],[P,O]]);
 expect(f.rpc).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [390,1280])for(const scheme of ['light','dark'])test(`organization detail shows 5 recent documents and opens the library filtered to it ${width} ${scheme}`,async({page},info)=>{
 const f=await fixture(page,{width,scheme}),detail=await openNote(page,ONLY,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);await pick(page,detail,'organization','합성 한빛지부',width);
 await tap(page,detail.getByRole('button',{name:'자료로 넣기',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('파일 2개를 합성 한빛지부 자료로 넣었어요.');
 await openOrg(page);
 const section=page.locator('#wdDocs');
 await expect(section.locator('h3')).toContainText('자료');await expect(section.locator('[data-wd-doc-count]')).toHaveText('6');
 await expect(section.locator('.wd-doc-row')).toHaveCount(5);
 await expect(section.locator('.wd-doc-main b')).toHaveText(['합성 교섭 일정','합성 집회 계획','합성 교육 안내','합성 요구안','합성 국토부 지침']);
 await expect(section.locator('.doc-category-tag')).toHaveText(['교섭','투쟁','교육','교섭','정책']);
 await expect(section.getByRole('button',{name:'전체 6개 보기'})).toBeVisible();
 await expect(section).not.toContainText('다른 조직 자료');
 for(const target of await section.locator('.wd-doc-main,.wd-doc-all,.wd-doc-more>summary').all())expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(43);
 expect(await noWideScroll(page)).toBe(true);
 await capture(page,info,`org-docs-${width}-${scheme}`,section);
 await section.getByRole('button',{name:'전체 6개 보기'}).click();
 await expect(page.locator('#wdModal')).toBeHidden();
 // The library is the same screen filtered to this organization: search, month groups, newest first, 7 category chips.
 await expect(page.locator('#libraryView')).toBeVisible();
 const orgChips=page.locator('#libraryOrganizationFilter');
 await expect(orgChips.getByRole('radio')).toHaveText(['전체','합성 한빛지부']);await expect(orgChips.getByRole('radio',{name:'합성 한빛지부'})).toHaveAttribute('aria-checked','true');
 await expect(page.locator('#libraryCategoryFilter').getByRole('radio')).toHaveText(['전체',...DEFAULT]);
 await expect(page.locator('#documentList > *')).toHaveText([/^2026년 10월$/,/합성 공문/,/합성 교섭 일정/,/합성 집회 계획/,/^2026년 9월$/,/합성 교육 안내/,/합성 요구안/,/합성 국토부 지침/]);
 await expect(page.locator('#documentList')).not.toContainText('다른 조직 자료');
 await expect(page.locator('#documentSearch')).toHaveValue('');
 // Rows keep the file kind and show the small category tag.
 await expect(page.locator('[data-lu-document="doc-hwp"] .lu-file-kind')).toHaveText('HWP');
 await expect(page.locator('#documentList .doc-category-tag')).toHaveText(['기타','교섭','투쟁','교육','교섭','정책']);
 expect(await noWideScroll(page)).toBe(true);
 await capture(page,info,`library-org-${width}-${scheme}`);
 const chips=page.locator('#libraryCategoryFilter');
 await chips.getByRole('radio',{name:'교섭'}).click();await expect(page.locator('.lu-row')).toHaveCount(2);
 await chips.getByRole('radio',{name:'정책'}).click();await expect(page.locator('.lu-row')).toHaveText([/합성 국토부 지침/]);
 await chips.getByRole('radio',{name:'전체'}).click();await expect(page.locator('.lu-row')).toHaveCount(6);
 // [전체] on the organization row lifts the filter: every document of the workspace shows.
 await orgChips.getByRole('radio',{name:'전체'}).click();
 await expect(orgChips).toBeHidden();await expect(page.locator('.lu-row')).toHaveCount(f.tables.app_documents.length);
 expect(f.errors).toEqual([]);
});

test('leaving the library lifts the organization filter, and a document can be taken off the organization',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openOrg(page);
 const section=page.locator('#wdDocs');
 await expect(section.locator('.wd-doc-row')).toHaveCount(4);await expect(section.getByRole('button',{name:'전체 4개 보기'})).toBeVisible();
 // [조직에서 빼기] only unlinks: the document and its file stay in the library.
 const row=section.locator('[data-wd-doc="od2"]');
 await row.locator('summary').click();
 page.once('dialog',dialog=>{expect(dialog.message()).toContain('자료와 파일은 자료실에 그대로 있고');return dialog.accept();});
 await row.getByRole('button',{name:'조직에서 빼기'}).click();
 await expect(section.locator('.wd-doc-row')).toHaveCount(3);await expect(section.locator('[data-wd-doc-count]')).toHaveText('3');
 await expect(section.locator('[data-wd-doc-state]')).toHaveText('조직에서 뺐어요. 자료는 자료실에 그대로 있어요.');
 const patches=f.calls('app_documents','PATCH');
 expect(patches).toHaveLength(1);expect(patches[0].body).toMatchObject({organization_id:null});expect(patches[0].query.id).toBe('eq.od2');expect(patches[0].query.organization_id).toBe('eq.'+O);
 expect(f.tables.app_documents.find(d=>d.id==='od2')).toMatchObject({organization_id:null,title:'합성 집회 계획'});
 await section.getByRole('button',{name:'전체 3개 보기'}).click();
 await expect(page.locator('#libraryOrganizationFilter')).toBeVisible();await expect(page.locator('.lu-row')).toHaveCount(3);
 await clickView(page,'home');
 await clickView(page,'library');
 await expect(page.locator('#libraryOrganizationFilter')).toBeHidden();await expect(page.locator('.lu-row')).toHaveCount(f.tables.app_documents.length);
 expect(f.errors).toEqual([]);
});

test('an organization without documents says how to add them, and a failed read can be retried',async({page})=>{
 const f=await fixture(page,{width:1280});
 await openOrg(page,O2);
 await expect(page.locator('#wdDocs .wd-doc-row')).toHaveCount(1);
 await page.locator('[data-wd-close="wdModal"]').click();
 f.tables.app_documents.forEach(d=>{if(d.organization_id===O2)d.organization_id=null;});
 await openOrg(page,O2);
 await expect(page.locator('#wdDocBody')).toContainText('붙은 자료가 없습니다. 바구니 업데이트의 [연결하기]에서 파일을 이 조직 자료로 넣을 수 있습니다.');
 await expect(page.locator('#wdDocs [data-wd-library]')).toHaveCount(0);
 await page.locator('[data-wd-close="wdModal"]').click();
 let fail=true;
 await page.route(SB+'/rest/v1/app_documents?**',route=>{if(fail&&route.request().method()==='GET')return route.fulfill({status:500,json:{message:'QA failure'}});return route.fallback();});
 await openOrg(page,O);
 await expect(page.locator('#wdDocBody')).toContainText('자료를 불러오지 못했습니다.');await expect(page.locator('#wdDocs [data-wd-doc-count]')).toBeHidden();
 fail=false;await page.locator('[data-wd-doc-retry]').click();
 await expect(page.locator('#wdDocs .wd-doc-row')).toHaveCount(4);
});

// 분류 목록 편집 ---------------------------------------------------------------------------------------------------------------------
const editorDocs=()=>[
 doc('e1','합성 정부 지침','정부자료','2026-10-05'),doc('e2','합성 국회 자료','국회자료','2026-10-04'),doc('e3','합성 직접 입력','정책자료','2026-10-03'),
 doc('e4','합성 교섭 요구안','교섭자료','2026-10-02'),doc('e5','합성 집회','투쟁','2026-10-01'),doc('e6','합성 현장 기록','현장자료','2026-09-30'),
];
async function openEditor(page,width){
 await clickView(page,'library');await expect(page.locator('.lu-row').first()).toBeVisible();
 await tap(page,page.locator('#manageLibraryBtn'),width);
 const modal=page.locator('#libraryManageModal');await expect(modal).toBeVisible();
 const editor=modal.locator('.dce');await expect(editor.locator('.dce-list')).toBeVisible();return {modal,editor};
}
const names=editor=>editor.locator('.dce-row .dce-name');

for(const width of [390,1280])for(const scheme of ['light','dark'])test(`category list: add, rename and delete with the lock on 기타 ${width} ${scheme}`,async({page},info)=>{
 const f=await fixture(page,{width,scheme,docs:editorDocs()});
 const {modal,editor}=await openEditor(page,width);
 await expect(names(editor)).toHaveText(DEFAULT);
 await expect(editor.locator('.dce-count')).toHaveText('7개');
 // '기타' is locked: no rename or delete button, and it says so.
 const lock=editor.locator('[data-dce-row="기타"]');
 await expect(lock.getByRole('button')).toHaveCount(0);await expect(lock).toContainText('고정');
 await expect(editor.locator('[data-dce-row="정책"] .dce-meta')).toHaveText('자료 3개');
 await expect(editor.locator('[data-dce-row="기타"] .dce-meta')).toContainText('자료 1개');
 await expect(editor.locator('.dce-note').first()).toContainText('자료와 파일은 지워지지 않아요');
 expect(await noWideScroll(page)).toBe(true);
 await capture(page,info,`category-editor-${width}-${scheme}`,modal.locator('.modal-card'));
 // Add.
 await editor.locator('#dceNewName').fill('  홍보  ');
 await editor.getByRole('button',{name:'추가',exact:true}).click();
 await expect(editor.locator('.dce-status')).toHaveText('‘홍보’ 분류를 추가했어요.');
 await expect(names(editor)).toHaveText([...DEFAULT,'홍보']);
 expect(f.server.rpc.at(-1)).toEqual({name:'app_document_category_add',body:{p_name:'홍보'}});
 await expect(page.locator('#libraryCategoryFilter').getByRole('radio')).toHaveText(['전체',...DEFAULT,'홍보']);
 await expect(page.locator('#docCategory option')).toHaveText(['자동 분류',...DEFAULT,'홍보']);
 // Rename: the screen tells that this category's documents get the new name; the old stored values go along.
 await editor.getByRole('button',{name:'정책 이름 바꾸기'}).click();
 const form=editor.locator('[data-dce-rename-form="정책"]');
 await expect(form).toContainText('이름을 바꾸면 이 분류의 자료 3개도 새 이름으로 바뀌어요.');
 await form.locator('input').fill('정책·법령');
 await form.getByRole('button',{name:'저장'}).click();
 await expect(editor.locator('.dce-status')).toHaveText('‘정책’을(를) ‘정책·법령’(으)로 바꿨어요. 자료 3개의 분류도 함께 바뀌었어요.');
 const rename=f.server.rpc.at(-1);
 expect(rename.name).toBe('app_document_category_rename');
 expect(rename.body).toMatchObject({p_from:'정책',p_to:'정책·법령'});expect([...rename.body.p_stored].sort()).toEqual(['국회자료','정부자료','정책자료']);
 await expect(names(editor)).toHaveText(['교섭','투쟁','교육','선전','정책·법령','회의','기타','홍보']);
 await expect(editor.locator('[data-dce-row="정책·법령"] .dce-meta')).toHaveText('자료 3개');
 expect(f.tables.app_documents.filter(d=>['e1','e2','e3'].includes(d.id)).map(d=>d.category)).toEqual(['정책·법령','정책·법령','정책·법령']);
 // Delete: the confirm says the documents move to 기타 and nothing is erased.
 let message='';page.once('dialog',dialog=>{message=dialog.message();return dialog.accept();});
 await editor.getByRole('button',{name:'투쟁 지우기'}).click();
 await expect(editor.locator('.dce-status')).toHaveText('‘투쟁’ 분류를 지웠어요. 자료 1개는 ‘기타’로 옮겼어요.');
 expect(message).toContain('‘투쟁’ 분류를 지울까요?');expect(message).toContain('자료 1개는 ‘기타’로 옮겨져요.');expect(message).toContain('자료와 파일은 지워지지 않아요');
 await expect(names(editor)).toHaveText(['교섭','교육','선전','정책·법령','회의','기타','홍보']);
 expect(f.server.rpc.at(-1)).toEqual({name:'app_document_category_delete',body:{p_name:'투쟁',p_stored:[]}});
 expect(f.tables.app_documents.find(d=>d.id==='e5').category).toBe('기타');
 // The library behind the window follows: 기타 now holds the deleted category's document and the field record.
 await tap(page,modal.locator('#libraryManageClose'),width);
 await expect(page.locator('#libraryCategoryFilter').getByRole('radio')).toHaveText(['전체','교섭','교육','선전','정책·법령','회의','기타','홍보']);
 await page.locator('#libraryCategoryFilter').getByRole('radio',{name:'기타'}).click();
 await expect(page.locator('.lu-row-title')).toHaveText(['합성 집회','합성 현장 기록']);
 await page.locator('#libraryCategoryFilter').getByRole('radio',{name:'정책·법령'}).click();
 await expect(page.locator('.lu-row')).toHaveCount(3);
 // Only the three category functions were called; documents were never written by hand.
 expect(f.server.rpc.map(c=>c.name)).toEqual(['app_document_category_add','app_document_category_rename','app_document_category_delete']);
 expect(f.calls('app_documents','PATCH')).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('category list: client checks, server refusals and an unknown result are explained in plain words',async({page})=>{
 const f=await fixture(page,{width:1280,docs:editorDocs()});
 const {editor}=await openEditor(page,1280);
 const add=editor.getByRole('button',{name:'추가',exact:true}),status=editor.locator('.dce-status');
 // Checked before sending: empty, duplicate, comma (and the box stops at 20 characters).
 await add.click();await expect(status).toHaveText('분류 이름을 적어 주세요.');
 await editor.locator('#dceNewName').fill('교섭');await add.click();await expect(status).toHaveText('이미 있는 분류 이름이에요.');
 await editor.locator('#dceNewName').fill('가,나');await add.click();await expect(status).toHaveText('분류 이름에는 쉼표를 쓸 수 없어요.');
 await expect(editor.locator('#dceNewName')).toHaveAttribute('maxlength','20');
 expect(f.server.rpc).toEqual([]);
 // A name taken meanwhile (server says exists): the list is re-read and nothing changed.
 f.server.categories=[...DEFAULT,'홍보'];
 await editor.locator('#dceNewName').fill('홍보');await add.click();
 await expect(status).toHaveText('이미 있는 분류 이름이에요. 아무것도 바뀌지 않았어요.');
 await expect(names(editor)).toHaveText([...DEFAULT,'홍보']);
 // Rename to an existing name, and renaming a name that is gone: refused with nothing changed.
 await editor.getByRole('button',{name:'교육 이름 바꾸기'}).click();
 const form=editor.locator('[data-dce-rename-form="교육"]');await form.locator('input').fill('선전');await form.getByRole('button',{name:'저장'}).click();
 await expect(status).toHaveText('이미 있는 분류 이름이에요.');
 await expect(form.locator('input')).toHaveValue('선전');
 await form.getByRole('button',{name:'취소'}).click();await expect(editor.locator('[data-dce-rename-form]')).toHaveCount(0);
 expect(f.server.rpc.map(c=>c.name)).toEqual(['app_document_category_add']);
 // A server refusal (permission) says nothing changed and keeps the typed name.
 f.server.next={json:{ok:false,error:'PERMISSION_DENIED'}};
 await editor.locator('#dceNewName').fill('새이름');await add.click();
 await expect(status).toHaveText('분류 목록을 바꿀 권한을 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요. 아무것도 바뀌지 않았어요.');
 await expect(editor.locator('#dceNewName')).toHaveValue('새이름');
 // A lost answer (500): never resent; the list is re-read from the server and the person is told to check.
 f.server.next={status:500,json:{message:'QA failure'}};
 const before=f.server.rpc.length;
 await add.click();
 await expect(status).toHaveText('저장했는지 확인하지 못했어요. 목록을 다시 불러온 뒤 확인해 주세요.');
 expect(f.server.rpc.length).toBe(before+1);
 await expect(names(editor)).toHaveText([...DEFAULT,'홍보']);
 expect(f.errors.filter(e=>!/500/.test(e))).toEqual([]);
});

test('category list: when the list cannot be read the window does not let the person edit a guess',async({page})=>{
 const f=await fixture(page,{width:390,docs:editorDocs(),profileFails:true});
 const {editor}=await (async()=>{
  await clickView(page,'library');await expect(page.locator('.lu-row').first()).toBeVisible();
  await tap(page,page.locator('#manageLibraryBtn'),390);
  const modal=page.locator('#libraryManageModal');await expect(modal).toBeVisible();return {editor:modal.locator('.dce')};
 })();
 await expect(editor).toContainText('분류 목록을 불러오지 못했어요.');
 await expect(editor.locator('#dceNewName')).toHaveCount(0);await expect(editor.getByRole('button',{name:'추가',exact:true})).toHaveCount(0);
 // The documents still show with the default 7 names.
 await expect(page.locator('#libraryManageList .library-manage-row').first()).toBeVisible();
 f.server.profileFails=false;
 await editor.getByRole('button',{name:'다시 불러오기'}).click();
 await expect(editor.locator('.dce-list')).toBeVisible();await expect(names(editor)).toHaveText(DEFAULT);
});

test('a changed list is the list every screen uses: upload form, edit form, project documents and the basket chips',async({page})=>{
 const docs=editorDocs();docs.find(d=>d.id==='e1').project_id=P;
 const f=await fixture(page,{width:1280,docs,categories:['교섭','투쟁','교육','선전','정책','홍보','회의','기타']});
 await clickView(page,'library');
 await expect(page.locator('#libraryCategoryFilter').getByRole('radio')).toHaveText(['전체','교섭','투쟁','교육','선전','정책','홍보','회의','기타']);
 await page.locator('#newDocumentBtn').click();
 await expect(page.locator('#docCategory option')).toHaveText(['자동 분류','교섭','투쟁','교육','선전','정책','홍보','회의','기타']);
 await page.locator('[data-close="documentModal"]').click();
 await page.locator('[data-lu-document="e4"] .lu-more-trigger').click();await page.locator('#luMorePanel [data-lu-edit]').click();
 await expect(page.locator('#libraryEditCategory option')).toHaveText(['교섭','투쟁','교육','선전','정책','홍보','회의','기타']);await expect(page.locator('#libraryEditCategory')).toHaveValue('교섭');
 await page.locator('[data-close="libraryEditModal"],#libraryEditClose').first().click();
 await clickView(page,'projects');await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
 await page.locator(`[data-ps3-project="${P}"]`).first().click();
 await expect(page.locator('#ps3-documents .doc-category-tag')).toHaveText(['정책']);
 expect(f.errors).toEqual([]);
});
