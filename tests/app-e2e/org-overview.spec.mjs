import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// ORG-기록하나로 O-4(설계 docs/design/record-one.md 2-5~2-9·4절): 담당조직 [전체 표] '이번 주 조직보고' = 조직보고 창(record-window-view.js).
// 조직 칸 = 지난 3주~앞 2주의 조직 기록 줄 + 그 조직과 연결된 구글 캘린더 일정 줄(작은 '일정'), 조직당 7줄·'지난 기록 n' 접기·[넣기],
// 줄 ⋯ [보고용으로 수정]·[보고에서 빼기](뺀 줄 n·되돌리기, 다음 주에도 빠짐)·[기록 열기], [+ 쓰기] = 그 조직 기록 한 줄.
// 확정한 주 = 개인 확정본 사진 + 흐린 '확정 뒤 추가'. 전환 주(11.9) 앞 = 옛 주별 조직보고 표 읽기 전용. 서버는 가짜, 이름은 모두 합성 값.
// 시계는 2026-11-17(화) → 이번 주 = 11.16~11.22(옛 주 시험만 2026-10-06).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test',W='2026-11-16',NOW='2026-11-17T01:00:00Z';
const OA='0a0a0a0a-0000-4000-8000-00000000000a',OB='0b0b0b0b-0000-4000-8000-00000000000b';
const orgs=[{id:OA,workspace_id:'w',name:'합성 가 지부',aliases:[],active:true,created_by:owner,updated_at:stamp},{id:OB,workspace_id:'w',name:'합성 나 지회',aliases:[],active:true,created_by:owner,updated_at:stamp}];
let n=0;const uid=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
const U=(org,day,text,x={})=>({id:uid(),organization_id:org,raw_text:text,occurred_at:`${day}T12:00:00+09:00`,end_day:null,source_kind:null,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z',workspace_id:'w',created_by:owner,detail_text:null,doc:null,...x});
const EV=(id,start,title,x={})=>({id,title,start,end:null,allDay:true,calendarId:'primary',organizationIds:[],htmlLink:'',...x});
async function fixture(page,{width,records=[],marks=[],snaps=[],events=[],calFail=false,old=null,order=null}={}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await installViewPrefsServer(page,null);
 // 앱이 처음부터 이 시계로 뜨게(공용 openHome은 10.6으로 고정한다 — 옛 주 시험만 그대로). 가짜 로그인 만료(10.7)는 토큰 갱신 답을 먼 뒤로 줘서 맞춘다.
 if(!old){
  const set=page.clock.setFixedTime.bind(page.clock);page.clock.setFixedTime=()=>set(new Date(NOW));
 }
 const f=await openHome(page,{beforeLoad:old?null:()=>page.route(u=>u.origin===SB&&u.pathname==='/auth/v1/token',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:'home-access',refresh_token:'home-refresh',expires_at:4102444800,user:{id:owner,email:'home@example.org'}})}))});
 const db={records:records.map(r=>({...r})),marks:marks.map(m=>({...m})),posts:[],markWrites:[],cal:[]};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',async route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='POST'){const b=req.postDataJSON();db.posts.push(b);const row={id:uid(),created_at:'2026-11-17T01:00:05Z',detail_text:null,doc:null,end_day:null,source_kind:null,...b};db.records.push(row);return json(route,[row],201)}
  const org=q.get('organization_id')||'',ids=org.startsWith('eq.')?[org.slice(3)]:org.replace(/^in\.\(|\)$/g,'').split(',');
  return json(route,db.records.filter(r=>ids.includes(r.organization_id)));
 });
 for(const t of ['app_notes','app_record_links','app_org_status_rows'])await page.route(u=>u.origin===SB&&u.pathname===`/rest/v1/${t}`,route=>json(route,[]));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_report_line_marks',async route=>{
  const req=route.request(),q=new URL(req.url()).searchParams,m=req.method(),eq=k=>(q.get(k)||'').replace(/^eq\./,'');
  if(m==='GET'){const lte=(q.get('week_start')||'').replace(/^lte\./,'');return json(route,db.marks.filter(r=>r.week_start<=lte))}
  if(m==='POST'){const b=req.postDataJSON();db.markWrites.push({m,...b});const row={id:uid(),report_body:null,choice:null,detail:null,updated_at:NOW,...b};db.marks.push(row);return json(route,[row],201)}
  if(m==='PATCH'){const b=req.postDataJSON();db.markWrites.push({m,id:eq('id'),...b});const hit=db.marks.filter(r=>r.id===eq('id'));hit.forEach(r=>Object.assign(r,b));return json(route,hit)}
  if(m==='DELETE'){db.markWrites.push({m,id:eq('id')});db.marks=db.marks.filter(r=>r.id!==eq('id'));return route.fulfill({status:204,body:''})}
  return json(route,{message:'no'},405);
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_report_snapshots',route=>{const q=new URL(route.request().url()).searchParams.get('week_start')||'';return json(route,snaps.filter(s=>q.includes(s.week_start)))});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_weekly_org_lines',route=>json(route,old||[]));
 await page.route(/\/rest\/v1\/app_weekly_exec_requests(\?|$)/,route=>{
  if(route.request().method()!=='GET')return json(route,[]);
  const draft=order?{v:1,rows:[],titles:[],proposed:{at:'2026-11-16T00:00:00.000Z',cells:order.map(k=>({section:'orgs',key:k,n:0,lines:[]}))}}:null;
  return json(route,draft?[{id:'d1',draft,draft_saved_at:stamp}]:[]);
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-calendar',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.get('action')!=='events')return json(route,{connected:true,calendars:[]});
  db.cal.push(q.get('timeMin')+'~'+q.get('timeMax'));
  if(calFail)return json(route,{message:'calendar down'},502);
  const from=Date.parse(q.get('timeMin')),to=Date.parse(q.get('timeMax'));
  return json(route,{connected:true,events:events.filter(e=>{const t=Date.parse(`${e.start}T00:00:00+09:00`);return t>=from&&t<to})});
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
const oa=page=>page.locator(`#soOverview [data-wl-org-row="${OA}"]`);
const ob=page=>page.locator(`#soOverview [data-wl-org-row="${OB}"]`);
const status=page=>page.locator('#soOverview [data-wl-status]');
const shown=row=>row.locator('.wl-cell > .rw-line');
async function menu(page,row,text,item){
 const line=row.locator('.wl-cell > .rw-line',{hasText:text});
 await line.locator('summary').click();
 await line.locator('.row-more').getByText(item,{exact:true}).click();
}

for(const width of [390,884,1280])test(`[전체 표] 조직보고 창: 쓰기 → 그 주 칸, 빼기 → 뺀 줄 n, 되돌리기, 일정 줄 ${width}px`,async({page})=>{
 const records=[U(OA,'2026-11-17','합성 교섭 상견례'),U(OA,'2026-11-02','합성 찬반투표',{end_day:'2026-12-05'}),U(OA,'2026-10-20','합성 창 밖 줄')];
 const events=[EV('ev1','2026-11-25','합성 가 지부 대의원대회')];
 const {db,errors}=await fixture(page,{width,records,events});
 await openTable(page);
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('11.16~11.22');
 const ev=oa(page).locator('.rw-line[data-rw-kind="event"]');
 await expect(ev).toContainText('합성 가 지부 대의원대회');
 await expect(ev.locator('.rw-tag')).toHaveText('일정');
 await expect(shown(oa(page))).toHaveCount(3);
 await expect(oa(page)).not.toContainText('합성 창 밖 줄');
 await expect(shown(oa(page)).first().locator('.wl-day')).toHaveText('- 11.2.~12.5.');
 await expect(page.locator('#soOverview')).not.toContainText('AI로 채우기');
 // [+ 쓰기] → 그 조직 기록 한 줄(오늘 날짜, source_kind user) → 그 주 칸에 보임.
 await ob(page).locator(`[data-rw-add="${OB}"]`).click();
 const body=page.locator('#soOverview [data-rw-field="body"]');
 await expect(body).toBeFocused();
 await expect(page.locator('#soOverview [data-rw-field="day"]')).toHaveValue('2026-11-17');
 await body.fill('합성 현안 설명회');await body.press('Enter');
 await expect(status(page)).toHaveText('기록을 남겼어요.');
 expect(db.posts.at(-1)).toMatchObject({organization_id:OB,raw_text:'합성 현안 설명회',occurred_at:'2026-11-17T12:00:00+09:00',source_kind:'user'});
 expect(db.posts.at(-1).source_id).toBeUndefined();
 await expect(shown(ob(page))).toHaveText([/11\.17\.합성 현안 설명회/]);
 // 빼기 → '뺀 줄 1', 그 주 표시 한 행(choice out).
 await menu(page,oa(page),'합성 교섭 상견례','보고에서 빼기');
 await expect(status(page)).toHaveText('이번 주부터 보고에서 뺐어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',workspace_id:'w',week_start:W,section:'org',ref_kind:'org_update',choice:'out'});
 await expect(shown(oa(page))).toHaveCount(2);
 const outBtn=oa(page).locator('[data-rw-fold="out"]');
 await expect(outBtn).toContainText('뺀 줄 1');
 await outBtn.click();
 await oa(page).locator('[data-rw-back]').click();
 await expect(status(page)).toHaveText('보고에 다시 넣었어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'DELETE'});
 await expect(shown(oa(page))).toHaveCount(3);
 await expect(oa(page).locator('[data-rw-fold="out"]')).toHaveCount(0);
 // 보고용으로 수정 → ✓, 원래 기록은 그대로.
 await menu(page,oa(page),'합성 교섭 상견례','보고용으로 수정');
 await expect(body).toBeFocused();
 await body.fill('합성 교섭 상견례(보고용)');await body.press('Enter');
 await expect(status(page)).toHaveText('저장했어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',report_body:'합성 교섭 상견례(보고용)'});
 await expect(oa(page).locator('.rw-line',{hasText:'(보고용)'}).locator('.rw-ok')).toHaveCount(1);
 expect(db.records.find(r=>r.raw_text==='합성 교섭 상견례')).toBeTruthy();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

test('[전체 표] 7줄 상한: 넘친 지난 줄은 지난 기록 n에서 [넣기], 앞 주 표에 있던 줄은 흐린 지난주',async({page})=>{
 const days=['2026-11-13','2026-11-11','2026-11-09','2026-11-05','2026-11-03','2026-10-30','2026-10-28','2026-10-27'];
 const records=[U(OA,'2026-11-18','합성 이번 주'),...days.map((d,i)=>U(OA,d,'합성 지난 줄 '+i))];
 const {db,errors}=await fixture(page,{width:1280,records});
 await openTable(page);
 await expect(shown(oa(page))).toHaveCount(7);
 const more=oa(page).locator('[data-rw-fold="folded"]');
 await expect(more).toContainText('지난 기록 2');
 await expect(shown(oa(page)).filter({hasText:'합성 지난 줄 0'}).locator('.rw-last')).toHaveText('지난주');
 await more.click();
 await oa(page).locator('.rw-fold [data-rw-in]').first().click();
 await expect(status(page)).toHaveText('보고에 넣었어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',choice:'in',section:'org'});
 await expect(shown(oa(page))).toHaveCount(8);
 expect(errors).toEqual([]);
});

test('[전체 표] 일정: 빼면 다음 주에도 빠짐 · 기록과 같은 일은 일정 줄 감춤 · 같은 주 다시 열어도 일정 읽기 한 번',async({page})=>{
 const records=[U(OA,'2026-11-19','합성 가 지부 집회 참석')];
 const events=[EV('ev2','2026-11-19','합성 가 지부 집회'),EV('ev3','2026-11-24','공동 일정',{organizationIds:[OB]})];
 const {db,errors}=await fixture(page,{width:1280,records,events});
 await openTable(page);
 const ev=ob(page).locator('.wl-cell > .rw-line[data-rw-kind="event"]');
 await expect(ev).toContainText('공동 일정');
 await expect(oa(page).locator('.rw-line[data-rw-kind="event"]')).toHaveCount(0);
 await menu(page,ob(page),'공동 일정','보고에서 빼기');
 await expect(status(page)).toHaveText('이번 주부터 보고에서 뺐어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',ref_kind:'event',ref_key:'ev3',choice:'out'});
 await expect(ev).toHaveCount(0);
 await page.locator('#soOverview [data-week-step="1"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('11.23~11.29');
 await expect(ob(page).locator('[data-rw-fold="out"]')).toContainText('뺀 줄 1');
 await expect(ev).toHaveCount(0);
 await page.locator('#soOverview [data-week-step="0"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('11.16~11.22');
 await expect(ob(page).locator('[data-rw-fold="out"]')).toContainText('뺀 줄 1');
 // 목록 → 전체 표 다시: 같은 주 일정은 5분 안에 다시 읽지 않는다.
 const before=db.cal.length;
 await page.locator('#soTeamTabs').getByRole('tab',{name:'목록'}).click();
 await page.locator('#soTeamTabs').getByRole('tab',{name:'전체 표'}).click();
 await expect(ob(page).locator('[data-rw-fold="out"]')).toContainText('뺀 줄 1');
 expect(db.cal.length).toBe(before);
 expect(errors).toEqual([]);
});

test('[전체 표] 일정을 못 읽어도 기록 줄은 보임',async({page})=>{
 const {errors}=await fixture(page,{width:390,records:[U(OA,'2026-11-17','합성 교섭 상견례')],calFail:true});
 await openTable(page);
 await expect(page.locator('#soOverview [data-rw-note]')).toHaveText('일정을 못 읽었어요');
 await expect(shown(oa(page))).toHaveCount(1);
 expect(errors).toEqual([]);
});

test('[전체 표] 확정한 주 = 개인 확정본 사진 + 흐린 확정 뒤 추가(고칠 수 없음)',async({page})=>{
 const a=U(OA,'2026-11-11','합성 확정 전 줄',{created_at:'2026-11-10T00:00:00Z'}),b=U(OA,'2026-11-12','합성 확정 뒤 줄',{created_at:'2026-11-14T00:00:00Z'});
 const snaps=[{week_start:'2026-11-09',confirmed_at:'2026-11-13T09:00:00Z',rows:[{section:'org',ref_kind:'org',ref_key:OA,lines:[{ref_kind:'org_update',ref_key:a.id,day:'2026-11-11',text:'합성 보고한 글'}],seen_events:[]}]}];
 const {errors}=await fixture(page,{width:884,records:[a,b],snaps});
 await openTable(page);
 await page.locator('#soOverview [data-week-step="-1"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('11.9~11.15');
 await expect(page.locator('#soOverview [data-rw-note]')).toHaveText('개인 확정본 11.13.');
 await expect(oa(page).locator('.wl-cell > .rw-line:not(.rw-after)')).toHaveText([/합성 보고한 글/]);
 await expect(oa(page).locator('.rw-after')).toContainText('합성 확정 뒤 줄');
 await expect(oa(page).locator('.rw-after .rw-after-tag')).toHaveText('확정 뒤 추가');
 await expect(oa(page).locator('summary')).toHaveCount(0);
 await expect(page.locator('#soOverview [data-rw-add]')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('[전체 표] 전환 주 앞(옛 주)은 옛 주별 조직보고 표 읽기 전용',async({page})=>{
 const L=(id,org,day,body,state='in')=>({id,organization_id:org,week_start:'2026-10-05',day,end_day:null,body,sort_order:0,state,origin:'user',edited:false,source_update_ids:[],source_note_ids:[],source_status_ids:[],updated_at:stamp});
 const {errors}=await fixture(page,{width:1280,old:[L('l1',OA,'2026-10-06','합성 옛 넣은 줄'),L('l2',OA,'2026-10-07','합성 옛 제안','suggested')]});
 await openTable(page);
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('10.5~10.11');
 await expect(page.locator('#soOverview [data-rw-note]')).toHaveText('옛 보고');
 await expect(shown(oa(page))).toHaveText([/10\.6\.합성 옛 넣은 줄/]);
 await expect(oa(page)).not.toContainText('합성 옛 제안');
 await expect(page.locator('#soOverview [data-rw-add]')).toHaveCount(0);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`[전체 표] 주간보고 조직보고 표와 같은 모양(조직 | 조직현황 칸 선) ${width}px`,async({page})=>{
 const {errors}=await fixture(page,{width,records:[U(OA,'2026-11-17','합성 교섭 상견례')]});
 await openTable(page);
 await expect(page.locator('#soOverview [data-rw-note]')).toHaveCount(0); // 일정 읽기가 끝나 다시 그린 뒤 잰다
 const table=page.locator('#soOverview table.wl-table');
 await expect(table).toHaveCount(1);
 await expect(table.locator('thead th')).toHaveText(['조직','이번 주 조직보고']);
 const cell=oa(page).locator('td.wl-c-rows'),head=oa(page).locator('th.wl-c-org');
 await expect(cell).toHaveCSS('border-top-width','1px');await expect(head).toHaveCSS('border-top-width','1px');
 await expect(oa(page).locator('.wl-day').first()).toHaveText('- 11.17.');
 const [h,c]=await Promise.all([head.boundingBox(),cell.boundingBox()]);
 if(width>760){expect(c.x).toBeGreaterThanOrEqual(h.x+h.width-1);expect(Math.abs(c.y-h.y)).toBeLessThan(2);}
 else{expect(c.y).toBeGreaterThanOrEqual(h.y+h.height-2);expect(Math.abs(c.x-h.x)).toBeLessThan(2);expect(c.width).toBeGreaterThan(300);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

test('[전체 표] 조직 순서 = 주간보고(개인본) 순서, 바탕이 없으면 앱 조직 순서',async({page})=>{
 const {errors}=await fixture(page,{width:1280,order:['합성 나 지회','합성 가 지부']});
 await openTable(page);
 await expect(page.locator('#soOverview tbody tr')).toHaveCount(2);
 await expect(page.locator('#soOverview tbody tr').first()).toHaveAttribute('data-wl-org-row',OB);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`[전체 표] 줄 ⋯ [기록 열기] → 조직 상세의 그 기록 ${width}px`,async({page})=>{
 const rec=U(OA,'2026-11-17','합성 선전전 원래 기록');
 const {errors}=await fixture(page,{width,records:[rec]});
 await openTable(page);
 await menu(page,oa(page),'합성 선전전 원래 기록','기록 열기');
 const row=page.locator(`#wdUpdates [data-wd-up="${rec.id}"]`);
 await expect(row).toBeVisible();
 await expect(row).toContainText('합성 선전전 원래 기록');
 await expect.poll(()=>row.evaluate(e=>e.hasAttribute('data-journal-flash')||e.getAnimations().length>0)).toBe(true);
 expect(errors).toEqual([]);
});

// RECORD-한줄 ①: 긴 기록(붙여 넣은 회의록·마크다운·표 기호)은 표에 한 줄만, 기호 없이. ⋯ [원문 보기] = 원문 그대로(작은 창, 읽기만).
for(const width of [390,1280])test(`[전체 표] 긴 기록은 한 줄 + ⋯ [원문 보기] ${width}px`,async({page})=>{
 const RAW='## 합성 쟁의대책회의 결과 요약 (11.16)\n\n### 1. 핵심 회의 결과\n- 합성 경고파업 추진 방향으로 의견을 모음&#x20;\n\n| 구분 | 내용 |\n|---|---|\n| 교섭 | 합성 근속승진 |\n'+'합성 문장 '.repeat(30);
 const rec=U(OA,'2026-11-17',RAW);
 const {db,errors}=await fixture(page,{width,records:[rec]});
 await openTable(page);
 const line=shown(oa(page));
 await expect(line).toHaveCount(1);
 await expect(line.locator('.wl-text')).toHaveText('합성 쟁의대책회의 결과 요약 (11.16)…');
 expect((await oa(page).locator('.wl-cell').textContent())||'').not.toMatch(/##|\||&#x20;|합성 근속승진/);
 await menu(page,oa(page),'합성 쟁의대책회의','원문 보기');
 const sheet=page.locator('#kptuRecordSheet');
 await expect(sheet).toBeVisible();
 await expect(sheet.locator('[data-record-sheet-title]')).toHaveText('원문');
 await expect(sheet.locator('[data-record-sheet-meta]')).toContainText('합성 가 지부');
 await expect(sheet.locator('[data-record-sheet-text]')).toContainText('합성 근속승진');
 await expect(sheet.locator('[data-record-sheet-full]')).toBeHidden();
 await page.keyboard.press('Escape');
 await expect(sheet).toBeHidden();
 expect(db.records[0].raw_text).toBe(RAW); // 원문은 그대로
 expect(db.posts).toEqual([]);expect(db.markWrites).toEqual([]);
 expect(errors).toEqual([]);
});

// UI-줄⋯공용맞추기(요청함 11/09 07:36): 줄 ⋯ 는 글 오른쪽 위(첫 줄 높이), ▶·▼ 펼침 표시 없음, 눌러 나오는 메뉴는 줄 높이를 늘리지 않는 작은 메뉴.
for(const width of [390,1280])test(`[전체 표] 줄 ⋯ 는 긴 글에서도 글 오른쪽 위, 펼침 표시 없음, 메뉴가 줄을 밀지 않음 ${width}px`,async({page})=>{
 const long='합성 아주 긴 기록 '.repeat(24);
 const rec=U(OA,'2026-11-17',long);
 const {errors}=await fixture(page,{width,records:[rec]});
 await openTable(page);
 const line=oa(page).locator('.wl-cell > .rw-line').first();
 const text=line.locator('.wl-text'),sum=line.locator('summary');
 await expect(sum).toBeVisible();
 await expect.poll(()=>sum.evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(20);
 const {tb,sb,lb}=await line.evaluate(l=>{const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}};return{tb:r(l.querySelector('.wl-text')),sb:r(l.querySelector('summary')),lb:r(l)}});
 expect(lb.height).toBeGreaterThan(sb.height*2); // 글이 여러 줄이어도
 expect(sb.y+sb.height/2).toBeLessThan(lb.y+sb.height); // ⋯ 는 줄 맨 위(첫 줄 높이)
 expect(sb.y+sb.height).toBeLessThan(tb.y+tb.height/2);
 expect(Math.abs((sb.x+sb.width)-(lb.x+lb.width))).toBeLessThan(6);
 const mark=await sum.evaluate(e=>({d:getComputedStyle(e).display,ls:getComputedStyle(e).listStyleType,wk:getComputedStyle(e,'::-webkit-details-marker').display,m:getComputedStyle(e,'::marker').content}));
 expect(mark.ls).toBe('none');expect(['none','""','normal']).toContain(mark.m);
 const before=lb.height;
 await sum.click();
 const menu=line.locator('.row-more-menu');
 await expect(menu).toBeVisible();
 expect((await line.boundingBox()).height).toBe(before);
 const mb=await menu.boundingBox();
 expect(mb.y).toBeGreaterThanOrEqual(sb.y+sb.height-8);
 expect(Math.abs((mb.x+mb.width)-(sb.x+sb.width))).toBeLessThan(6);
 const btn=await menu.locator('button').first().evaluate(e=>({b:getComputedStyle(e).borderTopWidth,fs:parseFloat(getComputedStyle(e).fontSize),fw:+getComputedStyle(e).fontWeight}));
 expect(btn.b).toBe('0px');expect(btn.fs).toBeLessThanOrEqual(14);expect(btn.fw).toBeLessThanOrEqual(500);
 expect(errors).toEqual([]);
});
