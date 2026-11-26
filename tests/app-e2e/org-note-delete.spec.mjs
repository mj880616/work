import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
import {noteTrash} from './helpers/note-trash.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
// ORG-연결노트삭제(2026-11-12)는 노트 연결 줄 ⋯에 [원문 삭제](노트를 휴지통으로)를 두었다. S71-71 RECORD-기록하나로(사용자 결정 2026-11-26
// "업데이트고 잊지말기고 원문이고 뭐고 없어 걍 메뉴도 다 통일"): 노트에서 연결된 기록 줄도 ⋯ = [수정][메모][삭제]이고, [삭제]는 그 기록(연결 줄)만
// 지운다('이 기록을 삭제할까요?' · '기록을 삭제했어요 · 되돌리기'). 노트는 휴지통에 가지 않고 그대로다. 이름·글은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z';
const SHOTS=process.env.S61_18_SHOTS?'docs/design/screens/s61-18/':'';
const update={id:'20000000-0000-4000-8000-0000000000aa',workspace_id:'w',kind:'basket',title:null,occurred_at:stamp,updated_at:stamp,created_at:stamp,raw_text:'합성 업데이트 원문',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
const note={id:'20000000-0000-4000-8000-0000000000bb',workspace_id:'w',kind:'note',title:'합성 회의 준비 노트',occurred_at:'2026-09-16T01:00:00Z',updated_at:'2026-09-16T01:00:00Z',created_at:'2026-09-16T01:00:00Z',raw_text:'합성 노트 본문 첫 줄',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
const spaces=[{id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,metadata:{project_system:'v2',color:'green'}}];

async function fixture(page,{width}){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const notes=[update,{...note}],state={deletes:[],writes:[],posts:[],errors,notes,
  links:[
   {id:'l-up',workspace_id:'w',note_id:update.id,project_id:null,organization_id:'o',status:'confirmed',summary:'합성 업데이트 연결 요약'},
   {id:'l-note',workspace_id:'w',note_id:note.id,project_id:'pa',organization_id:null,status:'confirmed',summary:null},
   {id:'l-note-o',workspace_id:'w',note_id:note.id,project_id:null,organization_id:'o',status:'confirmed',summary:null}
  ]};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_spaces**',route=>{const q=new URL(route.request().url()).searchParams;if(route.request().method()!=='GET')return route.fulfill({json:[]});if(q.get('select')?.includes('milestones:'))return route.fulfill({json:spaces.map(x=>({id:x.id,milestones:[]}))});return route.fulfill({json:spaces})});
 await page.route(SB+'/rest/v1/app_project_progress_updates**',route=>route.fulfill({json:[]}));
 // 휴지통 함수 흉내는 기본 응답 뒤에 깐다(나중 것이 먼저).
 const trash=await noteTrash(page,SB);state.trash=trash;
 await page.route(SB+'/rest/v1/app_notes**',route=>{const req=route.request(),q=new URL(req.url()).searchParams,k=q.get('kind'),id=q.get('id');
  if(req.method()==='DELETE'){const target=id?.slice(3);state.deletes.push(Object.fromEntries(q));const i=notes.findIndex(n=>n.id===target);
   // 삭제 가로채기 흉내: 노트는 휴지통으로(RLS가 숨김), 연결 행은 그대로 남고, 응답에는 지운 행이 없다.
   if(i>=0){const [gone]=notes.splice(i,1);trash.take(gone,state.links.filter(l=>l.note_id===gone.id).length);trash.onRestore=back=>{notes.push({...gone})}}
   return route.fulfill({json:[]})}
  if(req.method()!=='GET'){state.writes.push(req.method()+' '+req.url());return route.fulfill({json:[]})}
  let rows=notes;if(k?.startsWith('eq.'))rows=rows.filter(x=>x.kind===k.slice(3));if(id?.startsWith('eq.'))rows=rows.filter(x=>x.id===id.slice(3));return list(route,rows)});
 await page.route(SB+'/rest/v1/app_record_links**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;if(req.method()!=='GET'){state.writes.push(req.method()+' '+req.url());if(req.method()==='DELETE'){const id=(q.get('id')||'').slice(3),i=state.links.findIndex(l=>l.id===id);return route.fulfill({json:i<0?[]:state.links.splice(i,1).map(l=>({id:l.id}))})}return route.fulfill({json:[]})}
  if(q.has('google_task_id'))return route.fulfill({json:[]});
  const kinds=(q.get('note.kind')||'').replace(/^eq\./,'').replace(/^in\.\(|\)$/g,'').split(',').filter(Boolean);
  // app_notes!inner: 휴지통에 간 노트(목록에 없음)의 연결 줄은 오지 않는다.
  let rows=state.links.map(row=>({...row,note:notes.find(n=>n.id===row.note_id)}));
  if(q.get('select')?.includes('note:app_notes!inner'))rows=rows.filter(r=>r.note);
  if(kinds.length)rows=rows.filter(r=>r.note&&kinds.includes(r.note.kind));
  for(const key of ['project_id','organization_id']){const v=q.get(key);if(v?.startsWith('in.('))rows=rows.filter(x=>v.slice(4,-1).split(',').includes(x[key]))}
  const v=q.get('note_id');if(v?.startsWith('eq.'))rows=rows.filter(x=>x.note_id===v.slice(3));
  return list(route,rows.map(row=>({...row,organization:{name:'테스트 조직'},project:{name:'합성 정책 사업'}})));
 });
 await page.route(SB+'/functions/v1/basket-files?action=note-delete',route=>{state.posts.push(route.request().postData());return route.fulfill({status:500,json:{}})});
 return state;
}
test.use({hasTouch:true}); // 폰 폭은 손가락 누르기(tap)로 연다.
const press=(locator,width)=>width<761?locator.tap():locator.click();
const linkDeletes=f=>f.writes.filter(w=>w.startsWith('DELETE ')&&w.includes('/app_record_links'));

for(const width of [1280,412])test(`organization ${width}: a note line's ⋯ is [수정][메모][삭제]; [삭제] removes only that record and the note stays`,async({page})=>{
 const f=await fixture(page,{width});
 await clickView(page,'team');await page.locator('[data-ps-workplace-org="o"]').first().click();
 const modal=page.locator('#wdModal'),row=modal.locator('[data-basket-link="l-note-o"]');await expect(row).toBeVisible();
 await expect(row.locator('a,[data-record-mark]')).toHaveCount(0);await expect(row).not.toContainText('노트 연결');
 const menu=page.locator('#basketLinkMenu');
 for(const id of ['l-up','l-note-o']){await press(modal.locator(`[data-basket-link="${id}"] [data-basket-link-menu]`),width);await expect(menu.getByRole('button')).toHaveText([/^수정$/,/^메모( \d+)?$/,/^삭제$/]);await page.keyboard.press('Escape');await expect(menu).toBeHidden();}
 await press(row.locator('[data-basket-link-menu]'),width);const del=menu.getByRole('button',{name:'삭제',exact:true});await expect(del).toHaveClass(/basket-link-danger/);
 await press(del,width);expect(await answerAsk(page,false)).toBe('이 기록을 삭제할까요?');await expect(row).toBeVisible();
 await press(row.locator('[data-basket-link-menu]'),width);await press(menu.getByRole('button',{name:'삭제',exact:true}),width);expect(await answerAsk(page,true)).toBe('이 기록을 삭제할까요?');
 await expect(page.locator('[data-undo-notice]')).toContainText('기록을 삭제했어요.');
 await expect.poll(()=>linkDeletes(f).length).toBe(1);expect(linkDeletes(f)[0]).toContain('id=eq.l-note-o');
 expect(f.deletes).toEqual([]);expect(f.posts).toEqual([]);expect(f.trash.trash).toEqual([]);expect(f.notes.some(n=>n.id===note.id)).toBe(true);
 expect(f.errors).toEqual([]);
});

for(const width of [1280,412])test(`project ${width}: a note record's ⋯ is [수정][메모][삭제] and never opens or deletes the note`,async({page})=>{
 const f=await fixture(page,{width});
 await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업',{contains:true});
 const records=page.locator('#ps3-progress [data-ps3-records]'),row=records.locator('[data-basket-link="l-note"]'),menu=page.locator('#ps3RecordMenu');
 await expect(row).toBeVisible();await expect(row.locator('a,[data-record-mark]')).toHaveCount(0);
 await press(row.locator('[data-ps3-record-menu]'),width);await expect(menu.getByRole('button')).toHaveText([/^수정$/,/^메모( \d+)?$/,/^삭제$/]);
 await expect(menu.getByRole('button',{name:'삭제',exact:true})).toHaveClass(/ps3-record-danger/);await page.keyboard.press('Escape');
 const view=await page.evaluate(()=>window.KPTURouter.current);await row.locator('.ps3-rec-text').click();await page.waitForTimeout(150);expect(await page.evaluate(()=>window.KPTURouter.current)).toBe(view);await expect(page.locator('#kptuRecordSheet:not(.hidden)')).toHaveCount(0);
 expect(f.deletes).toEqual([]);expect(f.posts).toEqual([]);expect(f.errors).toEqual([]);
});
