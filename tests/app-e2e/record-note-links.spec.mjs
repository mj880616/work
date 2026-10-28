import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// UI-모바일업데이트겹쳐보기: on a phone a tapped record first comes up as a card over the detail; its full-open button continues as before.
const viaSheet=async page=>{if((page.viewportSize()?.width||0)>760)return;const sheet=page.locator('#kptuRecordSheet');await expect(sheet).toBeVisible();await sheet.locator('[data-record-sheet-full]').click()};
// UI-기록아이콘(2026-10-18 명진 결정): 노트를 [연결하기]로 이은 조직·프로젝트 화면의 기록 목록에 노트도 보인다. 기록 줄 앞 표시는 새 업데이트 아이콘·노트
// 아이콘으로 구분하고 🧺는 없앤다. 노트 줄을 누르면 노트 읽기 화면, "← (이름)으로 돌아가기"·뒤로 가기는 #831 규칙대로 같은 프로젝트·조직으로.
// DB 변경 없음: 같은 확정 연결(app_record_links, app_basket_confirm_links로 만든 것)을 노트 종류까지 함께 읽는다. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z';
const update={id:'10000000-0000-4000-8000-0000000000aa',workspace_id:'w',kind:'basket',title:null,occurred_at:stamp,updated_at:stamp,created_at:stamp,raw_text:'합성 업데이트 원문',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
const note={id:'10000000-0000-4000-8000-0000000000bb',workspace_id:'w',kind:'note',title:'합성 회의 준비 노트',occurred_at:'2026-09-16T01:00:00Z',updated_at:'2026-09-16T01:00:00Z',created_at:'2026-09-16T01:00:00Z',raw_text:'합성 노트 본문 첫 줄',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
const spaces=[
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,metadata:{project_system:'v2',color:'green'}},
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,metadata:{project_system:'v2',color:'blue'}}
];
const day=i=>`2026-09-${String(30-i).padStart(2,'0')}`;
async function fixture(page,{width=1280}={}){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const notes=[update,note],state={writes:[],queries:[],progress:Array.from({length:24},(_,i)=>({id:'pr-'+i,project_id:'pa',workstream_id:null,summary:'합성 기록 '+i,effective_on:day(i),created_at:day(i)+'T00:00:00Z'})),
  links:[
   {id:'l-up',workspace_id:'w',note_id:update.id,project_id:'pa',organization_id:null,status:'confirmed',summary:'합성 업데이트 연결 요약'},
   {id:'l-note',workspace_id:'w',note_id:note.id,project_id:'pa',organization_id:null,status:'confirmed',summary:null},
   {id:'l-note-o',workspace_id:'w',note_id:note.id,project_id:null,organization_id:'o',status:'confirmed',summary:null}
  ]};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_spaces**',route=>{const q=new URL(route.request().url()).searchParams;if(route.request().method()!=='GET'){state.writes.push(route.request().url());return route.fulfill({json:[]})}if(q.get('select')?.includes('milestones:'))return route.fulfill({json:spaces.map(x=>({id:x.id,milestones:[]}))});return route.fulfill({json:spaces})});
 await page.route(SB+'/rest/v1/app_project_progress_updates**',route=>{const pid=new URL(route.request().url()).searchParams.get('project_id')?.slice(3);return list(route,state.progress.filter(x=>x.project_id===pid))});
 await page.route(SB+'/rest/v1/app_notes**',route=>{const q=new URL(route.request().url()).searchParams,k=q.get('kind'),id=q.get('id');let rows=notes;if(k?.startsWith('eq.'))rows=rows.filter(x=>x.kind===k.slice(3));if(id?.startsWith('eq.'))rows=rows.filter(x=>x.id===id.slice(3));return list(route,rows)});
 await page.route(SB+'/rest/v1/app_record_links**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;if(req.method()!=='GET'){state.writes.push(req.method()+' '+req.url());return route.fulfill({json:[]})}
  if(q.has('google_task_id'))return route.fulfill({json:[]});
  state.queries.push(q.get('note.kind'));
  const kinds=(q.get('note.kind')||'').replace(/^eq\./,'').replace(/^in\.\(|\)$/g,'').split(',').filter(Boolean);
  let rows=state.links.map(row=>({...row,note:notes.find(n=>n.id===row.note_id)}));if(kinds.length)rows=rows.filter(r=>kinds.includes(r.note.kind));
  for(const key of ['project_id','organization_id']){const v=q.get(key);if(v?.startsWith('in.('))rows=rows.filter(x=>v.slice(4,-1).split(',').includes(x[key]))}
  const v=q.get('note_id');if(v?.startsWith('eq.'))rows=rows.filter(x=>x.note_id===v.slice(3));
  return list(route,rows.map(row=>({...row,organization:{name:'테스트 조직'},project:{name:'합성 정책 사업'}})));
 });
 return {state,errors};
}
const top=locator=>locator.evaluate(el=>Math.round(el.getBoundingClientRect().top));
async function browserBack(page){const c=await page.context().newCDPSession(page);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,x:1,y:1,button:'back',clickCount:1});await c.detach()}
const goBack=(page,how)=>how==='browser'?browserBack(page):page.goBack();
async function scrollToRecord(page,locator){
 await locator.evaluate(el=>{let n=el.parentElement;while(n&&!(n.scrollHeight>n.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(n).overflowY)))n=n.parentElement;(n||document.scrollingElement).scrollTop+=el.getBoundingClientRect().top-300});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));return top(locator);
}
// UI-상단줄제목: on a PC (1024px~) the open note's title is in the top line's place; below that, in the note's head.
const noteRead=page=>(page.viewportSize()?.width||0)>=1024?page.locator('[data-topline-where] [aria-current="page"]'):page.locator('#basketView [data-note-read-title]');

