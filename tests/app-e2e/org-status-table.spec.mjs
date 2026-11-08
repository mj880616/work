import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// DESK-현황표(요청함 10/30 13:38, 명진 결정 "모두반영"): 담당조직 상세 쟁의 단계 줄 아래 [기록 | 현황 표] 소탭.
// [현황 표]: 4줄까지 보이고 나머지는 '지난 줄 펼치기', [+ 줄 추가]·고치기·빼기. 고른 소탭은 서버 화면 기억(view_prefs.org_tab). 서버는 가짜, 이름은 모두 합성 값.
// WEEKLY-메뉴짝짓기 P7: [기록에서 다시 채우기 (AI)]·처음 열 때 AI 자동 채우기는 지웠다(AI 호출 0). 예전에 AI가 넣은 줄(source=ai)은 그대로 보이고 고치면 내 줄.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const orgs=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp}];
const UP=[{id:'11111111-1111-4111-8111-111111111111',organization_id:'oa',occurred_at:'2026-10-05T01:00:00Z',raw_text:'합성 지노위 2차 조정회의 조정 종료',detail_text:null}];
const AI1=[{day:'2026-10-05',text:'합성 지노위 2차 조정회의 — 조정 종료(쟁의권 확보)',evidence:[UP[0].id]},{day:'2026-10-02',text:'합성 조합원 총력 결의대회',evidence:[]}];
const AI2=[{day:'2026-10-05',text:'합성 다시 뽑은 줄',evidence:[]}];
async function fixture(page,{width,missing=false,prefs=null}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const vp=await installViewPrefsServer(page,prefs);
 const f=await openHome(page);
 const db={rows:AI1.map((a,i)=>({id:'old'+i,organization_id:'oa',day:a.day,end_day:null,body:a.text,sort_order:i,source:'ai',evidence:a.evidence,updated_at:stamp})),seq:0,ai:[],posts:[],patches:[],deletes:[],answers:[AI1,AI2]};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>json(route,UP));
 for(const t of ['app_notes','app_record_links'])await page.route(SB+`/rest/v1/${t}?**`,route=>json(route,[]));
 await page.route(/\/rest\/v1\/app_org_status_rows(\?|$)/,async route=>{
  const req=route.request(),url=new URL(req.url()),m=req.method();
  if(missing)return json(route,{code:'PGRST205',message:'Could not find the table in the schema cache'},404);
  const ids=()=>{const v=url.searchParams.get('id')||'';return v.startsWith('eq.')?[v.slice(3)]:v.startsWith('in.(')?v.slice(4,-1).split(','):[]};
  if(m==='GET')return json(route,db.rows.filter(r=>'eq.'+r.organization_id===url.searchParams.get('organization_id')||(url.searchParams.get('organization_id')||'').includes(r.organization_id)));
  if(m==='POST'){const list=[].concat(req.postDataJSON());db.posts.push(...list);const made=list.map(b=>({id:'r'+(++db.seq),updated_at:stamp,...b}));db.rows.push(...made);return json(route,made.map(r=>({id:r.id})),201)}
  if(m==='PATCH'){const b=req.postDataJSON(),hit=db.rows.filter(r=>ids().includes(r.id));db.patches.push({ids:ids(),...b});hit.forEach(r=>Object.assign(r,b));return json(route,hit.map(r=>({id:r.id})))}
  if(m==='DELETE'){const src=url.searchParams.get('source'),hit=db.rows.filter(r=>ids().includes(r.id)&&(!src||'eq.'+r.source===src));db.deletes.push(...hit.map(r=>r.id));db.rows=db.rows.filter(r=>!hit.includes(r));return json(route,hit.map(r=>({id:r.id})))}
  return route.continue();
 });
 await page.route(SB+'/functions/v1/ai-assist',async route=>{
  const b=route.request().postDataJSON();
  if(b.kind!=='org_status_rows')return json(route,{ok:true,kind:b.kind,skipped:true,checked_at:null,partial:false});
  db.ai.push(b);return json(route,{ok:true,kind:'org_status_rows',organization_id:b.organization_id,rows:db.answers.shift()??[],partial:false});
 });
 return {f,db,vp,errors};
}
async function openOrg(page){
 await clickView(page,'team');
 await page.locator('#soOrganizationList [data-so-org="oa"]').click();
 await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText(orgs[0].name);
}
const sub=(page,name)=>page.locator('#wdSubTabs').getByRole('tab',{name});

