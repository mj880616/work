import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// BASKET-4b-2: a basket note marked as a write-request candidate (metadata.write_request).
// Web2 never writes the ledger and never calls ChatGPT; the person copies the text.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000003';
const RAW='10/20 기자회견 합의\n장소: 본사 앞\n참석 30명';
async function fixture(page,{metadata={keep:'그대로'},width=1280}={}){
 await page.setViewportSize({width,height:width<761?1100:900});
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 const home=await openHome(page),errors=[],patches=[],reads=[],other=[];
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[],metadata};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 page.on('request',r=>{const u=r.url();if(r.method()!=='GET'&&!u.includes('/rest/v1/app_notes')&&!u.includes('/auth/v1/'))other.push(r.method()+' '+u);});
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 const db={hold:null,abortPatch:false,failReads:false,before:null};
 await page.route(SB+'/rest/v1/app_notes?**',async route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){
   patches.push({query:Object.fromEntries(q),body:req.postDataJSON()});await db.hold;db.before?.(note);
   if(db.abortPatch)return route.abort('timedout');
   const wr=note.metadata?.write_request,first=Array.isArray(note.metadata?.tasks)?note.metadata.tasks[0]?.task_id:null;
   const ok=q.get('updated_at')==='eq.'+note.updated_at
    &&(!q.has('metadata->write_request')||(q.get('metadata->write_request')==='is.null')===(wr==null))
    &&(!q.has('metadata->write_request->>marked_at')||q.get('metadata->write_request->>marked_at')===(wr?.marked_at?'eq.'+wr.marked_at:'is.null'))
    &&q.get('metadata->tasks->0->>task_id')===(first==null?'is.null':'eq.'+first);
   if(!ok)return route.fulfill({json:[]});
   note.metadata=req.postDataJSON().metadata;return route.fulfill({json:[{id:n,updated_at:note.updated_at,metadata:note.metadata}]});
  }
  if(q.get('id')===`eq.${n}`)reads.push(Object.fromEntries(q));
  if(db.failReads&&q.get('id'))return route.abort('failed');
  if(q.get('metadata'))return route.fulfill({json:[]});
  return route.fulfill({json:[note].slice(Number(q.get('offset')||0))});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-filter="all"]').click();
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return {home,note,errors,patches,reads,other,db,detail:page.locator('[data-basket-detail]')};
}
const tap=async(page,locator,width)=>{await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();};
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`mark, copy, hand off and cancel a write-request candidate ${width}`,async({page},info)=>{
 const f=await fixture(page,{width}),{detail}=f;
 const open=detail.locator('[data-basket-write-request-open]');
 await tap(page,open,width);
 // The reason form replaces the read actions until it closes.
 await expect(detail.locator('[data-basket-read-actions]')).toBeHidden();
 const reason=detail.getByLabel('왜 원장에 남길까요?(선택)');await expect(reason).toBeFocused();
 await reason.fill('10/20 기자회견 합의 근거');
 if(width===390)await page.screenshot({path:info.outputPath('write-request-form-390.png'),fullPage:true});
 await tap(page,detail.getByRole('button',{name:'후보로 표시'}),width);
 const box=detail.locator('[data-write-request-box]');
 await expect(box.getByRole('heading')).toHaveText('쓰기요청 후보(미제출)');await expect(box).toContainText('이유: 10/20 기자회견 합의 근거');
 await expect(box.locator('[data-write-request-status]')).toHaveText('쓰기요청 후보로 표시했어요. 원장에는 아직 기록되지 않았어요.');
 // One metadata-only conditional write; other keys kept; the original's version untouched.
 expect(f.patches).toHaveLength(1);expect(Object.keys(f.patches[0].body)).toEqual(['metadata']);
 expect(f.patches[0].query).toMatchObject({id:'eq.'+n,workspace_id:'eq.w',updated_at:'eq.'+stamp,'metadata->write_request':'is.null','metadata->tasks->0->>task_id':'is.null'});
 expect(f.note.metadata).toEqual({keep:'그대로',write_request:{reason:'10/20 기자회견 합의 근거',marked_at:expect.any(String),handed_off_at:null}});
 expect(f.note.updated_at).toBe(stamp);
 await expect(detail.locator('[data-basket-read-actions]')).toBeVisible();await expect(open).toBeHidden();
 await expect(detail.locator('[data-basket-state]')).toContainText('쓰기요청 후보');
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('write-request-box-390.png'),fullPage:true});
 // Copying is not a write and does not mark anything as handed off.
 await tap(page,box.getByRole('button',{name:'ChatGPT에 넘길 글 복사'}),width);
 await expect(box.locator('[data-write-request-status]')).toHaveText('복사했어요. ChatGPT에 붙여 넣은 뒤 [넘겼어요]를 눌러 주세요.');
 const copied=await page.evaluate(()=>navigator.clipboard.readText());
 expect(copied).toContain('[쓰기요청 후보 · 미제출]');expect(copied).toContain('아직 원장에 기록되지 않았어요.');
 expect(copied).toContain('이유: 10/20 기자회견 합의 근거');expect(copied).toContain(RAW);expect(copied).toContain(`?view=basket&note=${n}`);
 expect(copied).not.toMatch(/기록해 ?주세요|써 ?주세요|실행|자동/);
 expect(f.patches).toHaveLength(1);await expect(box.getByRole('heading')).toHaveText('쓰기요청 후보(미제출)');
 // Only the explicit [넘겼어요] records handed_off_at.
 await tap(page,box.getByRole('button',{name:'넘겼어요'}),width);
 await expect(box.getByRole('heading')).toHaveText('쓰기요청 후보(ChatGPT에 넘김)');await expect(box.getByRole('button',{name:'넘겼어요'})).toHaveCount(0);
 expect(f.patches).toHaveLength(2);expect(f.patches[1].query['metadata->write_request->>marked_at']).toBe('eq.'+f.note.metadata.write_request.marked_at);
 expect(f.note.metadata.write_request.handed_off_at).toEqual(expect.any(String));
 if(width===390)await page.screenshot({path:info.outputPath('write-request-handed-390.png'),fullPage:true});
 // The list shows the candidate too.
 await tap(page,detail.getByRole('button',{name:'목록으로'}),width);
 await expect(page.locator(`[data-basket-row="${n}"]`)).toContainText('쓰기요청 후보');
 await tap(page,page.locator(`[data-basket-row="${n}"]`),width);
 page.once('dialog',d=>d.accept());
 await tap(page,detail.locator('[data-write-request-box]').getByRole('button',{name:'후보 취소'}),width);
 await expect(detail.locator('[data-write-request-box]')).toHaveCount(0);await expect(open).toBeVisible();await expect(open).toBeFocused();
 await expect(detail.locator('[data-write-request-status]')).toHaveText('쓰기요청 후보를 취소했어요.');
 expect(f.patches).toHaveLength(3);expect(f.note.metadata).toEqual({keep:'그대로'});
 // Nothing but the note row was written: no RPC, Edge, Drive or AI call.
 expect(f.other).toEqual([]);expect(await noWideScroll(page)).toBe(true);expect(f.errors).toEqual([]);
});

