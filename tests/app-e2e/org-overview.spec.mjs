import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// DESK-전체현황표 → WEEKLY-메뉴짝짓기 P3(설계 docs/design/weekly-menu-pairing.md 3.1): 담당조직 [전체 표] = '이번 주 조직보고'.
// 조직 | 쟁의 단계 | 그 주 조직보고(주별 조직보고 표 한 곳). 넣은 줄·흐린 제안 줄([✓ 넣기]·[고치기]·[×])·[+ 줄]·줄 누르면 고치기·주 고르기·
// 다른 화면이 먼저 고친 줄 안내·지난주(처음 쓰는 주는 현황 표) 줄 접어 두기·[가져오기]. AI 채우기 버튼은 없다. 서버는 가짜, 이름은 모두 합성 값.
// 시계는 2026-10-06(화) → 이번 주 = 10.5~10.11.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test',W='2026-10-05';
const orgs=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},{id:'ob',workspace_id:'w',name:'합성 나 지회',active:true,created_by:owner,updated_at:stamp}];
const L=(id,org,day,body,state='in',x={})=>({id,organization_id:org,week_start:W,day,end_day:null,body,sort_order:0,state,origin:'user',edited:false,source_update_ids:[],source_note_ids:[],source_status_ids:[],updated_at:stamp,...x});
const SEED=[
 L('l1','oa','2026-10-06','합성 교섭 상견례'),
 L('l2','oa','2026-10-07','합성 찬반투표 중간 투표율 공유 간담회','suggested',{origin:'ai',sort_order:1}),
 L('l3','oa','2026-10-08','합성 뺀 제안','dropped',{sort_order:2}),
 L('p1','oa','2026-09-30','합성 지난주 줄',undefined,{week_start:'2026-09-28'}),
];
const STATUS=[{id:'s1',organization_id:'ob',day:'2026-09-20',end_day:null,body:'합성 현황 줄',sort_order:0,source:'user',evidence:[],updated_at:stamp}];
async function fixture(page,{width,missing=false,seed=SEED,order=null}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await installViewPrefsServer(page,null);
 const f=await openHome(page);
 const db={rows:seed.map(r=>({...r})),seq:0,posts:[],patches:[],gets:[],tick:0};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
 for(const t of ['app_suborganization_updates','app_notes','app_record_links'])await page.route(SB+`/rest/v1/${t}?**`,route=>json(route,[]));
 await page.route(/\/rest\/v1\/app_org_status_rows(\?|$)/,route=>{const q=new URL(route.request().url()).searchParams.get('organization_id')||'';return json(route,STATUS.filter(r=>q.includes(r.organization_id)))});
 await page.route(/\/rest\/v1\/app_weekly_org_lines(\?|$)/,async route=>{
  const req=route.request(),url=new URL(req.url()),q=url.searchParams,m=req.method();
  if(missing)return json(route,{code:'PGRST205',message:'Could not find the table in the schema cache'},404);
  const eq=k=>{const v=q.get(k);return v&&v.startsWith('eq.')?v.slice(3):null};
  if(m==='GET'){db.gets.push(url.search);const id=eq('id'),wk=eq('week_start'),org=q.get('organization_id')||'';return json(route,db.rows.filter(r=>id?r.id===id:(r.week_start===wk&&org.includes(r.organization_id))))}
  if(m==='POST'){const list=[].concat(req.postDataJSON());db.posts.push(...list);const made=list.map(b=>({...L('n'+(++db.seq),b.organization_id,null,''),...b,updated_at:'2026-10-06T02:00:0'+(db.tick++%10)+'Z'}));db.rows.push(...made);return json(route,made,201)}
  if(m==='PATCH'){const b=req.postDataJSON(),id=eq('id'),at=eq('updated_at');db.patches.push({id,at,...b});const hit=db.rows.filter(r=>r.id===id&&(!at||r.updated_at===at));hit.forEach(r=>Object.assign(r,b,{updated_at:'2026-10-06T03:00:0'+(db.tick++%10)+'Z'}));return json(route,hit)}
  return json(route,{message:'no'},405);
 });
 // 주간보고(개인본) 순서: 그 주 임시저장 바탕(proposed)의 산하조직 칸 순서. order = 조직 이름들(없으면 임시저장 없음 → 앱 조직 순서).
 await page.route(/\/rest\/v1\/app_weekly_exec_requests(\?|$)/,route=>{
  if(route.request().method()!=='GET')return json(route,[]);
  const draft=order?{v:1,rows:[],titles:[],proposed:{at:'2026-10-05T00:00:00.000Z',cells:order.map(k=>({section:'orgs',key:k,n:0,lines:[]}))}}:null;
  return json(route,draft?[{id:'d1',draft,draft_saved_at:stamp}]:[]);
 });
 await page.route(SB+'/functions/v1/ai-assist',route=>json(route,{ok:true,kind:route.request().postDataJSON().kind,skipped:true}));
 return {f,db,errors};
}
async function openTable(page){
 await clickView(page,'team');
 await expect(page.locator('#soTeamTabs')).toBeVisible();
 await page.locator('#soTeamTabs').getByRole('tab',{name:'전체 표'}).click();
 await expect(page.locator('#soOverview')).toBeVisible();
}
const oa=page=>page.locator('#soOverview [data-wl-org-row="oa"]');
const ob=page=>page.locator('#soOverview [data-wl-org-row="ob"]');
const status=page=>page.locator('#soOverview [data-wl-status]');

