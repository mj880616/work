import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// DESK-전체현황표(요청함 11/03 07:48): 담당조직 맨 위 소탭 [목록 | 전체 표]. 전체 표 = 내 담당조직 전부를 묶음별 표 하나로(조직 | 쟁의 단계 | 최근 주요 일정·현황 3줄까지),
// 줄을 누르면 글 길이만큼 늘어나는 여러 줄 칸으로 열려 바로 고치고(Enter 저장), [+ 줄]·[AI로 채우기]·조직 이름 → 상세. 같은 줄을 조직 상세 [현황 표]가 읽는다. 서버는 가짜, 이름은 모두 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const orgs=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},{id:'ob',workspace_id:'w',name:'합성 나 지회',active:true,created_by:owner,updated_at:stamp}];
const UP=[{id:'11111111-1111-4111-8111-111111111111',organization_id:'ob',occurred_at:'2026-10-05T01:00:00Z',raw_text:'합성 나 지회 쟁의행위 찬반투표 가결',detail_text:null}];
const LONG='합성 지노위 2차 조정회의 — 조정 종료(쟁의권 확보), 사측 추가 제시안 검토 후 조합원 설명회 일정 협의 및 합의 이행 점검 계획 수립';
const SEED=[
 {id:'r1',organization_id:'oa',day:'2026-10-29',body:LONG,sort_order:0,source:'user',evidence:[],updated_at:stamp},
 {id:'r2',organization_id:'oa',day:'2026-10-15',body:'합성 총력 결의대회 개최',sort_order:1,source:'ai',evidence:[],updated_at:stamp},
];
const AI=[{day:'2026-10-05',text:'합성 쟁의행위 찬반투표 가결',evidence:[UP[0].id]}];
async function fixture(page,{width,missing=false,prefs=null,seed=[]}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const vp=await installViewPrefsServer(page,prefs);
 const f=await openHome(page);
 const db={rows:seed.map(r=>({...r})),seq:0,ai:[],posts:[],patches:[],deletes:[],answers:[AI]};
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

async function openTable(page){
 await clickView(page,'team');
 await expect(page.locator('#soTeamTabs')).toBeVisible();
 await expect(page.locator('#soTeamTabs').getByRole('tab',{name:'목록'})).toHaveAttribute('aria-selected','true');
 await page.locator('#soTeamTabs').getByRole('tab',{name:'전체 표'}).click();
 await expect(page.locator('#soOverview')).toBeVisible();
}
const oa=page=>page.locator('#soOverview [data-oa-org-row="oa"]');
const ob=page=>page.locator('#soOverview [data-oa-org-row="ob"]');

for(const width of [412,884,1440])test(`[전체 표] 묶음별 표·줄 누르면 여러 줄 칸·+ 줄·AI 채우기·이름 누르면 상세 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width,seed:SEED});
 await openTable(page);
 await expect(page.locator('#soOrganizationList')).toBeHidden();
 await expect(page.locator('#soOverview [data-oa-group]').first()).toBeVisible();
 // 내 담당조직 둘 다 보이고, 줄은 조직 [현황 표] 줄 그대로(최신 순), 빈 조직은 '비어 있음' + [AI로 채우기].
 await expect(oa(page)).toContainText('합성 가 지부');await expect(ob(page)).toContainText('합성 나 지회');
 await expect(oa(page).locator('.oa-line')).toHaveCount(2);
 await expect(oa(page).locator('.oa-line').first()).toContainText('10.29.');
 await expect(ob(page).locator('[data-oa-empty]')).toHaveText('비어 있음');
 // 줄을 누르면 한 줄 칸이 아니라 글 전체가 보이는 여러 줄 칸.
 await oa(page).locator('[data-oa-edit="r1"]').click();
 const area=page.locator('#soOverview textarea[data-st-field="body"]');
 await expect(area).toBeVisible();await expect(area).toHaveValue(LONG);
 const box=await area.evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
 expect(box.scroll).toBeLessThanOrEqual(box.client+2);
 await area.fill(LONG+' 추가 메모');
 await area.press('Enter');
 await expect(page.locator('#soOverview [data-oa-status]')).toHaveText('저장했어요.');
 await expect(oa(page).locator('.oa-line').first()).toContainText('추가 메모');
 expect(db.patches.some(p=>p.source==='user'&&String(p.body).endsWith('추가 메모'))).toBe(true);
 // 버튼은 같은 크기(빼기·취소·저장).
 await oa(page).locator('[data-oa-edit="r2"]').click();
 const sizes=await page.locator('#soOverview .wd-st-actions .wd-st-btn').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().height)));
 expect(new Set(sizes).size).toBe(1);
 await page.locator('#soOverview [data-st-cancel]').click();
 // [+ 줄]
 await ob(page).locator('[data-oa-add="ob"]').click();
 await page.locator('#soOverview [data-st-field="day"]').fill('2026-10-30');
 await page.locator('#soOverview textarea[data-st-field="body"]').fill('합성 교섭 재개 요청');
 await page.locator('#soOverview [data-st-save]').click();
 await expect(page.locator('#soOverview [data-oa-status]')).toHaveText('줄을 넣었어요.');
 await expect(ob(page).locator('.oa-line')).toHaveCount(1);
 // 조직 상세 [현황 표]도 같은 줄을 읽는다 — 이름을 누르면 [목록]으로 돌아가 상세가 열린다.
 await oa(page).locator('[data-oa-open="oa"]').click();
 await expect(page.locator('#soTeamTabs').getByRole('tab',{name:'목록'})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#wdModal')).toBeVisible();
 expect(errors).toEqual([]);
});

test('[전체 표] 빈 조직 [AI로 채우기]는 그 조직 하나만 불러 줄을 넣는다',async({page})=>{
 const {db,errors}=await fixture(page,{width:1440,seed:SEED});
 await openTable(page);
 await ob(page).locator('[data-oa-fill="ob"]').click();
 await expect(page.locator('#soOverview [data-oa-status]')).toHaveText('기록에서 1줄을 채웠어요.');
 expect(db.ai.map(a=>a.organization_id)).toEqual(['ob']);
 await expect(ob(page).locator('.oa-line')).toContainText('쟁의행위 찬반투표 가결');
 expect(errors).toEqual([]);
});

test('[전체 표] 표가 없으면(DB 적용 전) 준비 중 한 줄',async({page})=>{
 await fixture(page,{width:412,missing:true});
 await openTable(page);
 await expect(page.locator('#soOverview [data-oa-missing]')).toHaveText('현황 표는 준비 중이에요.');
});