test('an empty reason is allowed, and editing hides the candidate box',async({page})=>{
 const f=await fixture(page),{detail}=f;
 await detail.locator('[data-basket-write-request-open]').click();await detail.getByRole('button',{name:'후보로 표시'}).click();
 await expect(detail.locator('[data-write-request-box]')).toContainText('이유: 적지 않음');expect(f.note.metadata.write_request.reason).toBe('');
 await detail.getByRole('button',{name:'수정',exact:true}).click();await expect(detail.locator('[data-write-request-box]')).toBeHidden();
 await detail.getByRole('button',{name:'취소',exact:true}).click();await expect(detail.locator('[data-write-request-box]')).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('a candidate marked elsewhere first is reported once as already marked',async({page})=>{
 const f=await fixture(page),{detail}=f;
 f.db.before=note=>{if(!note.metadata.write_request)note.metadata={...note.metadata,write_request:{reason:'다른 탭',marked_at:'2026-10-15T00:00:00.000Z',handed_off_at:null}};};
 await detail.locator('[data-basket-write-request-open]').click();await detail.getByRole('button',{name:'후보로 표시'}).click();
 await expect(detail.locator('[data-write-request-status]')).toHaveText('이미 쓰기요청 후보예요.');
 await expect(detail.locator('[data-write-request-box]')).toContainText('이유: 다른 탭');
 expect(f.patches).toHaveLength(1);expect(f.reads.filter(r=>r.select==='id,updated_at,metadata')).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('an unclear result is never resent and turns the buttons off',async({page})=>{
 const f=await fixture(page),{detail}=f;f.db.abortPatch=true;f.db.failReads=true;
 await detail.locator('[data-basket-write-request-open]').click();await detail.getByRole('button',{name:'후보로 표시'}).click();
 await expect(detail.locator('[data-write-request-status]')).toHaveText('확인하지 못했어요. 다시 보내지 않아요. [메모 다시 불러오기]로 확인해 주세요.');
 await expect(detail.getByRole('button',{name:'후보로 표시'})).toBeDisabled();await expect(detail.locator('[data-basket-reload]')).toBeVisible();
 await page.waitForTimeout(300);expect(f.patches).toHaveLength(1);
 // A fresh reload shows the real state and lets the person try again.
 f.db.failReads=false;f.db.abortPatch=false;await detail.locator('[data-basket-reload]').click();
 await expect(detail.getByRole('button',{name:'후보로 표시'})).toBeEnabled();
 // The aborted requests log the browser's own load failures; nothing else may fail.
 expect(f.errors.filter(e=>!/Failed to load resource/.test(e))).toEqual([]);
});

test('a result that lands after an account switch is not shown or applied',async({page})=>{
 const f=await fixture(page),{detail}=f;let release;f.db.hold=new Promise(r=>release=r);
 const reached=page.waitForRequest(r=>r.method()==='PATCH'&&r.url().includes('/rest/v1/app_notes'));
 await detail.locator('[data-basket-write-request-open]').click();await detail.getByRole('button',{name:'후보로 표시'}).click();await reached;
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});
 await expect(detail).toBeHidden();
 const done=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/rest/v1/app_notes'));release();await done;
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,50))));
 await expect(detail).toBeHidden();await expect(page.locator('[data-write-request-box]')).toHaveCount(0);
 await expect(page.locator(`[data-basket-row="${n}"]`)).toHaveCount(0);expect(f.errors).toEqual([]);
});
