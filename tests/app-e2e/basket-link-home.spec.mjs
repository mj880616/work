async function readHomeCache(page,key){
 const cdp=await page.context().newCDPSession(page);
 try{const {entries}=await cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:'http://127.0.0.1:8123',isLocalStorage:true}});const value=entries.find(([storedKey])=>storedKey===key)?.[1];return value?JSON.parse(value):null;}finally{await cdp.detach();}
}
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const card=page=>page.locator('[data-home-card="updates"]');
const linked=(id,note_id,summary,extra={})=>({id,note_id,summary,organization_id:'o',status:'confirmed',workspace_id:'w',project_id:null,meeting_id:null,document_id:null,...extra});
const noted=(id,occurred_at,extra={})=>({id,occurred_at,raw_text:'원문 '+id,workspace_id:'w',archived_at:null,...extra});
async function fixture(page,{records=[linked('l','n','승인한 조직 요약')],notes=[noted('n','2026-10-06T01:00:00Z')],updates=[{id:'u',organization_id:'o',raw_text:'기존 조직 기록',occurred_at:'2026-10-05T16:00:00Z'}],assignments=[{organization_id:'o'}]}={}){
 await openHome(page);await page.waitForFunction(()=>KPTUHome.metrics.readyAt);
 const state={records,notes,updates,assignments,failure:'',hold:null,reads:[]};
 await page.route(SB+'/**',async route=>{
  const url=new URL(route.request().url()),table=url.pathname.split('/').pop();
  // Google task-link reads retain their existing fixture and must stay independent.
  const basketLinks=table==='app_record_links'&&(url.searchParams.has('note_id')||url.searchParams.has('organization_id'));
  if(!basketLinks&&!['app_notes','app_suborganizations','app_suborganization_assignees','app_suborganization_updates'].includes(table))return route.fallback();
  state.reads.push({table,query:url.search});
  const data=basketLinks?state.records.map(r=>({...r,note:state.notes.find(n=>n.id===r.note_id)})):table==='app_notes'?[...state.notes]:table==='app_suborganization_updates'?[...state.updates]:table==='app_suborganization_assignees'?[...state.assignments]:[{id:'o',name:'테스트 조직',active:true},{id:'inactive',name:'비활성 조직',active:false},{id:'unassigned',name:'미담당 조직',active:true}];
  if(basketLinks&&state.hold)await state.hold;
  if(state.failure===table)return route.fulfill({status:403,json:{message:'QA read denied'}});
  const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||data.length||100);
  return route.fulfill({json:data.slice(offset,offset+limit)});
 });
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 return state;
}
for(const width of [390,1280])test(`home mixes note-date records with updates and opens original at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await fixture(page);
 await expect(card(page)).toContainText('이번 주 조직 기록');await expect(card(page)).toContainText('승인한 조직 요약');await expect(card(page)).toContainText('바구니 연결');await expect(card(page)).toContainText('기존 조직 기록');
 await expect(card(page).locator('.home-update')).toHaveCount(2);
 await card(page).locator('[data-home-note="n"]').focus();await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/view=basket.*note=n/);await expect(page.locator('#basketView')).toBeVisible();
});
test('home filters active assigned organizations and the KST note week before combined newest five',async({page})=>{
 const records=[linked('old','old','지난 주'),linked('end','end','다음 주'),linked('inactive','inactive','비활성 제외',{organization_id:'inactive'}),linked('unassigned','unassigned','미담당 제외',{organization_id:'unassigned'}),...Array.from({length:6},(_,i)=>linked('l'+i,'n'+i,i===5?null:'요약 '+i))];
 const notes=[noted('old','2026-10-04T14:59:59.999999Z'),noted('end','2026-10-11T15:00:00Z'),noted('inactive','2026-10-07T01:00:00Z'),noted('unassigned','2026-10-07T01:00:00Z'),...Array.from({length:6},(_,i)=>noted('n'+i,`2026-10-06T01:00:00.00000${i}Z`))];
 await fixture(page,{records,notes});
 await expect(card(page).locator('.home-update')).toHaveCount(5);await expect(card(page)).toContainText('원문 발췌');await expect(card(page)).toContainText('원문 n5');await expect(card(page)).not.toContainText('기존 조직 기록');await expect(card(page)).not.toContainText('요약 0');
 for(const text of ['지난 주','다음 주','비활성 제외','미담당 제외'])await expect(card(page)).not.toContainText(text);
 expect(await card(page).locator('[data-home-note]').evaluateAll(rows=>rows.map(row=>row.dataset.homeNote))).toEqual(['n5','n4','n3','n2','n1']);
});
test('no assignments never falls back to all linked organizations',async({page})=>{
 const state=await fixture(page,{assignments:[]});await expect(card(page)).toContainText('이번 주 기록 없음');
 expect(state.reads.filter(r=>r.table==='app_record_links'||r.table==='app_notes')).toHaveLength(0);
});
test('home fetches pages before filtering and limiting linked notes',async({page})=>{
 const records=Array.from({length:105},(_,i)=>linked('l'+i,'n'+i,i===104?'마지막 페이지 최신 요약':'지난 기록'));
 const notes=records.map((r,i)=>noted(r.note_id,i===104?'2026-10-06T12:00:00Z':'2026-09-01T00:00:00Z'));
 const state=await fixture(page,{records,notes});await expect(card(page)).toContainText('마지막 페이지 최신 요약');
 expect(state.reads.some(r=>r.table==='app_record_links'&&r.query.includes('offset=100'))).toBe(true);
});
test('linked-note read failure is retryable and does not claim an empty week',async({page})=>{
 const state=await fixture(page);await expect(card(page)).toContainText('승인한 조직 요약');state.failure='app_record_links';
 await page.evaluate(()=>dispatchEvent(new CustomEvent('kptu:basket-links-changed')));await expect(card(page)).toHaveAttribute('data-state','failed');await expect(card(page)).not.toContainText('이번 주 기록 없음');
 state.failure='';state.records[0].summary='재조회 요약';await page.locator('[data-home-retry="updates"]').click();await expect(card(page)).toContainText('재조회 요약');
});
test('mutation during a note read schedules a subsequent fresh snapshot',async({page})=>{
 const state=await fixture(page);await expect(card(page)).toContainText('승인한 조직 요약');
 let release;state.hold=new Promise(resolve=>release=resolve);const before=state.reads.filter(r=>r.table==='app_record_links').length;
 await page.evaluate(()=>dispatchEvent(new CustomEvent('kptu:basket-links-changed')));await expect.poll(()=>state.reads.filter(r=>r.table==='app_record_links').length).toBeGreaterThan(before);
 state.records[0]={...state.records[0],summary:'읽는 중 변경한 요약'};
 await page.evaluate(()=>{for(let i=0;i<3;i++)dispatchEvent(new CustomEvent('kptu:basket-links-changed'));});state.hold=null;release();
 await expect(card(page)).toContainText('읽는 중 변경한 요약');expect(state.reads.filter(r=>r.table==='app_record_links').length).toBe(before+2);
});
test('late linked-note reads cannot write cards or cache after workspace changes',async({page})=>{
 const state=await fixture(page);await expect(card(page)).toContainText('승인한 조직 요약');
 let release;state.hold=new Promise(resolve=>release=resolve);const before=state.reads.filter(r=>r.table==='app_record_links').length;
 await page.evaluate(()=>dispatchEvent(new CustomEvent('kptu:basket-links-changed')));await expect.poll(()=>state.reads.filter(r=>r.table==='app_record_links').length).toBeGreaterThan(before);
 await page.evaluate(()=>{const c=KPTURuntime.context.read();KPTURuntime.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});});
 state.hold=null;release();await page.waitForTimeout(200);
 const prefix=await page.evaluate(()=>KPTURuntime.ownerCache.prefix);const cache=await readHomeCache(page,prefix+'home-read-v1:home-test');
 expect(cache.workspaceId).toBe('w');
});

test('basket display cache restores approved summary and source route while the next read waits',async({page})=>{
 const state=await fixture(page);await expect(card(page)).toContainText('승인한 조직 요약');
 const prefix=await page.evaluate(()=>KPTURuntime.ownerCache.prefix);const cached=(await readHomeCache(page,prefix+'home-read-v1:home-test')).cards.updates.rows[0];
 expect(cached).toMatchObject({type:'basket',note_id:'n',text:'승인한 조직 요약'});expect(cached).not.toHaveProperty('raw_text');
 let release;state.hold=new Promise(resolve=>release=resolve);
 try{await page.reload();await expect(card(page)).toContainText('승인한 조직 요약');await expect(card(page).locator('[data-home-note="n"]')).toHaveAttribute('href','?view=basket&note=n');}finally{state.hold=null;release();}
});
test('late linked records stay cleared when the signed-in owner changes',async({page})=>{
 const state=await fixture(page);await expect(card(page)).toContainText('승인한 조직 요약');
 let release;state.hold=new Promise(resolve=>release=resolve);const before=state.reads.filter(r=>r.table==='app_record_links').length;
 await page.evaluate(()=>dispatchEvent(new CustomEvent('kptu:basket-links-changed')));await expect.poll(()=>state.reads.filter(r=>r.table==='app_record_links').length).toBeGreaterThan(before);
 const cachePrefix=await page.evaluate(()=>KPTURuntime.ownerCache.prefix);
 await page.evaluate(()=>{const session=KPTURuntime.session.read();KPTURuntime.session.write({...session,user:{...session.user,id:'next-owner'}});});
 state.hold=null;release();await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
 expect(await readHomeCache(page,cachePrefix+'home-read-v1:home-test')).toBeNull();
 expect(await readHomeCache(page,cachePrefix+'home-read-v1:next-owner')).toBeNull();
});

for(const width of [390,1280])test(`home NULL summary uses 80 code points with excerpt marker and preserves approved text ${width}`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width,height:900});const approved=' \n'+ '승인😀'.repeat(35)+'\n ';
 const state=await fixture(page,{records:[linked('l','n',null),linked('s','s',approved),linked('empty','empty',null)],notes:[noted('n','2026-10-06T01:00:00Z',{raw_text:'😀'.repeat(80)+'잘라낼 글'}),noted('s','2026-10-06T02:00:00Z'),noted('empty','2026-10-06T03:00:00Z',{raw_text:null})],updates:[]});
 const row=card(page).locator('[data-home-note="n"]');await expect(row).toContainText('원문 발췌');await expect(row.locator('.home-title')).toHaveText('😀'.repeat(80));
 expect(await card(page).locator('[data-home-note="s"] .home-title').textContent()).toBe(approved);
 await expect(card(page).locator('[data-home-note="empty"]')).toContainText('원문을 확인해 주세요');
 expect(state.records[0].summary).toBeNull();
 const copies=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('home-read-v1:')).map(k=>localStorage.getItem(k)).join(''));
 expect(copies).not.toContain('잘라낼 글');expect(copies).toContain('"excerpt":true');expect(errors).toEqual([]);
});
