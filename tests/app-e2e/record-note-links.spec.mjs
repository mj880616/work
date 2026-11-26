import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// UI-모바일업데이트겹쳐보기: on a phone a tapped record first comes up as a card over the detail; its full-open button continues as before.
const viaSheet=async page=>{if((page.viewportSize()?.width||0)>760)return;const sheet=page.locator('#kptuRecordSheet');await expect(sheet).toBeVisible();await sheet.locator('[data-record-sheet-full]').click()};
// UI-기록아이콘(2026-10-18 명진 결정): 노트를 [연결하기]로 이은 조직·프로젝트 화면의 기록 목록에 노트도 보인다. 기록 줄 앞 표시는 새 업데이트 아이콘·노트
// 아이콘으로 구분하고 🧺는 없앤다. 노트 줄을 누르면 노트 읽기 화면, 머리 줄 "‹ (이름)"·뒤로 가기는 #831 규칙대로 같은 프로젝트·조직으로.
// DB 변경 없음: 같은 확정 연결(app_record_links, app_basket_confirm_links로 만든 것)을 노트 종류까지 함께 읽는다. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z';
const update={id:'10000000-0000-4000-8000-0000000000aa',workspace_id:'w',kind:'basket',title:null,occurred_at:stamp,updated_at:stamp,created_at:stamp,raw_text:'합성 업데이트 원문',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
const note={id:'10000000-0000-4000-8000-0000000000bb',workspace_id:'w',kind:'note',title:'합성 회의 준비 노트',occurred_at:'2026-09-16T01:00:00Z',updated_at:'2026-09-16T01:00:00Z',created_at:'2026-09-16T01:00:00Z',raw_text:'합성 노트 본문 첫 줄',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
const spaces=[
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,metadata:{project_system:'v2',color:'green'}},
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,metadata:{project_system:'v2',color:'blue'}}
];
const day=i=>`2026-09-${String(30-i).padStart(2,'0')}`;
// MTG-프로젝트합치기 결정 ⑥: 프로젝트 기록 목록에는 정리함 연결 줄만 그려진다(state.progress는 읽어 와도 그리지 않는다).
// fill>0이면 날짜가 다른 합성 업데이트 연결을 그만큼 더해, 목록이 길어 스크롤 위치를 볼 수 있게 한다.
async function fixture(page,{width=1280,fill=0}={}){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const fillers=Array.from({length:fill},(_,i)=>({...update,id:`10000000-0000-4000-8000-1000000000${String(i).padStart(2,'0')}`,occurred_at:day(i)+'T00:00:00Z',raw_text:'합성 채움 원문 '+i}));
 const notes=[update,note,...fillers],state={writes:[],queries:[],progress:Array.from({length:24},(_,i)=>({id:'pr-'+i,project_id:'pa',workstream_id:null,summary:'합성 기록 '+i,effective_on:day(i),created_at:day(i)+'T00:00:00Z'})),
  links:[
   {id:'l-up',workspace_id:'w',note_id:update.id,project_id:'pa',organization_id:null,status:'confirmed',summary:'합성 업데이트 연결 요약'},
   {id:'l-note',workspace_id:'w',note_id:note.id,project_id:'pa',organization_id:null,status:'confirmed',summary:null},
   {id:'l-note-o',workspace_id:'w',note_id:note.id,project_id:null,organization_id:'o',status:'confirmed',summary:null},
   ...fillers.map((n,i)=>({id:'l-fill-'+i,workspace_id:'w',note_id:n.id,project_id:'pa',organization_id:null,status:'confirmed',summary:'합성 채움 연결 '+i}))
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
const noteRead=page=>(page.viewportSize()?.width||0)>=761?page.locator('[data-topline-where] [aria-current="page"]'):page.locator('#basketView [data-note-read-title]');

for(const width of [1280,390])test(`project ${width}: a linked note joins the record list as a plain record (no icon, no link) and no 🧺 is left`,async({page})=>{
 const {state,errors}=await fixture(page,{width});
 await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업');
 const records=page.locator('#ps3-progress [data-ps3-records]'),up=records.locator('[data-basket-link="l-up"]'),nt=records.locator('[data-basket-link="l-note"]');
 await expect(nt).toBeVisible();await expect(up).toBeVisible();
 await expect(up.locator('[data-record-mark]')).toHaveCount(0);await expect(up.locator('a')).toHaveCount(0); // S71-57: 잊지 말기에서 온 기록은 표시·링크 없음
 await expect(nt.locator('[data-record-mark]')).toHaveCount(0);await expect(nt.locator('a')).toHaveCount(0); // S71-71: 노트에서 온 기록도 표시·링크 없음
 // A note without a link summary shows its title.
 await expect(nt.locator('.ps3-rec-text')).toHaveText('합성 회의 준비 노트');await expect(up.locator('.ps3-rec-text')).toHaveText('합성 업데이트 연결 요약');
 await expect(page.locator('#ps3Body')).not.toContainText('🧺');
 // Newest first: the note (9.16) above the update (9.15), both counted. The 24 old progress records are not drawn (결정 ⑥).
 const order=await records.locator(':scope > [data-basket-link]').evaluateAll(xs=>xs.map(x=>x.dataset.basketLink));expect(order).toEqual(['l-note','l-up']);
 await expect(records.locator(':scope > *')).toHaveCount(2);await expect(records.locator('[data-ps3-record]')).toHaveCount(0);
 await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('2');
 // S71-71 RECORD-기록하나로: the note line and the update line have the same ⋯ [수정][메모][삭제].
 await nt.getByRole('button',{name:'기록 메뉴',exact:true}).click();const menu=page.locator('#ps3RecordMenu');await expect(menu.getByRole('button')).toHaveText([/^수정$/,/^메모( \d+)?$/,/^삭제$/]);await page.keyboard.press('Escape');
 await up.getByRole('button',{name:'기록 메뉴',exact:true}).click();await expect(menu.getByRole('button')).toHaveText([/^수정$/,/^메모( \d+)?$/,/^삭제$/]);await page.keyboard.press('Escape');
 // The same link read asks for both kinds, nothing is written.
 expect(state.queries).toContain('in.(basket,note)');expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});



// BUG-미리보기기호: project record lines (a linked update's summary) show plain letters, no ###·|·**·entity leftovers.
// MTG-프로젝트합치기 결정 ⑥: 옛 진행 기록 줄은 그리지 않으므로 그 글은 화면에 없다.
for(const width of [1280,390])test(`project ${width}: record lines show plain letters without markdown marks`,async({page})=>{
 const {state,errors}=await fixture(page,{width});
 state.links[0].summary='### 합성 결과 | 일시 | 장소 |\n|---|---|\n| 2026\\.&#x20;10\\.&#x20;21\\. | **합성 본사** |';
 state.progress[0].summary='## 합성 진행 | 항목 | **굵게**';
 await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업');
 const up=page.locator('#ps3-progress [data-ps3-records] [data-basket-link="l-up"] .ps3-rec-text');
 await expect(up).toContainText('합성 결과 · 일시 · 장소 2026. 10. 21. · 합성 본사');
 expect((await up.textContent())||'').not.toMatch(/###|\||\*\*|&#x20;|\\\./);
 await expect(page.locator('#ps3-progress .ps3-rec-summary,#ps3-progress [data-ps3-record]')).toHaveCount(0);
 await expect(page.locator('#ps3-progress')).not.toContainText('합성 진행');
 expect(errors).toEqual([]);
});