for(const width of [412,1440])test(`[현황 표] 예전 AI 줄 그대로·줄 추가·수정·빼기·AI 버튼 없음·소탭 기억 ${width}px`,async({page})=>{
 const {db,vp,errors}=await fixture(page,{width});
 await openOrg(page);
 // 소탭은 쟁의 단계 줄 바로 아래, [기록]이 기본이고 기록 화면은 그대로.
 await expect(sub(page,'기록')).toHaveAttribute('aria-selected','true');
 const ys=await page.evaluate(()=>['#wdStage','#wdSubTabs','#wdInbox'].map(s=>document.querySelector(s).getBoundingClientRect().top));
 expect(ys[0]).toBeLessThan(ys[1]);expect(ys[1]).toBeLessThan(ys[2]);
 await expect(page.locator('#wdInbox')).toBeVisible();await expect(page.locator('#wdStatusTable')).toBeHidden();
 expect(db.ai).toHaveLength(0);
 await sub(page,'현황 표').click();
 await expect(sub(page,'현황 표')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#wdInbox')).toBeHidden();
 await expect.poll(()=>vp.patches.at(-1)?.org_tab).toBe('table');
 // 예전에 AI가 넣은 줄 두 개가 그대로 보이고, AI는 부르지 않는다. [기록에서 다시 채우기 (AI)]는 없다.
 const table=page.locator('#wdStatusTable [data-st-table]');
 await expect(table.locator('tbody tr[data-st-row]')).toHaveCount(2);
 await expect(page.locator('#wdStatusTable [data-st-refill]')).toHaveCount(0);
 await expect(page.locator('#wdStatusTable')).not.toContainText('다시 채우기');
 // 날짜 오름차순(DESK-현황오름차순): 오래된 10.2가 위, 10.5가 아래.
 await expect(table.locator('tbody tr[data-st-row]').first()).toContainText('10.2.(금)');
 await expect(table.locator('tbody tr[data-st-row]').last()).toContainText('10.5.(월)');
 await expect(table.locator('tbody tr[data-st-row]').last()).toContainText('합성 지노위 2차 조정회의 — 조정 종료(쟁의권 확보)');
 await expect(page.locator('#wdStatusTable')).not.toContainText('그대로 들어감'); // UI-당연한안내삭제
 // 줄 추가(날짜는 달력 칸).
 await page.locator('#wdStatusTable [data-st-add]').click();
 await page.locator('#wdStatusTable [data-st-field="day"]').fill('2026-10-06');
 await page.locator('#wdStatusTable [data-st-field="body"]').fill('합성 교섭 재개 요청');
 await page.locator('#wdStatusTable [data-st-save]').click();
 await expect(page.locator('#wdStatusTable [data-st-status]')).toHaveText('줄을 넣었어요.');
 await expect(table.locator('tbody tr[data-st-row]').last()).toContainText('합성 교섭 재개 요청');
 expect(db.posts.at(-1)).toMatchObject({day:'2026-10-06',body:'합성 교섭 재개 요청',source:'user',sort_order:2});
 expect('end_day' in db.posts.at(-1)).toBe(false); // 끝나는 날을 비우면 보내지 않는다(하루 일정)
 // AI 줄을 고치면 내 줄이 된다.
 const second=table.locator('tbody tr[data-st-row]').nth(0);
 await second.getByRole('button',{name:/고치기$/}).click();
 await page.locator('#wdStatusTable [data-st-field="body"]').fill('합성 지노위 조정 종료 — 쟁의권 확보');
 await page.locator('#wdStatusTable [data-st-save]').click();
 await expect(page.locator('#wdStatusTable [data-st-status]')).toHaveText('저장했어요.');
 expect(db.patches.at(-1)).toMatchObject({body:'합성 지노위 조정 종료 — 쟁의권 확보',source:'user'});
 // 빼기.
 await table.locator('tbody tr[data-st-row]').filter({hasText:'2차 조정회의'}).getByRole('button',{name:/고치기$/}).click();
 await page.locator('#wdStatusTable [data-st-delete]').click();
 await expect(page.locator('#wdStatusTable [data-st-status]')).toHaveText('줄을 뺐어요.');
 await expect(table.locator('tbody tr[data-st-row]')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 // 소탭 기억: 다시 열면 [현황 표] 그대로.
 await page.reload();
 // 새로고침하면 주소의 조직이 다시 열린다(NAV-새로고침제자리). 열리지 않았으면 목록에서 연다.
 try{await expect(page.locator('#wdTitle')).toHaveText(orgs[0].name,{timeout:5000});await expect(page.locator('#wdModal')).toBeVisible({timeout:1000})}catch{await openOrg(page)}
 await expect(sub(page,'현황 표')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#wdStatusTable [data-st-table] tbody tr[data-st-row]')).toHaveCount(2);
 expect(db.ai).toEqual([]);
 expect(errors).toEqual([]);
});

test('[현황 표] 시작일~끝나는 날: 달력 두 칸으로 저장하면 11.2.~11.5.로 보이고, 끝이 앞이면 저장 안 됨',async({page})=>{
 const {db,errors}=await fixture(page,{width:1440,prefs:{org_tab:'table'}});
 await openOrg(page);
 await expect(sub(page,'현황 표')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#wdStatusTable [data-st-table] tbody tr[data-st-row]')).toHaveCount(2); // 예전 AI 줄 두 개
 const n0=db.posts.length;
 await page.locator('#wdStatusTable [data-st-add]').click();
 const f=page.locator('#wdStatusTable');
 await expect(f.locator('[data-st-field="day"]')).toBeVisible();await expect(f.locator('[data-st-field="end_day"]')).toBeVisible();
 await f.locator('[data-st-field="day"]').fill('2026-11-02');
 await f.locator('textarea[data-st-field="body"]').fill('합성 파업 찬반투표');
 await f.locator('[data-st-field="end_day"]').fill('2026-11-01');
 await f.locator('[data-st-save]').click();
 await expect(f.locator('[data-st-status]')).toHaveText('끝나는 날은 시작일과 같거나 뒤여야 해요.');
 expect(db.posts).toHaveLength(n0);
 await f.locator('[data-st-field="end_day"]').fill('2026-11-05');
 await f.locator('[data-st-save]').click();
 await expect(f.locator('[data-st-status]')).toHaveText('줄을 넣었어요.');
 expect(db.posts.at(-1)).toMatchObject({day:'2026-11-02',end_day:'2026-11-05',body:'합성 파업 찬반투표'});
 await expect(f.locator('tbody tr[data-st-row]').filter({hasText:'합성 파업'}).locator('.wd-st-day-text')).toHaveText('11.2.~11.5.');
 // 고쳐서 끝나는 날을 비우면 하루 일정으로 돌아간다.
 await f.locator('tbody tr[data-st-row]').filter({hasText:'합성 파업'}).getByRole('button',{name:/고치기$/}).click();
 await f.locator('[data-st-field="end_day"]').fill('');
 await f.locator('[data-st-save]').click();
 await expect(f.locator('[data-st-status]')).toHaveText('저장했어요.');
 expect(db.patches.at(-1)).toMatchObject({end_day:null});
 await expect(f.locator('tbody tr[data-st-row]').filter({hasText:'합성 파업'}).locator('.wd-st-day-text')).toHaveText('11.2.(월)');
 expect(errors).toEqual([]);
});

test('[현황 표] 5줄 넘으면 지난 줄 접힘, 표가 없으면 준비 중',async({page})=>{
 const {db}=await fixture(page,{width:1440,prefs:{org_tab:'table'}});
 db.rows=Array.from({length:6},(_,i)=>({id:'k'+i,organization_id:'oa',workspace_id:'w',day:`2026-10-0${6-i}`,body:'합성 줄 '+i,sort_order:i,source:'user',evidence:[],updated_at:stamp}));
 await openOrg(page);
 await expect(sub(page,'현황 표')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#wdStatusTable [data-st-table] tbody tr[data-st-row]')).toHaveCount(4);
 const older=page.locator('#wdStatusTable [data-st-older]');
 await expect(older.locator('summary')).toHaveText('지난 줄 2 펼치기');
 await older.locator('summary').click();
 await expect(older.locator('tr[data-st-row]')).toHaveCount(2);
 expect(db.ai).toHaveLength(0);
});

test('[현황 표] DB 적용 전에는 준비 중 한 줄',async({page})=>{
 await fixture(page,{width:412,missing:true,prefs:{org_tab:'table'}});
 await openOrg(page);
 await expect(page.locator('#wdStatusTable [data-st-missing]')).toHaveText('현황 표는 준비 중이에요.');
 await expect(page.locator('#wdStatusTable [data-st-add]')).toHaveCount(0);
});