for(const width of [412,1440])test(`[전체 표] 이번 주 조직보고: 넣은 줄·제안 줄 넣기/빼기·+ 줄·줄 고치기·AI 채우기 버튼 없음 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openTable(page);
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('10.5~10.11');
 await expect(page.locator('#soOverview [data-week-step="0"]')).toHaveCount(0);
 await expect(page.locator('#soOverview')).not.toContainText('AI로 채우기');
 await expect(page.locator('#soOverview')).not.toContainText('모두 다시 채우기');
 // 넣은 줄 1, 흐린 제안 줄 1(AI 표시), 뺀 줄은 안 보임.
 await expect(oa(page).locator('.wl-line:not(.is-sug):not(.is-last)')).toHaveCount(1);
 await expect(oa(page).locator('.wl-line.is-sug')).toHaveCount(1);
 await expect(oa(page).locator('.wl-line.is-sug .wl-ai')).toHaveText('AI');
 await expect(oa(page)).not.toContainText('합성 뺀 제안');
 await expect(oa(page).locator('.wl-day').first()).toHaveText('- 10.6.');
 // [✓ 넣기] → 조건 쓰기로 state in.
 await oa(page).locator('[data-wl-in="l2"]').click();
 await expect(status(page)).toHaveText('주간보고에 넣었어요.');
 expect(db.patches.at(-1)).toMatchObject({id:'l2',at:stamp,state:'in'});
 await expect(oa(page).locator('.wl-line.is-sug')).toHaveCount(0);
 await expect(oa(page).locator('.wl-line:not(.is-last)')).toHaveCount(2);
 // 줄을 누르면 그 자리 글 칸 → Enter 저장(edited).
 await oa(page).locator('.wl-text[data-wl-edit="l1"]').click();
 const body=page.locator('#soOverview [data-wl-field="body"]');
 await expect(body).toBeFocused();await expect(body).toHaveValue('합성 교섭 상견례');
 await body.fill('합성 교섭 상견례 및 요구안 전달');await body.press('Enter');
 await expect(status(page)).toHaveText('저장했어요.');
 expect(db.patches.at(-1)).toMatchObject({id:'l1',body:'합성 교섭 상견례 및 요구안 전달',state:'in',edited:true});
 await expect(oa(page)).toContainText('요구안 전달');
 // [+ 줄]: 날짜 없이도 넣을 수 있다(이번 주·내 줄).
 await ob(page).locator('[data-wl-add="ob"]').click();
 await page.locator('#soOverview [data-wl-field="day"]').fill('');
 await body.fill('합성 현안 설명회 준비');await page.locator('#soOverview [data-wl-save]').click();
 await expect(status(page)).toHaveText('줄을 넣었어요.');
 expect(db.posts.at(-1)).toMatchObject({organization_id:'ob',week_start:W,day:null,body:'합성 현안 설명회 준비',state:'in',origin:'user'});
 await expect(ob(page).locator('.wl-day').first()).toHaveText('- ');
 // 빈 글은 저장 안 됨.
 await ob(page).locator('[data-wl-add="ob"]').click();
 await page.locator('#soOverview [data-wl-save]').click();
 await expect(status(page)).toHaveText('내용을 적어 주세요.');
 await page.keyboard.press('Escape');
 await expect(page.locator('#soOverview .wl-form')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('[전체 표] 다른 화면에서 먼저 고친 줄: 그 자리 안내 + [내 글로 바꾸기]·[그대로 두기], 다른 줄은 그대로',async({page})=>{
 const {db,errors}=await fixture(page,{width:1440});
 await openTable(page);
 await oa(page).locator('.wl-text[data-wl-edit="l1"]').click();
 // 그사이 다른 화면이 같은 줄을 고침.
 Object.assign(db.rows.find(r=>r.id==='l1'),{body:'합성 교섭 상견례(다른 화면)',updated_at:'2026-10-06T05:00:00Z'});
 const body=page.locator('#soOverview [data-wl-field="body"]');
 await body.fill('합성 교섭 상견례(내 글)');await body.press('Enter');
 const conf=oa(page).locator('[data-wl-conflict="l1"]');
 await expect(conf).toContainText("다른 화면에서 먼저 고쳤어요: '합성 교섭 상견례(다른 화면)'");
 await expect(oa(page).locator('.wl-line.is-sug')).toHaveCount(1);
 await conf.locator('[data-wl-mine="l1"]').click();
 await expect(status(page)).toHaveText('저장했어요.');
 expect(db.patches.at(-1)).toMatchObject({id:'l1',at:'2026-10-06T05:00:00Z',body:'합성 교섭 상견례(내 글)'});
 await expect(oa(page).locator('[data-wl-conflict]')).toHaveCount(0);
 await expect(oa(page)).toContainText('(내 글)');
 expect(errors).toEqual([]);
});

test('[전체 표] 주 고르기: 지난 주를 고르면 그 주 줄, [이번 주]로 돌아옴 · 지난주/현황 표 줄은 접혀 있다가 [가져오기]',async({page})=>{
 const {db,errors}=await fixture(page,{width:412});
 await openTable(page);
 // 평일 담당조직: 지난주 줄은 접힌 한 줄. 지난주 표가 빈 조직(ob)은 현황 표 최근 줄.
 await expect(oa(page).locator('[data-wl-last="oa"]')).toHaveText('지난주 1줄 ▸');
 await expect(ob(page).locator('[data-wl-last="ob"]')).toHaveText('현황 표 1줄 ▸');
 await ob(page).locator('[data-wl-last="ob"]').click();
 await expect(ob(page).locator('.wl-line.is-last')).toContainText('합성 현황 줄');
 await ob(page).locator('[data-wl-take="ob"]').click();
 await expect(status(page)).toHaveText('지난주 1줄을 가져왔어요.');
 expect(db.posts.at(-1)).toMatchObject({organization_id:'ob',week_start:W,day:'2026-09-20',body:'합성 현황 줄',origin:'last_week',state:'in'});
 // 지난 주로.
 await page.locator('#soOverview [data-week-step="-1"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('9.28~10.4');
 await expect(oa(page)).toContainText('합성 지난주 줄');
 await expect(oa(page)).not.toContainText('합성 교섭 상견례');
 await page.locator('#soOverview [data-week-step="0"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('10.5~10.11');
 await expect(oa(page)).toContainText('합성 교섭 상견례');
 expect(errors).toEqual([]);
});

test('[전체 표] 넣은 줄 3줄 넘음 표시·가장 최근 3줄 + 외 n줄 ▾',async({page})=>{
 const seed=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'].map((d,i)=>L('m'+i,'oa',d,'합성 줄 '+i,'in',{sort_order:i}));
 const {errors}=await fixture(page,{width:1440,seed});
 await openTable(page);
 await expect(oa(page).locator('.wl-warn')).toHaveText('주간보고 3줄 넘음');
 await expect(ob(page).locator('.wl-warn')).toHaveCount(0);
 const lines=oa(page).locator('.wl-line:not(.is-last)');
 await expect(lines).toHaveCount(3);
 await expect(lines.first()).toContainText('10.7.');
 await oa(page).locator('[data-wl-toggle="oa"]').click();
 await expect(lines).toHaveCount(5);
 await expect(lines.first()).toContainText('10.5.');
 expect(errors).toEqual([]);
});

test('[전체 표] 표가 없으면(DB 적용 전) 준비 중 한 줄',async({page})=>{
 await fixture(page,{width:412,missing:true});
 await openTable(page);
 await expect(page.locator('#soOverview [data-wl-missing]')).toHaveText('주별 조직보고 표는 준비 중이에요.');
});

for(const width of [412,1440])test(`[전체 표] 주간보고 조직보고 표와 같은 모양(조직 | 조직현황 칸 선) ${width}px`,async({page})=>{
 const {errors}=await fixture(page,{width});
 await openTable(page);
 const table=page.locator('#soOverview table.wl-table');
 await expect(table).toHaveCount(1);
 await expect(page.locator('#soOverview .oa-group')).toHaveCount(0);
 await expect(table.locator('thead th')).toHaveText(['조직','이번 주 조직보고']);
 await expect(page.locator('#soOverview')).not.toContainText('쟁의 단계');
 // 칸 선: 조직 칸과 현황 칸 모두 테두리가 있다(주간 정리 표와 같은 .wl-table).
 const cell=oa(page).locator('td.wl-c-rows'),head=oa(page).locator('th.wl-c-org');
 await expect(cell).toHaveCSS('border-top-width','1px');await expect(head).toHaveCSS('border-top-width','1px');
 await expect(oa(page).locator('.wl-day').first()).toHaveText('- 10.6.');
 const [h,c]=await Promise.all([head.boundingBox(),cell.boundingBox()]);
 if(width>760){expect(c.x).toBeGreaterThanOrEqual(h.x+h.width-1);expect(Math.abs(c.y-h.y)).toBeLessThan(2);} // 옆으로 나란히
 else{expect(c.y).toBeGreaterThanOrEqual(h.y+h.height-2);expect(Math.abs(c.x-h.x)).toBeLessThan(2);expect(c.width).toBeGreaterThan(300);} // 두 줄(조직 위, 현황 아래), 폭은 꽉 참
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

test('[전체 표] 조직 순서 = 주간보고(개인본) 순서(그 주 임시저장 바탕), 바탕이 없으면 앱 조직 순서',async({page})=>{
 const {errors}=await fixture(page,{width:1440,order:['합성 나 지회','합성 가 지부']});
 await openTable(page);
 await expect(page.locator('#soOverview tbody tr')).toHaveCount(2);
 await expect(page.locator('#soOverview tbody tr').first()).toHaveAttribute('data-wl-org-row','ob');
 await expect(page.locator('#soOverview tbody tr').nth(1)).toHaveAttribute('data-wl-org-row','oa');
 expect(errors).toEqual([]);
});
test('[전체 표] 임시저장 바탕이 없으면 앱 조직 순서(가나다)',async({page})=>{
 await fixture(page,{width:1440});
 await openTable(page);
 await expect(page.locator('#soOverview tbody tr').first()).toHaveAttribute('data-wl-org-row','oa');
 await expect(page.locator('#soOverview tbody tr').nth(1)).toHaveAttribute('data-wl-org-row','ob');
});
