import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
import {noteTrash} from './helpers/note-trash.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
// ORG-연결노트삭제(2026-11-12 명진 지시): 조직 창·사업영역 상세 기록 목록의 노트 연결 줄 ⋯에 업데이트와 같은 [원문 삭제](맨 아래, 위험 색).
// 누르면 한 번 묻고('노트를 삭제할까요? 휴지통으로 가요. 이 기록 줄도 빠져요' + 다른 곳 n군데), 노트 화면 [삭제]와 같은 휴지통 길
// (owner-RLS DELETE 한 번 → 서버 가로채기가 휴지통 표시)로 보낸 뒤 '노트를 지웠어요 · 되돌리기'. 되돌리면 노트와 기록 줄이 다시 보인다.
// 예전 basket-files note-delete 서버 길은 쓰지 않는다. 이름·글은 모두 합성 값이다.
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
  const req=route.request(),q=new URL(req.url()).searchParams;if(req.method()!=='GET'){state.writes.push(req.method()+' '+req.url());return route.fulfill({json:[]})}
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
const CONFIRM='노트를 삭제할까요?\n휴지통으로 가요. 이 기록 줄도 빠져요.\n다른 곳 1군데에도 연결돼 있어요.';
test.use({hasTouch:true}); // 폰 폭은 손가락 누르기(tap)로 연다.
const press=(locator,width)=>width<761?locator.tap():locator.click();

for(const width of [1280,412])test(`organization ${width}: a note line's ⋯ [원문 삭제] asks once, sends the note to the trash, and undo brings the note and the line back`,async({page})=>{
 const f=await fixture(page,{width});
 await clickView(page,'team');await page.locator('[data-ps-workplace-org="o"]').first().click();
 const modal=page.locator('#wdModal'),row=modal.locator('[data-basket-link="l-note-o"]');await expect(row).toBeVisible();
 const menu=page.locator('#basketLinkMenu');
 // The update line keeps its menu; the note line now has the same [원문 삭제] at the bottom, in the danger color.
 await press(modal.locator('[data-basket-link="l-up"] [data-basket-link-menu]'),width);await expect(menu.getByRole('button')).toHaveText(['업데이트 열기','연결 해제','요약 수정','원문 삭제']);await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await press(row.locator('[data-basket-link-menu]'),width);await expect(menu.getByRole('button')).toHaveText(['노트 열기','연결 해제','요약 수정','원문 삭제']);
 const del=menu.getByRole('button',{name:'원문 삭제',exact:true});await expect(del).toHaveClass(/basket-link-danger/);
 if(SHOTS)await page.screenshot({path:`${SHOTS}org-note-menu-${width}.png`});
 // Cancel sends nothing and keeps the line.
 await press(del,width);expect(await answerAsk(page,false)).toBe(CONFIRM);
 await expect(row).toBeVisible();expect(f.deletes).toEqual([]);
 await press(row.locator('[data-basket-link-menu]'),width);await press(menu.getByRole('button',{name:'원문 삭제',exact:true}),width);
 const ask=page.locator('.kptu-ask');await ask.waitFor({state:'visible'});if(SHOTS)await page.screenshot({path:`${SHOTS}org-note-ask-${width}.png`});
 expect(await answerAsk(page,true)).toBe(CONFIRM);
 await expect(row).toHaveCount(0);await expect(modal.locator('[data-basket-link="l-up"]')).toBeVisible();
 const notice=page.locator('[data-undo-notice]');await expect(notice).toContainText('노트를 지웠어요.');await expect(notice.getByRole('button',{name:'되돌리기'})).toBeVisible();
 if(SHOTS)await page.screenshot({path:`${SHOTS}org-note-deleted-${width}.png`});
 // The same server path as the note screen: one owner-RLS DELETE of this note in this workspace, never the old note-delete function.
 expect(f.deletes).toEqual([{id:'eq.'+note.id,workspace_id:'eq.w',select:'id'}]);expect(f.posts).toEqual([]);expect(f.trash.trash.map(n=>n.id)).toEqual([note.id]);
 await notice.getByRole('button',{name:'되돌리기'}).click();await expect(notice).toContainText('되돌렸습니다.');
 expect(f.trash.rpc.filter(r=>r.fn==='app_trash_restore')).toEqual([{fn:'app_trash_restore',kind:'note',id:note.id}]);
 await expect(modal.locator('[data-basket-link="l-note-o"]')).toBeVisible();
 expect(f.writes).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(f.errors).toEqual([]);
});

for(const width of [1280,412])test(`project ${width}: a note record's ⋯ [원문 삭제] uses the same trash path and undo`,async({page})=>{
 const f=await fixture(page,{width});
 await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="pa"]').click();
 await expectProjectTitle(page,'합성 정책 사업');
 const records=page.locator('#ps3-progress [data-ps3-records]'),row=records.locator('[data-basket-link="l-note"]'),menu=page.locator('#ps3RecordMenu');
 await expect(row).toBeVisible();await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('1');
 await press(row.locator('[data-ps3-record-menu]'),width);await expect(menu.getByRole('button')).toHaveText(['노트 열기','연결 해제','요약 수정','원문 삭제']);
 await expect(menu.getByRole('button',{name:'원문 삭제',exact:true})).toHaveClass(/ps3-record-danger/);
 if(SHOTS)await page.screenshot({path:`${SHOTS}project-note-menu-${width}.png`});
 await press(menu.getByRole('button',{name:'원문 삭제',exact:true}),width);expect(await answerAsk(page,true)).toBe(CONFIRM);
 await expect(row).toHaveCount(0);await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('0');
 const notice=page.locator('[data-undo-notice]');await expect(notice).toContainText('노트를 지웠어요.');
 expect(f.deletes).toEqual([{id:'eq.'+note.id,workspace_id:'eq.w',select:'id'}]);expect(f.posts).toEqual([]);
 await notice.getByRole('button',{name:'되돌리기'}).click();await expect(notice).toContainText('되돌렸습니다.');
 await expect(records.locator('[data-basket-link="l-note"]')).toBeVisible();await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('1');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