for(const width of [1280,390])test(`project ${width}: a linked note joins the record list with the note icon; the update has the update icon and no 🧺 is left`,async({page})=>{
 const {state,errors}=await fixture(page,{width});
 await clickView(page,'projects');if(width<761)await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업');
 const records=page.locator('#ps3-progress [data-ps3-records]'),up=records.locator('[data-basket-link="l-up"]'),nt=records.locator('[data-basket-link="l-note"]');
 await expect(nt).toBeVisible();await expect(up).toBeVisible();
 await expect(up.getByRole('img',{name:'정리함 업데이트'})).toBeVisible();await expect(up.locator('[data-record-mark="update"] svg')).toHaveCount(1);
 await expect(nt.getByRole('img',{name:'노트'})).toBeVisible();await expect(nt.locator('[data-record-mark="note"] svg')).toHaveCount(1);
 // A note without a link summary shows its title.
 await expect(nt.locator('.ps3-rec-text')).toHaveText('합성 회의 준비 노트');await expect(up.locator('.ps3-rec-text')).toHaveText('합성 업데이트 연결 요약');
 await expect(page.locator('#ps3Body')).not.toContainText('🧺');
 // Newest first: the note (9.16) above the update (9.15), both counted.
 const order=await records.locator(':scope > [data-basket-link]').evaluateAll(xs=>xs.map(x=>x.dataset.basketLink));expect(order).toEqual(['l-note','l-up']);
 await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('26');
 // Its ⋯: [노트 열기]·[연결 해제]·[요약 수정]; the update's ⋯ is [업데이트 열기]·[연결 해제]·[요약 수정] (UI-연결요약수정).
 await nt.getByRole('button',{name:'정리함 기록 메뉴'}).click();const menu=page.locator('#ps3RecordMenu');await expect(menu.getByRole('button')).toHaveText(['노트 열기','연결 해제','요약 수정']);await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await up.getByRole('button',{name:'정리함 기록 메뉴'}).click();await expect(menu.getByRole('button')).toHaveText(['업데이트 열기','연결 해제','요약 수정']);await page.keyboard.press('Escape');
 // The same link read asks for both kinds, nothing is written.
 expect(state.queries).toContain('in.(basket,note)');expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

for(const width of [1280,390])test(`project ${width}: a note line opens the note's read view with the return line; the button and back return to the same project and scroll`,async({page})=>{
 const {errors}=await fixture(page,{width});
 await clickView(page,'projects');if(width<761)await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업');
 const line=page.locator('#ps3Body [data-basket-link="l-note"] a[data-ps3-basket-note]');
 const before=await scrollToRecord(page,line);
 for(const how of ['button','back','browser']){
  await line.click();await viaSheet(page);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(noteRead(page)).toHaveText('합성 회의 준비 노트');
  await expect(page.locator('#basketView [data-basket-text]').first()).toBeHidden();
  const back=page.locator('#basketView [data-basket-return]');await expect(back).toHaveText(width<761?'← 사업영역으로 돌아가기':'← 합성 정책 사업으로 돌아가기');
  if(how==='button')await back.click();else await goBack(page,how);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('projects');await expectProjectTitle(page,'합성 정책 사업');
  await expect(page.locator('#ps3DetailModal')).toBeVisible();await expect.poll(()=>top(line)).toBe(before);
 }
 // The ⋯ [노트 열기] opens the same note.
 await page.locator('#ps3Body [data-basket-link="l-note"] [data-ps3-record-menu]').click();await page.locator('#ps3RecordMenu').getByRole('button',{name:'노트 열기'}).click();
 await expect(noteRead(page)).toHaveText('합성 회의 준비 노트');await page.locator('#basketView [data-basket-return]').click();await expectProjectTitle(page,'합성 정책 사업');if(width<761){await page.locator('[data-ps3-close="ps3DetailModal"]').click();await expect(page.locator('#ps3DetailModal')).toBeHidden()}
 // A note opened from the note list itself has no return line and its back stays the note list.
 await clickView(page,'basket');await chooseBasketKind(page,'note');await page.locator(`[data-note-row="${note.id}"]`).click();
 await expect(noteRead(page)).toHaveText('합성 회의 준비 노트');await expect(page.locator('#basketView [data-basket-return]')).toHaveCount(0);
 await page.goBack();await expect(page.locator('#basketView [data-note-detail]')).toBeHidden();await expect(page.locator(`[data-note-row="${note.id}"]`)).toBeVisible();
 expect(await page.evaluate(()=>KPTURouter.current)).toBe('basket');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`organization ${width}: the linked note shows with the note icon, opens the note and returns to the same organization`,async({page})=>{
 const {state,errors}=await fixture(page,{width});
 await clickView(page,'team');await page.locator('[data-ps-workplace-org="o"]').first().click();
 const modal=page.locator('#wdModal'),row=modal.locator('[data-basket-link="l-note-o"]'),line=row.locator('a[data-basket-link-open]');await expect(line).toBeVisible();
 await expect(row.getByRole('img',{name:'노트'})).toBeVisible();await expect(row.locator('small')).toContainText('노트 연결');await expect(row.locator('[data-link-summary-text]')).toHaveText('합성 회의 준비 노트');
 await expect(modal).not.toContainText('🧺');
 await row.locator('[data-basket-link-menu]').click();const menu=page.locator('#basketLinkMenu');await expect(menu.getByRole('button')).toHaveText(['노트 열기','연결 해제','요약 수정']);await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 const before=await top(line);
 for(const how of ['button','back','browser']){
  await line.click();await viaSheet(page);await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(noteRead(page)).toHaveText('합성 회의 준비 노트');
  await expect(page.locator('#basketView [data-basket-return]')).toHaveText(width<761?'← 담당조직으로 돌아가기':'← 테스트 조직으로 돌아가기');
  if(how==='button')await page.locator('#basketView [data-basket-return]').click();else await goBack(page,how);
  await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe('team');await expect(modal).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
  await expect.poll(()=>top(line)).toBe(before);
 }
 expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

// BUG-미리보기기호: project record lines (a linked update's summary, a progress record) show plain letters, no ###·|·**·entity leftovers.
for(const width of [1280,390])test(`project ${width}: record lines show plain letters without markdown marks`,async({page})=>{
 const {state,errors}=await fixture(page,{width});
 state.links[0].summary='### 합성 결과 | 일시 | 장소 |\n|---|---|\n| 2026\\.&#x20;10\\.&#x20;21\\. | **합성 본사** |';
 state.progress[0].summary='## 합성 진행 | 항목 | **굵게**';
 await clickView(page,'projects');if(width<761)await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업');
 const up=page.locator('#ps3-progress [data-ps3-records] [data-basket-link="l-up"] .ps3-rec-text');
 await expect(up).toContainText('합성 결과 · 일시 · 장소 2026. 10. 21. · 합성 본사');
 expect((await up.textContent())||'').not.toMatch(/###|\||\*\*|&#x20;|\\\./);
 const progress=page.locator('#ps3-progress .ps3-rec-summary').first();
 await expect(progress).toHaveText('합성 진행 · 항목 · 굵게');
 expect(errors).toEqual([]);
});
