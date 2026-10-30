// REF-참고묶음 화면 2 (docs/design/ref-bundle.md 6·7-3절): 참고 고르기 → 저장 → 참고 묶음 화면 → 이름 바꾸기 → 주간 정리에 없음.
// 가짜 이름·가짜 글만 쓴다. 서버는 흉내(app_reference_bundles·app_record_links·app_notes·연결 RPC)이고 상태를 기억한다.
import {test,expect} from '@playwright/test';
import {answerAsk} from './helpers/small-notice.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {showBasketRow} from './helpers/basket-more.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const n='10000000-0000-4000-8000-0000000000a1',o='30000000-0000-4000-8000-0000000000a1';
const b1='50000000-0000-4000-8000-000000000001',b2='50000000-0000-4000-8000-000000000002',b3='50000000-0000-4000-8000-000000000003';
const RAW='합성 본부 토론회 11.5 14:00 국회, 지부별 2명 요청';

async function fixture(page,{width=1280}={}){
 await page.setViewportSize({width,height:900});
 await openHome(page);
 const errors=[],calls=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource/.test(e.text()))errors.push(e.text());});
 const note={id:n,workspace_id:'w',kind:'basket',occurred_at:stamp,created_at:stamp,updated_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
 const bundles=[[b1,'합성 노조 전체',10],[b2,'합성 본부 사업',20],[b3,'합성 기타 조직',30]].map(([id,name,sort_order],i)=>({id,workspace_id:'w',name,sort_order,created_at:'2026-10-0'+(i+1)+'T00:00:00Z',updated_at:'2026-10-0'+(i+1)+'T00:00:00Z'}));
 const links=[];
 const nameOf=row=>({...row,organization:row.organization_id?{name:'합성 한빛지부'}:null,project:null,meeting:null,document:null,bundle:row.bundle_id?{name:bundles.find(b=>b.id===row.bundle_id)?.name}:null});
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true}]}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:[{organization_id:o,user_id:'home-test'}]}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_project_progress_updates?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_notes?**',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()!=='GET')return r.fulfill({json:[]});
  const kind=q.get('kind');if(kind&&kind!=='eq.basket')return r.fulfill({json:[]});
  const id=q.get('id');if(id&&id!=='eq.'+n)return r.fulfill({json:[]});
  return r.fulfill({json:Number(q.get('offset')||0)?[]:[note]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_reference_bundles',r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method(),eq=k=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
  if(method==='GET')return r.fulfill({json:Number(q.get('offset')||0)?[]:bundles.map(b=>({...b}))});
  const body=method==='DELETE'?null:req.postDataJSON();writes.push({table:'bundles',method,query:Object.fromEntries(q),body});
  if(method==='PATCH'){
   const row=bundles.find(b=>b.id===eq('id')&&b.workspace_id===eq('workspace_id')&&(!q.has('updated_at')||b.updated_at===eq('updated_at')));
   if(!row)return r.fulfill({json:[]});
   if(body.name&&bundles.some(b=>b!==row&&b.name===body.name))return r.fulfill({status:409,json:{code:'23505',message:'duplicate'}});
   Object.assign(row,body,{updated_at:'2026-10-06T02:00:00.000Z'});return r.fulfill({json:[{...row}]});
  }
  if(method==='POST'){const row={id:'50000000-0000-4000-8000-00000000000'+(bundles.length+1),created_at:'2026-10-06T03:00:00Z',updated_at:'2026-10-06T03:00:00Z',...body};bundles.push(row);return r.fulfill({status:201,json:[row]});}
  if(method==='DELETE'){const at=bundles.findIndex(b=>b.id===eq('id'));if(links.some(l=>l.bundle_id===eq('id')))return r.fulfill({status:409,json:{code:'23503'}});const gone=at>=0?bundles.splice(at,1):[];return r.fulfill({json:gone.map(b=>({id:b.id}))});}
  return r.fulfill({status:405,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='DELETE'){const id=decodeURIComponent(q.get('id').slice(3)),at=links.findIndex(l=>l.id===id);writes.push({table:'links',method:'DELETE',id});return r.fulfill({json:at>=0?links.splice(at,1).map(l=>({id:l.id})):[]});}
  if(q.has('google_task_id')||Number(q.get('offset')||0))return r.fulfill({json:[]});
  let rows=links.map(nameOf);
  if(q.get('bundle_id')==='not.is.null')rows=rows.filter(l=>l.bundle_id).map(l=>({...l,note:{id:note.id,workspace_id:'w',occurred_at:note.occurred_at,raw_text:note.raw_text,kind:'basket',title:null}}));
  if(q.get('or'))rows=rows.filter(l=>l.organization_id||l.project_id).map(l=>({...l,note:{id:note.id,workspace_id:'w',occurred_at:note.occurred_at,raw_text:note.raw_text,kind:'basket',title:null}}));
  return r.fulfill({json:rows});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{
  const body=r.request().postDataJSON();calls.push(body);
  for(const t of body.p_targets){const col=t.kind==='reference'?'bundle_id':t.kind==='project'?'project_id':'organization_id';
   if(!links.some(l=>l[col]===t.target_id))links.push({id:'40000000-0000-4000-8000-'+String(links.length+1).padStart(12,'0'),workspace_id:'w',note_id:n,status:'confirmed',summary:t.summary??null,organization_id:null,project_id:null,bundle_id:null,meeting_id:null,document_id:null,[col]:t.target_id});}
  return r.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 return {note,bundles,links,calls,writes,errors};
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
async function openNote(page,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 await tap(page,page.locator(`[data-basket-row="${n}"]`),width);await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return page.locator('[data-basket-detail]');
}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`[연결하기] [참고 ▾]로 고르기 → 저장 → 참고 묶음 화면 → 이름 바꾸기 → 주간 정리에 없음 ${width}`,async({page},info)=>{
 const f=await fixture(page,{width}),detail=await openNote(page,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);
 await expect(detail.locator('[data-manual-pick]')).toHaveText(['담당조직 고르기 ▾','사업영역 꼬리표 달기 ▾','참고 ▾']);
 await tap(page,detail.locator('[data-manual-pick="reference"]'),width);
 const sheet=page.locator('#basketLinkChoiceSheet');await expect(sheet).toBeVisible();
 await expect(sheet.locator('h2')).toHaveText('참고 묶음 선택');
 await expect(sheet.locator('[data-sheet-value]')).toHaveText(['합성 노조 전체','합성 본부 사업','합성 기타 조직']);
 await tap(page,sheet.getByRole('button',{name:'합성 본부 사업',exact:true}),width);await expect(sheet).toBeHidden();
 await expect(detail.locator(`[data-manual-target="reference:${b2}"]`)).toContainText('참고 · 합성 본부 사업');
 // UPD-요약부품통일 A(2026-10-24 명진 요청): 참고에도 담당조직·프로젝트와 같은 작은 [AI 요약]이 있다(누르지 않으면 요청 없음).
 await expect(detail.locator(`[data-manual-target="reference:${b2}"] [data-manual-ai-run]`)).toHaveCount(1);
 expect(await noWideScroll(page)).toBe(true);
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');
 expect(f.calls).toEqual([{p_note_id:n,p_note_updated_at:stamp,p_targets:[{kind:'reference',target_id:b2,reason:'직접 연결'}]}]);
 await expect(detail.locator('[data-basket-state]')).toContainText('합성 본부 사업');
 if(width===390)await page.screenshot({path:info.outputPath('reference-linked-390.png'),fullPage:true});

 // 업데이트 화면의 "참고: ○○" 칩 → 참고 묶음 화면에 그 묶음이 열린다.
 await tap(page,detail.locator('[data-basket-chip-open]').filter({hasText:'합성 본부 사업'}),width);
 await expect(page.locator('#referenceView')).toBeVisible();
 await expect(page).toHaveURL(/view=reference/);
 const detailPane=page.locator('#rbDetail');
 await expect(detailPane.locator('.rb-detail-name')).toHaveText('합성 본부 사업');
 await expect(detailPane.locator('.rb-item')).toHaveCount(1);
 await expect(detailPane.locator('.rb-item .rb-line')).toHaveText(RAW);
 await expect(detailPane.locator('.rb-item .rb-date')).toHaveText('10.6');
 if(width>=761){
  // PC: 목록과 상세가 같이 보이고, 목록 줄에는 이름 · 소식 수 · 마지막 날짜.
  await expect(page.locator('#rbList')).toBeVisible();
  await expect(page.locator(`#rbList [data-rb-bundle="${b2}"] .rb-meta`)).toHaveText('1 · 10.6');
  await expect(page.locator(`#rbList [data-rb-bundle="${b1}"] .rb-meta`)).toHaveText('0');
  await expect(page.locator('#rbSplit .split-resize-handle')).toBeVisible();
 }else{
  await expect(page.locator('#rbList')).toBeHidden();
 }
 expect(await noWideScroll(page)).toBe(true);
 await page.screenshot({path:info.outputPath(`reference-detail-${width}.png`),fullPage:true});

 // 이름 바꾸기: 상세 머리 ⋯ → [이름 바꾸기] → 그 자리 입력 → [저장]. updated_at 조건 PATCH 한 번.
 await tap(page,detailPane.locator('[data-rb-detail-more]'),width);
 await expect(page.locator('#rbMenu button')).toHaveText(['이름 바꾸기']); // 붙은 소식이 있으면 [묶음 지우기] 없음
 await tap(page,page.locator('#rbMenu [data-rb-act="rename"]'),width);
 const input=detailPane.locator('[data-rb-rename-input]');await expect(input).toBeFocused();await expect(input).toHaveValue('합성 본부 사업');
 await input.fill('합성 본부 사업(바뀐 이름)');
 await tap(page,detailPane.locator('[data-rb-rename-save]'),width);
 await expect(detailPane.locator('.rb-detail-name')).toHaveText('합성 본부 사업(바뀐 이름)');
 const patch=f.writes.find(w=>w.table==='bundles'&&w.method==='PATCH');
 expect(patch.query).toMatchObject({id:'eq.'+b2,workspace_id:'eq.w',updated_at:'eq.2026-10-02T00:00:00Z'});
 expect(patch.body.name).toBe('합성 본부 사업(바뀐 이름)');
 // 연결 줄은 id로 가리키므로 그대로이고, 바구니 칩도 새 이름으로 보인다.
 expect(f.links).toHaveLength(1);
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await tap(page,page.locator('[data-basket-filter="classified"]'),width);
 await expect(page.locator(`[data-basket-row-item="${n}"]`)).toContainText('합성 본부 사업(바뀐 이름)');

 // 주간 정리: 참고에만 붙인 소식은 조직 소식('미분류')·[복사] 글 어디에도 없다.
 await page.evaluate(()=>window.KPTURouter.go('home'));
 await expect(page.locator('#homeView')).toBeVisible();
 await page.locator('#journalRoot [data-journal-mode="week"]').click();
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).toBeVisible();
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).not.toContainText('합성 본부 토론회');
 await expect(page.locator('#journalRoot [data-journal-weekly-root]')).not.toContainText('미분류');
 expect(f.errors).toEqual([]);
});

test('참고 묶음 화면: 담당조직 목록 맨 아래 입구, 묶음 더하기·순서 바꾸기·빈 묶음만 지우기, 연결 해제 5초 되돌리기 1280',async({page})=>{
 const f=await fixture(page,{width:1280});
 f.links.push({id:'40000000-0000-4000-8000-000000000101',workspace_id:'w',note_id:n,status:'confirmed',summary:'합성 참고 요약',organization_id:null,project_id:null,bundle_id:b1,meeting_id:null,document_id:null});
 await page.locator('.app-nav [data-view="team"]').click();
 await expect(page.locator(`#soOrganizationList [data-so-org="${o}"]`)).toBeVisible();
 const entry=page.locator('#soOrganizationList .so-reference-entry');
 await expect(entry).toHaveText('참고 묶음 ›');
 // 맨 아래 한 줄.
 expect(await page.locator('#soOrganizationList > *').last().evaluate(el=>el.classList.contains('so-reference-entry'))).toBe(true);
 await entry.click();
 await expect(page.locator('#referenceView')).toBeVisible();
 // 사이드바·하단 탭에 새 항목이 없고, 담당조직 메뉴가 계속 선택된 것으로 보인다.
 await expect(page.locator('.app-nav [data-view="reference"]')).toHaveCount(0);
 await expect(page.locator('.mobile-tabs [data-view="reference"]')).toHaveCount(0);
 await expect(page.locator('.app-nav .nav-btn[data-view="team"]')).toHaveClass(/active/);
 await expect(page.locator('#rbList [data-rb-bundle]')).toHaveCount(3);
 await expect(page.locator('#rbList [data-rb-bundle] .rb-name')).toHaveText(['합성 노조 전체','합성 본부 사업','합성 기타 조직']);

 // 묶음 더하기.
 await page.locator('#rbList [data-rb-list-more]').click();
 await expect(page.locator('#rbMenu button')).toHaveText(['묶음 더하기','순서 바꾸기']);
 await page.locator('#rbMenu [data-rb-act="add"]').click();
 const add=page.locator('#rbList [data-rb-add-input]');await expect(add).toBeFocused();
 await add.fill('  합성 새 묶음 ');await add.press('Enter');
 await expect(page.locator('#rbList [data-rb-bundle] .rb-name')).toHaveText(['합성 노조 전체','합성 본부 사업','합성 기타 조직','합성 새 묶음']);
 expect(f.writes.find(w=>w.method==='POST').body).toEqual({workspace_id:'w',name:'합성 새 묶음',sort_order:40});

 // 순서 바꾸기: ↑ 한 번 → [저장] → 바뀐 줄만 PATCH.
 await page.locator('#rbList [data-rb-list-more]').click();await page.locator('#rbMenu [data-rb-act="order"]').click();
 await page.locator(`#rbList [data-rb-up="${b3}"]`).click();
 await page.locator('#rbList [data-rb-order-save]').click();
 await expect(page.locator('#rbList [data-rb-bundle] .rb-name')).toHaveText(['합성 노조 전체','합성 기타 조직','합성 본부 사업','합성 새 묶음']);
 const orderWrites=f.writes.filter(w=>w.method==='PATCH'&&'sort_order' in (w.body||{}));
 expect(orderWrites.map(w=>[w.query.id,w.body.sort_order])).toEqual([['eq.'+b3,20],['eq.'+b2,30]]);

 // 빈 묶음만 [묶음 지우기]가 보인다.
 const fresh=f.bundles.find(b=>b.name==='합성 새 묶음');
 await page.locator(`#rbList [data-rb-bundle="${fresh.id}"]`).click();
 await page.locator('#rbDetail [data-rb-detail-more]').click();
 await expect(page.locator('#rbMenu button')).toHaveText(['이름 바꾸기','묶음 지우기']);
 await page.locator('#rbMenu [data-rb-act="delete"]').click();
 expect(await answerAsk(page,true)).toContain('묶음을 지울까요?');
 await expect(page.locator('#rbList [data-rb-bundle]')).toHaveCount(3);
 expect(f.writes.filter(w=>w.method==='DELETE'&&w.table==='bundles')).toHaveLength(1);

 // 붙은 소식이 있는 묶음: 줄 ⋯ → [연결 해제] → 5초 되돌리기(같은 RPC, kind reference).
 await page.locator(`#rbList [data-rb-bundle="${b1}"]`).click();
 await expect(page.locator('#rbDetail .rb-item .rb-line')).toHaveText('합성 참고 요약');
 await page.locator('#rbDetail [data-rb-detail-more]').click();
 await expect(page.locator('#rbMenu button')).toHaveText(['이름 바꾸기']);
 await page.keyboard.press('Escape');
 await page.locator('#rbDetail [data-rb-item-more]').click();
 await expect(page.locator('#rbMenu button')).toHaveText(['업데이트 열기','연결 해제']);
 page.once('dialog',d=>d.accept());
 await page.locator('#rbMenu [data-rb-act="disconnect"]').click();
 await expect(page.locator('#rbDetail .rb-item')).toHaveCount(0);
 await page.locator('[data-undo-action]').click();
 await expect(page.locator('[data-undo-text]')).toHaveText('연결을 되돌렸어요.');
 expect(f.calls.at(-1).p_targets).toEqual([{kind:'reference',target_id:b1,reason:'직접 연결',summary:'합성 참고 요약'}]);
 await expect(page.locator('#rbDetail .rb-item')).toHaveCount(1);

 // 줄 누르기 = 원래 업데이트(바구니).
 await page.locator('#rbDetail [data-rb-open]').click();
 await expect(page.locator('#basketView')).toBeVisible();
 await expect(page.locator('[data-basket-read-text]')).toContainText('합성 본부 토론회');
 expect(f.errors).toEqual([]);
});

test('폰: 참고 묶음 목록 → 상세, 뒤로 가기 한 칸이면 목록으로 390',async({page})=>{
 const f=await fixture(page,{width:390});
 f.links.push({id:'40000000-0000-4000-8000-000000000102',workspace_id:'w',note_id:n,status:'confirmed',summary:null,organization_id:null,project_id:null,bundle_id:b3,meeting_id:null,document_id:null});
 await page.evaluate(()=>window.KPTURouter.go('team'));
 // The list paints again when the organizations arrive; tap the entry once the list is drawn.
 await expect(page.locator(`#soOrganizationList [data-so-org="${o}"]`)).toBeVisible();
 await tap(page,page.locator('#soOrganizationList .so-reference-entry'),390);
 await expect(page.locator('#rbList')).toBeVisible();await expect(page.locator('#rbDetail')).toBeHidden();
 await expect(page.locator(`#rbList [data-rb-bundle="${b3}"] .rb-meta`)).toHaveText('1 · 10.6');
 await expect(page.locator('[data-mobile-view-name]')).toHaveText('참고 묶음');
 await tap(page,page.locator(`#rbList [data-rb-bundle="${b3}"]`),390);
 await expect(page.locator('#rbDetail')).toBeVisible();await expect(page.locator('#rbList')).toBeHidden();
 await expect(page.locator('#rbDetail .rb-line')).toHaveText(RAW);
 expect(await noWideScroll(page)).toBe(true);
 await page.goBack();
 await expect(page.locator('#rbList')).toBeVisible();await expect(page.locator('#rbDetail')).toBeHidden();
 await expect(page.locator('#referenceView')).toBeVisible();
 // 같은 이름은 DB가 거절(409) → 쉬운 말.
 await tap(page,page.locator('#rbList [data-rb-list-more]'),390);await tap(page,page.locator('#rbMenu [data-rb-act="add"]'),390);
 await page.locator('#rbList [data-rb-add-input]').fill('합성 노조 전체');
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_reference_bundles',r=>r.request().method()==='POST'?r.fulfill({status:409,json:{code:'23505'}}):r.fallback());
 await tap(page,page.locator('#rbList [data-rb-add-save]'),390);
 await expect(page.locator('#rbList [data-rb-status]')).toHaveText('같은 이름의 묶음이 이미 있어요. 다른 이름을 써 주세요.');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`홈 [업데이트 ▾] 기록할 곳 시트: 맨 아래 참고 덩어리, 참고만 고르면 정리함 업데이트 + 참고 연결 ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 const posted=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataJSON();posted.push(body);return r.fulfill({status:201,json:[{id:'10000000-0000-4000-8000-0000000000b1',workspace_id:'w',kind:'basket',occurred_at:stamp,created_at:stamp,updated_at:stamp,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body}]});});
 await page.evaluate(()=>window.KPTURouter.go('home'));
 const quick=page.locator('#homeView [data-home-quick]');
 await tap(page,quick.locator('[data-quick-mode="update"]'),width);await tap(page,quick.locator('[data-quick-org]'),width);
 const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();
 const labels=await sheet.locator('.home-choice-label').allTextContents();
 expect(labels.at(-1)).toBe('참고');
 await expect(sheet.locator('[data-sheet-refs] [data-sheet-value]')).toHaveText(['합성 노조 전체','합성 본부 사업','합성 기타 조직']);
 if(width>=761){
  // PC 두 열 창: 참고는 프로젝트 열 아래(프로젝트가 없으면 따로 한 열).
  await expect(sheet.locator('[data-sheet-col] [data-sheet-refs]')).toHaveCount(1);
 }
 await tap(page,sheet.locator(`[data-sheet-value="reference:${b3}"]`),width);
 await expect(sheet.locator(`[data-sheet-value="reference:${b3}"]`)).toHaveAttribute('aria-pressed','true');
 await tap(page,sheet.getByRole('button',{name:'저장',exact:true}),width);await expect(sheet).toBeHidden();
 await expect(quick.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 합성 기타 조직');
 await quick.locator('[data-quick-input]').fill('합성 다른 조직 소식');
 await tap(page,quick.locator('.home-quick-save'),width);
 await expect(page.locator('#toast')).toHaveText('기록을 저장했습니다.');
 expect(posted).toHaveLength(1);expect(posted[0].raw_text).toBe('합성 다른 조직 소식');
 expect(f.calls.at(-1).p_targets).toEqual([{kind:'reference',target_id:b3,reason:'직접 연결'}]);
 expect(f.errors).toEqual([]);
});
