import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
// ORG/BIZ-기록하나로 O-4 ②·B-3 ②(설계 docs/design/record-one.md 4·4-1절, 시안 docs/design/mockups/journal-week-tables.html, JOURNAL-이번주보고표):
// ① 업무일지 [하루]의 주간보고 재료 자리 = '이번 주 보고' 표 두 개 — 왼쪽 4. 조직보고(조직보고 창), 오른쪽 2. 사업요약(사업요약 창). PC·폴드 펼침 좌우, 폰 위아래.
// ② 같은 자료: 업무일지 칸에 쓰면 담당조직 [전체 표]·[주간 정리] 4.에도 같은 글, 사업 지금 상황을 고치면 [주간 정리] 2. 1)에도 같은 글.
// ③ [주간 정리] 4.·3. 2)·2. 1)이 창 부품(4. = data-rw-table, 3. 2) 사업장 칸 안 = 같은 조직 기록, 2. 1) = 사업요약표).
// ④ 전환 주(11.9) 앞 주는 예전 주간보고 재료 그대로(journal.spec.mjs가 10.6 시계로 본다). 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-17(화).
test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test',W='2026-11-16',NOW='2026-11-17T01:00:00Z';
const OA='0a0a0a0a-0000-4000-8000-00000000000a',OB='0b0b0b0b-0000-4000-8000-00000000000b';
const orgs=[{id:OA,workspace_id:'w',name:'합성 가 지부',aliases:[],active:true,created_by:owner,updated_at:stamp},{id:OB,workspace_id:'w',name:'합성 나 지회',aliases:[],active:true,created_by:owner,updated_at:stamp}];
let n=0;const uid=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
const U=(org,day,text,x={})=>({id:uid(),organization_id:org,raw_text:text,occurred_at:`${day}T12:00:00+09:00`,end_day:null,source_kind:null,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z',workspace_id:'w',created_by:owner,detail_text:null,doc:null,...x});

async function fixture(page,{width,records=[],now=[],sites=null}={}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await installViewPrefsServer(page,null);
 const set=page.clock.setFixedTime.bind(page.clock);page.clock.setFixedTime=()=>set(new Date(NOW));
 const db={records:records.map(r=>({...r})),posts:[],marks:[]};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 let biz=null;
 const before=async()=>{
  biz=await installBusinessNowServer(page,{now}); // 홈이 뜨자마자 사업요약 창이 읽으므로 앱이 뜨기 전에 건다
  await page.route(u=>u.origin===SB&&u.pathname==='/auth/v1/token',route=>json(route,{access_token:'home-access',refresh_token:'home-refresh',expires_at:4102444800,user:{id:owner,email:'home@example.org'}}));
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-calendar',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('action')==='events'?{connected:true,events:[]}:{connected:true,calendars:[]})});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_assignees',route=>json(route,orgs.map(o=>({organization_id:o.id,user_id:owner}))));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',async route=>{
   const req=route.request(),q=new URL(req.url()).searchParams;
   if(req.method()==='POST'){const b=req.postDataJSON();db.posts.push(b);const row={id:uid(),created_at:'2026-11-17T01:00:05Z',detail_text:null,doc:null,end_day:null,source_kind:null,...b};db.records.push(row);return json(route,[row],201)}
   const org=q.get('organization_id')||'',ids=org.startsWith('eq.')?[org.slice(3)]:org.replace(/^in\.\(|\)$/g,'').split(',');
   return json(route,db.records.filter(r=>ids.includes(r.organization_id)));
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_report_line_marks',route=>json(route,route.request().method()==='GET'?db.marks:[],route.request().method()==='GET'?200:201));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_report_snapshots',route=>json(route,[]));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_weekly_org_lines',route=>json(route,[]));
  await page.route(/\/rest\/v1\/app_weekly_exec_requests(\?|$)/,route=>{
   if(route.request().method()!=='GET')return json(route,[]);
   const week=(new URL(route.request().url()).searchParams.get('week_start')||'').replace(/^eq\./,'');
   if(week!==W||!sites)return json(route,[]);
   const draft={v:1,rows:[],titles:[],proposed:{at:'2026-11-16T00:00:00.000Z',cells:[...orgs.map(o=>({section:'orgs',key:o.name,n:0,lines:[]})),...sites.map(([key,lines])=>({section:'sites',key,n:0,lines}))]}};
   return json(route,[{id:'d1',week_start:W,draft,draft_saved_at:stamp}]);
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_dispute_stages',route=>json(route,[{id:'st1',workspace_id:'w',name:'합성 쟁의조정',sort_order:1}]));
  await page.route(SB+'/functions/v1/ai-assist',route=>json(route,{ok:true,kind:route.request().postDataJSON().kind,skipped:true}));
 };
 const f=await openHome(page,{beforeLoad:before});
 return {f,db,biz,errors};
}
const report=page=>page.locator('#journalRoot [data-journal-week-report]');
const orgCol=page=>report(page).locator('[data-jwr-org]');
const bizCol=page=>report(page).locator('[data-jwr-biz]');
const orgRow=(scope,id)=>scope.locator(`[data-wl-org-row="${id}"]`);
const shown=row=>row.locator('.wl-cell > .rw-line');
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);

for(const width of [390,884,1280])test(`[하루] 이번 주 보고 표 두 개: 조직보고 쓰기 → 담당조직 전체 표·[주간 정리] 4.에 같은 글, 사업 지금 상황 → [주간 정리] 2. 1)에 같은 글 ${width}px`,async({page})=>{
 const {db,biz,errors}=await fixture(page,{width,records:[U(OA,'2026-11-17','합성 교섭 상견례')],now:[{id:'bn-1',workspace_id:'w',space_id:'child',week_start:'2026-11-09',body:'합성 지난주 상황',owner_text:'합성 담당',updated_at:stamp}]});
 // ① 주간보고 재료 자리 = 이번 주 보고(두 표). 예전 재료 묶음은 없다.
 await expect(report(page)).toBeVisible();
 await expect(page.locator('#journalRoot [data-journal-report]')).toHaveCount(0);
 await expect(report(page).locator('h4')).toHaveText('이번 주 보고');
 await expect(report(page).locator('[data-jwr-range]')).toHaveText('11.16. ~ 11.22.');
 await expect(orgCol(page).locator('h5')).toHaveText('4. 조직보고');
 await expect(bizCol(page).locator('h5')).toHaveText('2. 사업요약');
 await expect(shown(orgRow(orgCol(page),OA))).toHaveText([/11\.17\.합성 교섭 상견례/]);
 // 사업요약: 지난주(11.9) 지금 상황이 이번 주에 이어 보임(같은 사업요약 창).
 await expect(bizCol(page).locator('.biz-sum-table .biz-hand-line')).toHaveText(['합성 지난주 상황']);
 // 폭: 761px부터 좌우, 폰은 위아래.
 const [a,b]=await Promise.all([orgCol(page).boundingBox(),bizCol(page).boundingBox()]);
 if(width>=761){expect(Math.abs(a.y-b.y)).toBeLessThan(2);expect(b.x).toBeGreaterThan(a.x+a.width-1)}
 else expect(b.y).toBeGreaterThanOrEqual(a.y+a.height-1);
 expect(await noOverflow(page)).toBe(true);
 // ② 조직보고 [+ 쓰기] → 그 조직 기록 한 줄.
 await orgRow(orgCol(page),OB).locator(`[data-rw-add="${OB}"]`).click();
 const body=orgCol(page).locator('[data-rw-field="body"]');
 await expect(body).toBeFocused();
 await body.fill('합성 현안 설명회');await body.press('Enter');
 await expect(orgCol(page).locator('[data-wl-status]')).toHaveText('기록을 남겼어요.');
 expect(db.posts.at(-1)).toMatchObject({organization_id:OB,raw_text:'합성 현안 설명회',source_kind:'user'});
 await expect(shown(orgRow(orgCol(page),OB))).toHaveText([/합성 현안 설명회/]);
 // 사업 지금 상황 고치기 → 이번 주 행(지난주 행은 그대로).
 const cell=bizCol(page).locator('[data-bp-cell="progress"]').first();
 await cell.click();
 const field=bizCol(page).locator('[data-bp-field]');
 await expect(field).toBeFocused();
 await field.fill('합성 이번 주 상황');await field.press('Control+Enter');
 await expect(bizCol(page).locator('.biz-sum-table .biz-hand-line')).toHaveText(['합성 이번 주 상황']);
 expect(biz.writes.at(-1)).toMatchObject({m:'POST',space_id:'child',week_start:W,body:'합성 이번 주 상황'});
 expect(biz.now.find(r=>r.id==='bn-1').body).toBe('합성 지난주 상황');
 // ③ [주간 정리]: 4. = 같은 창(쓴 줄이 보임), 2. 1) = 같은 사업요약표(고친 글이 보임).
 await page.locator('#journalRoot [data-journal-mode="week"]').click();
 const orgs4=page.locator('#journalRoot [data-weekly-flow-cells="orgs"]');
 await expect(orgs4.locator('[data-rw-table]')).toBeVisible();
 await expect(shown(orgRow(orgs4,OB))).toHaveText([/합성 현안 설명회/]);
 await expect(shown(orgRow(orgs4,OA))).toHaveText([/합성 교섭 상견례/]);
 const sum=page.locator('#journalRoot [data-weekly-flow-cells="summary"]');
 await expect(sum.locator('.biz-sum-table .biz-hand-line')).toHaveText(['합성 이번 주 상황']);
 expect(await noOverflow(page)).toBe(true);
 // 담당조직 [전체 표]에도 같은 줄.
 await clickView(page,'team');
 await page.locator('#soTeamTabs').getByRole('tab',{name:'전체 표'}).click();
 await expect(shown(orgRow(page.locator('#soOverview'),OB))).toHaveText([/합성 현안 설명회/]);
 expect(errors).toEqual([]);
});

test('[주간 정리] 3. 2) 투쟁 사업장 칸 안 = 쟁의 단계 줄 + 같은 조직 기록(창), 4.의 그 조직은 참고 한 줄 1280',async({page})=>{
 const records=[U(OA,'2026-11-17','합성 교섭 상견례'),U(OA,'2026-11-03','합성 지난 기록'),U(OA,'2026-09-20','합성 오래된 기록'),U(OB,'2026-11-18','합성 나 지회 소식')];
 const {errors}=await fixture(page,{width:1280,records,sites:[['합성 가 지부',['- 합성 쟁의조정(11.2)','- 예전 칸 줄']]]});
 await page.locator('#journalRoot [data-journal-mode="week"]').click();
 const site=page.locator(`#journalRoot [data-weekly-flow-cells="sites"] [data-flow-site-window="${OA}"]`);
 await expect(site).toBeVisible();
 // 창 안 줄이 3줄이 안 되면 창 이전 기록으로 채운다(3~7줄), 예전 칸 글 줄은 쓰지 않는다.
 await expect(site.locator('.wl-cell > .rw-line')).toHaveText([/9\.20\.합성 오래된 기록/,/11\.3\.합성 지난 기록/,/11\.17\.합성 교섭 상견례/]);
 await expect(site).not.toContainText('예전 칸 줄');
 await expect(site.locator(`[data-rw-add="${OA}"]`)).toBeVisible();
 // 4.: 3장에 들어간 조직은 '투쟁 사업장 보고 참고' 한 줄, 다른 조직은 창 줄.
 const orgs4=page.locator('#journalRoot [data-weekly-flow-cells="orgs"]');
 await expect(orgRow(orgs4,OA).locator('[data-wl-site-ref]')).toHaveText('- 투쟁 사업장 보고 참고');
 await expect(shown(orgRow(orgs4,OB))).toHaveText([/합성 나 지회 소식/]);
 expect(errors).toEqual([]);
});
