import {test,expect} from '@playwright/test';
import {openHome,defaultStageRows} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
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
async function fixture(page,{width,records=[],marks=[],snaps=[],events=[],calFail=false,old=null,order=null,prefsOpts={},dayNoneOff=false,orgList=orgs}={}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await installViewPrefsServer(page,null,prefsOpts);
 // 앱이 처음부터 이 시계로 뜨게(공용 openHome은 10.6으로 고정한다 — 옛 주 시험만 그대로). 가짜 로그인 만료(10.7)는 토큰 갱신 답을 먼 뒤로 줘서 맞춘다.
 if(!old){
  const set=page.clock.setFixedTime.bind(page.clock);page.clock.setFixedTime=()=>set(new Date(NOW));
 }
 const f=await openHome(page,{beforeLoad:old?null:()=>page.route(u=>u.origin===SB&&u.pathname==='/auth/v1/token',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:'home-access',refresh_token:'home-refresh',expires_at:4102444800,user:{id:owner,email:'home@example.org'}})}))});
 const db={records:records.map(r=>({...r})),marks:marks.map(m=>({...m})),posts:[],markWrites:[],cal:[],deletes:[]};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgList.filter(o=>'eq.'+o.id===id):orgList)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgList.map(o=>({organization_id:o.id,user_id:owner})))});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',async route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='POST'){const b=req.postDataJSON();db.posts.push(b);const row={id:uid(),created_at:'2026-11-17T01:00:05Z',detail_text:null,doc:null,end_day:null,source_kind:null,...b};db.records.push(row);return json(route,[row],201)}
  if(req.method()==='DELETE'){const id=(q.get('id')||'').replace(/^eq\./,''),org=(q.get('organization_id')||'').replace(/^eq\./,'');db.deletes.push({id,org,select:q.get('select'),prefer:req.headers()['prefer']||''});const hit=db.records.filter(r=>r.id===id&&r.organization_id===org);db.records=db.records.filter(r=>!hit.includes(r));return json(route,hit.map(r=>({id:r.id})))}
  if(req.method()==='PATCH'){const b=req.postDataJSON(),id=(q.get('id')||'').replace(/^eq\./,'');db.patches=[...(db.patches||[]),{id,...b}];const hit=db.records.filter(r=>r.id===id);hit.forEach(r=>Object.assign(r,b));return json(route,hit)}
  if(dayNoneOff&&(q.get('select')||'').includes('day_none'))return json(route,{code:'42703',message:'column app_suborganization_updates.day_none does not exist'},400);
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
// 표가 다 그려짐(STAB S58-7). [전체 표]는 읽기가 하나 끝날 때마다 표를 통째로 다시 그린다(app/org-overview.js paint → put):
//  ① 기록 읽기 → 표가 보임(그 순간 일정 읽기가 시작돼 표 위에 작은 '일정 …' 줄이 함께 뜬다) ② 일정 읽기 → 그 줄이 없어짐
//  ③ 쟁의 단계 읽기 → 조직 이름 밑에 단계 글자가 붙음(①보다 먼저 올 수도, ②보다 늦을 수도 있다).
// 다시 그리면 그 전에 잡은 요소는 화면에서 빠져 boundingBox()가 null이다. 크기·자리를 재는 시험은 셋이 다 끝난 화면을 기다린 뒤 잰다.
// 전에는 '일정 줄이 없다'만 봤는데, 표가 그려지기 전(자리표시)에도 그 줄은 없어서 그냥 통과했다 — 반드시 표가 보인 뒤에 본다.
async function tableDrawn(page){
 await expect(page.locator('#soOverview table.wl-table')).toBeVisible();
 await expect(page.locator('#soOverview [data-rw-note]')).toHaveCount(0);
 await expect(page.locator('#soOverview tbody .wl-stage').first()).toBeVisible();
}
const oa=page=>page.locator(`#soOverview [data-wl-org-row="${OA}"]`);
const ob=page=>page.locator(`#soOverview [data-wl-org-row="${OB}"]`);
const status=page=>page.locator('#soOverview [data-wl-status]');
const shown=row=>row.locator('.wl-cell > .rw-line');
// 지난 기록·뺀 줄(펼친 .rw-fold 안) 줄 ⋯ 메뉴 항목 누르기. text가 비면 첫 줄.
async function foldMenu(row,text,item){
 const line=row.locator('.rw-fold .rw-line',text?{hasText:text}:{}).first();
 await line.locator('summary').click();
 await line.locator('.row-more').getByText(item,{exact:true}).click();
}
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
 // ORG-기록입력날짜: 날짜는 글 아래 작은 [오늘 ▾] 칩(누르기 전에는 달력 칸이 없음)
 await expect(page.locator('#soOverview [data-rw-day-chip]')).toHaveText(/^오늘/);
 await expect(page.locator('#soOverview [data-rw-field="day"]')).toHaveCount(0);
 await body.fill('합성 현안 설명회');await body.press('Enter');
 await expect(status(page)).toHaveText('기록을 남겼어요.');
 expect(db.posts.at(-1)).toMatchObject({organization_id:OB,raw_text:'합성 현안 설명회',occurred_at:'2026-11-17T12:00:00+09:00',source_kind:'user'});
 expect(db.posts.at(-1).source_id).toBeUndefined();
 await expect(shown(ob(page))).toHaveText([/11\.17\.합성 현안 설명회/]);
 // ORG-기록입력날짜: [오늘 ▾] → [하루|기간|없음] + 달력에서 11.18을 고르고 저장 → 그 날짜로 기록.
 await ob(page).locator(`[data-rw-add="${OB}"]`).click();
 await page.locator('#soOverview [data-rw-day-chip]').click();
 const pick=page.locator('#soOverview [data-rw-form="new-day"]');
 await expect(pick.locator('[data-rw-mode="day"]')).toHaveAttribute('aria-pressed','true');
 await pick.locator('[data-rw-field="day"]').fill('2026-11-18');
 await expect(page.locator('#soOverview [data-rw-day-chip]')).toHaveText(/^11\.18\./);
 await page.locator('#soOverview [data-rw-field="body"]').fill('합성 점검 회의');
 await page.locator('#soOverview [data-rw-save]').click();
 await expect(status(page)).toHaveText('기록을 남겼어요.');
 expect(db.posts.at(-1)).toMatchObject({organization_id:OB,raw_text:'합성 점검 회의',occurred_at:'2026-11-18T12:00:00+09:00',source_kind:'user'});
 // 빼기 → '뺀 줄 1', 그 주 표시 한 행(choice out).
 await menu(page,oa(page),'합성 교섭 상견례','보고에서 빼기');
 await expect(status(page)).toHaveText('이번 주부터 보고에서 뺐어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',workspace_id:'w',week_start:W,section:'org',ref_kind:'org_update',choice:'out'});
 await expect(shown(oa(page))).toHaveCount(2);
 const outBtn=oa(page).locator('[data-rw-fold="out"]');
 await expect(outBtn).toContainText('뺀 줄 1');
 await outBtn.click();
 await foldMenu(oa(page),'','되돌리기'); // ORG-뺀줄지난줄메뉴: 큰 단추 대신 줄 ⋯ 맨 위 [되돌리기]
 await expect(status(page)).toHaveText('보고에 다시 넣었어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'DELETE'});
 await expect(shown(oa(page))).toHaveCount(3);
 await expect(oa(page).locator('[data-rw-fold="out"]')).toHaveCount(0);
 // 보고용으로 수정 → 보고용 글이 보이고(✓ 표시는 없음, 명진 11/10 22:30), 원래 기록은 그대로.
 await menu(page,oa(page),'합성 교섭 상견례','보고용으로 수정');
 await expect(body).toBeFocused();
 await body.fill('합성 교섭 상견례(보고용)');await body.press('Enter');
 await expect(status(page)).toHaveText('저장했어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',report_body:'합성 교섭 상견례(보고용)'});
 await expect(oa(page).locator('.rw-line',{hasText:'(보고용)'})).toHaveCount(1);
 await expect(oa(page).locator('.rw-ok')).toHaveCount(0);
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
 await foldMenu(oa(page),'합성 지난 줄','넣기'); // 지난 기록 줄 ⋯ 맨 위 [넣기]
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

// ORG-폴드두열표(요청함 11/11, 시안 docs/design/mockups/org-table-fold-two-cols.html): 접은 폰(390)·폴드 펼침(690)·PC(1280) 모두 [조직 | 조직현황] 두 열 표.
// 예전에는 화면 760 이하(펼친 폴드 약 673~707px 포함)에서 한 조직을 두 줄로 쌓았다. 왼쪽 열: 600 이상은 가장 긴 이름 한 줄 폭, 600 미만은 좁게(7em) 고정.
for(const width of [390,690,1280])test(`[전체 표] 조직 | 조직현황 두 열 표(쌓지 않음, 머리줄·칸 선) ${width}px`,async({page})=>{
 const {errors}=await fixture(page,{width,records:[U(OA,'2026-11-17','합성 교섭 상견례')]});
 await openTable(page);
 await tableDrawn(page); // 기록·일정·쟁의 단계 읽기가 다 끝나 다시 그린 뒤 잰다
 const table=page.locator('#soOverview table.wl-table');
 await expect(table).toHaveCount(1);
 await expect(table.locator('thead')).toBeVisible();
 await expect(table.locator('thead th')).toHaveText(['조직','이번 주 조직보고']);
 const cell=oa(page).locator('td.wl-c-rows'),head=oa(page).locator('th.wl-c-org');
 await expect(cell).toHaveCSS('border-top-width','1px');await expect(head).toHaveCSS('border-top-width','1px');
 await expect(oa(page).locator('.wl-day').first()).toHaveText('- 11.17.');
 const [h,c]=await Promise.all([head.boundingBox(),cell.boundingBox()]);
 expect(c.x).toBeGreaterThanOrEqual(h.x+h.width-1); // 조직 칸 오른쪽에 조직현황 칸
 expect(Math.abs(c.y-h.y)).toBeLessThan(2); // 같은 줄(쌓지 않음)
 if(width<600){expect(h.width).toBeLessThan(130);expect(c.width).toBeGreaterThan(200);} // 접은 폰: 좁은 왼쪽 열, 글 칸은 넓게
 await expect(table.locator('thead .col-grip')).toBeVisible({visible:width>=600}); // 칸 끌기 손잡이는 폴드 펼침·PC만
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

// 긴 조직 이름: 폴드 펼침·PC는 한 줄(왼쪽 열을 이름에 맞춤, 표 폭 45% 안), 접은 폰은 좁은 왼쪽 열에서 두 줄 이상으로 꺾임.
// 표 폭 45%보다 긴 이름은 칸 안에서 꺾이고 옆으로 넘치지 않는다.
const OC='0c0c0c0c-0000-4000-8000-00000000000c',OD='0d0d0d0d-0000-4000-8000-00000000000d';
const LONG_NAME='합성 도시철도 노동조합 연합 지부',OVER_NAME='합성 '+'아주긴이름'.repeat(9);
const longOrgs=()=>[...orgs,{id:OC,workspace_id:'w',name:LONG_NAME,aliases:[],active:true,created_by:owner,updated_at:stamp},{id:OD,workspace_id:'w',name:OVER_NAME,aliases:[],active:true,created_by:owner,updated_at:stamp}];
const textLines=loc=>loc.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const ys=[];for(const b of r.getClientRects()){if(b.width<1)continue;if(!ys.some(y=>Math.abs(y-b.y)<3))ys.push(b.y)}return ys.length});
for(const width of [390,690,1280])test(`[전체 표] 긴 조직 이름: 폴드·PC 한 줄(열이 이름에 맞음), 접은 폰은 두 줄 꺾임, 너무 긴 이름은 칸 안에서 꺾임 ${width}px`,async({page})=>{
 const {errors}=await fixture(page,{width,orgList:longOrgs(),records:[U(OC,'2026-11-17','합성 교섭 상견례')]});
 await openTable(page);
 await tableDrawn(page);
 const name=page.locator(`#soOverview [data-oa-open="${OC}"]`),over=page.locator(`#soOverview [data-oa-open="${OD}"]`),head=page.locator('#soOverview thead th.wl-c-org'),table=page.locator('#soOverview table.wl-table');
 const [n,hb,tb]=await Promise.all([name.boundingBox(),head.boundingBox(),table.boundingBox()]);
 if(width>=600){
  expect(await textLines(name)).toBe(1);
  expect(n.x+n.width).toBeLessThanOrEqual(hb.x+hb.width-1); // 이름이 왼쪽 열 안에 다 들어감
  expect(hb.width).toBeLessThanOrEqual(tb.width*0.45+2); // 열 폭은 표 폭의 45%까지
  expect(await textLines(over)).toBeGreaterThan(1); // 45%보다 긴 이름은 칸 안에서 꺾임(잘리지 않음)
  expect(hb.width).toBeGreaterThan(tb.width*0.45-6); // 그 이름 때문에 열이 45%까지 넓어짐
 }else{
  expect(hb.width).toBeLessThan(130);
  expect(await textLines(name)).toBeGreaterThan(1);
 }
 const ob=await over.boundingBox();expect(ob.x+ob.width).toBeLessThanOrEqual(hb.x+hb.width+1); // 옆 칸으로 넘치지 않음
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

// 끌어 정한 폭(서버 col_widths.orgall.org, 화면 종류별 꼬리: PC 없음 · 폴드 펼침 _f · 폰 _p)은 폴드·PC에서 그 폭을 쓰고, 폰에서는 어떤 값이 있어도 글 칸을 누르지 않는다(7em 고정).
for(const [width,key,px] of [[690,'org_f',300],[1280,'org',260],[390,'org_p',420]])test(`[전체 표] 끌어 정한 [조직] 열 폭 col_widths.orgall.${key}=${px} → ${width}px 화면`,async({page})=>{
 await installViewPrefsServer(page,{col_widths:{orgall:{org_f:300,org:260,org_p:420}}});
 const {errors}=await fixture(page,{width,records:[U(OA,'2026-11-17','합성 교섭 상견례')]});
 await openTable(page);
 await tableDrawn(page);
 const h=await page.locator('#soOverview thead th.wl-c-org').boundingBox(),c=await oa(page).locator('td.wl-c-rows').boundingBox();
 if(width>=600)expect(Math.abs(h.width-px)).toBeLessThan(14);
 else{expect(h.width).toBeLessThan(130);expect(c.width).toBeGreaterThan(200);} // 폰: 저장 값이 있어도 좁은 왼쪽 열
 expect(errors).toEqual([]);
});

// 사진: ORG_TABLE_SHOTS 폴더가 있으면 docs/design/screens/s57-15/ 용 사진을 남긴다(가짜 데이터). ORG_TABLE_SHOTS_PREFIX='before-'로 고치기 전 사진.
const TSHOTS=process.env.ORG_TABLE_SHOTS||'',TPREFIX=process.env.ORG_TABLE_SHOTS_PREFIX||'';
for(const width of [412,690,1280])test(`[전체 표] 화면 사진 ${width}px`,async({page})=>{
 test.skip(!TSHOTS,'사진을 남길 때만(ORG_TABLE_SHOTS)');
 const orgsX=[{id:OA,workspace_id:'w',name:'합성 가 지부',aliases:[],active:true,created_by:owner,updated_at:stamp},{id:OC,workspace_id:'w',name:LONG_NAME,aliases:[],active:true,created_by:owner,updated_at:stamp},{id:OB,workspace_id:'w',name:'합성 나 지회',aliases:[],active:true,created_by:owner,updated_at:stamp}];
 const records=[U(OA,'2026-11-17','합성 10시 점검 회의'),U(OA,'2026-11-18','합성 오후 관계 기관·사측·지부 3차 간담회 진행'),
  U(OC,'2026-11-16','합성 긴 줄 — 연구용역 추진 약속을 받아 농성을 마무리하고 다음 주 후속 협의 일정을 잡기로 함. 넘친 글은 날짜 오른쪽 자리에 맞춰 이어짐.'),U(OC,'2026-11-17','합성 찬반투표 결과 정리'),
  U(OB,'2026-11-17','합성 1차 본교섭 진행'),U(OB,'2026-11-18','합성 쟁의 없이 합의할 가능성 높음')];
 const {errors}=await fixture(page,{width,orgList:orgsX,records});
 const stages=defaultStageRows();
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_dispute_stages',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([
  {id:'h1',organization_id:OA,stage_id:stages[2].id,stage_name:stages[2].name,stage_date:'2026-10-06',created_at:'2026-10-06T00:00:00Z',end_date:null},
  {id:'h2',organization_id:OC,stage_id:stages[3].id,stage_name:stages[3].name,stage_date:'2026-11-05',created_at:'2026-11-05T00:00:00Z',end_date:null},
  {id:'h3',organization_id:OB,stage_id:stages[1].id,stage_name:stages[1].name,stage_date:'2026-10-22',created_at:'2026-10-22T00:00:00Z',end_date:null}])}));
 await openTable(page);
 await tableDrawn(page);
 await expect(page.locator('#soOverview .wl-stage').first()).toBeVisible();
 await page.screenshot({path:`${TSHOTS}/${TPREFIX}org-table-${width}.png`});
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
// RECORD-한줄AI요약(11/09 A안): 서버 AI 한 줄(one_line)이 있으면 표 한 줄은 그 값(제목·첫 줄이 아님), [원문 보기]는 원문 그대로. 없으면 임시 한 줄.
for(const width of [412,1280])test(`[전체 표] AI 한 줄이 있으면 요약 한 줄, 원문은 그대로 ${width}px`,async({page})=>{
 const RAW='[합성 공영화 투쟁 경과 공유 및 감사 인사]\n\n안녕하십니까. 합성 지부입니다.\n합성시는 공영화 연구용역을 직접 추진하기로 했고 내년 공영화를 위해 노력하겠다고 서약했습니다.\n연대해 주신 동지들께 감사드립니다.';
 const rec=U(OA,'2026-11-17',RAW,{one_line:'합성시 공영화 연구용역 직접 추진·내년 공영화 노력 서약, 연대 감사'}),rec2=U(OB,'2026-11-18',RAW);
 const {errors}=await fixture(page,{width,records:[rec,rec2]});
 await openTable(page);
 await expect(shown(oa(page)).locator('.wl-text')).toHaveText('합성시 공영화 연구용역 직접 추진·내년 공영화 노력 서약, 연대 감사');
 await expect(shown(ob(page)).locator('.wl-text')).toHaveText('[합성 공영화 투쟁 경과 공유 및 감사 인사]…');
 await menu(page,oa(page),'합성시 공영화','원문 보기');
 const sheet=page.locator('#kptuRecordSheet');
 await expect(sheet.locator('[data-record-sheet-text]')).toContainText('연대해 주신 동지들께 감사드립니다.');
 expect(errors).toEqual([]);
});

// ORG-기록날짜고치기(요청함 11/10, 시안 org-record-day-edit.html): 날짜 누름·줄 ⋯ [날짜 수정] → [하루|기간|없음] + 달력 → 원래 기록 날짜만 고침(글·보고용 표시 그대로).
for(const width of [412,1280])test(`[전체 표] 날짜 수정: 하루 11.17→11.18, 기간, 없음은 '-'만 ${width}px`,async({page})=>{
 const rec=U(OA,'2026-11-17','합성 3차 간담회 진행',{occurred_at:'2026-11-17T15:30:00+09:00',created_at:'2026-11-17T01:00:00Z'}),rec2=U(OB,'2026-11-18','합성 지회 점검 회의');
 const marks=[{id:'m-1',workspace_id:'w',week_start:W,section:'org',ref_kind:'org_update',ref_key:rec.id,report_body:'합성 3차 간담회(보고용)',choice:null,detail:null,updated_at:NOW}];
 const {db,errors}=await fixture(page,{width,records:[rec,rec2],marks});
 await openTable(page);
 const line=()=>shown(oa(page)).first();
 // ① 날짜 누름 → 하루(기본) → 11.18 저장
 await line().locator('.rw-day-btn').click();
 const form=oa(page).locator('[data-rw-day-form]');
 await expect(form).toBeVisible();
 await expect(form.locator('[data-rw-mode="day"]')).toHaveAttribute('aria-pressed','true');
 await expect(form.locator('[data-rw-field="day"]')).toHaveValue('2026-11-17');
 await form.locator('[data-rw-field="day"]').fill('2026-11-18');
 await form.locator('[data-rw-save]').click();
 await expect(status(page)).toHaveText('날짜를 바꿨어요.');
 expect(db.patches.at(-1)).toEqual({id:rec.id,occurred_at:'2026-11-18T15:30:00+09:00',end_day:null,day_none:false});
 await expect(line().locator('.wl-day')).toHaveText('- 11.18.');
 await expect(line().locator('.wl-text')).toHaveText('합성 3차 간담회(보고용)'); // 보고용 글 그대로
 expect(db.records.find(r=>r.id===rec.id).raw_text).toBe('합성 3차 간담회 진행'); // 글 그대로
 // ② 줄 ⋯ [날짜 수정] → 기간 11.16~11.19
 await menu(page,oa(page),'합성 3차 간담회','날짜 수정');
 await form.locator('[data-rw-mode="range"]').click();
 await expect(form.locator('[data-rw-mode="range"]')).toHaveAttribute('aria-pressed','true');
 await form.locator('[data-rw-field="day"]').fill('2026-11-16');
 await form.locator('[data-rw-field="end_day"]').fill('2026-11-19');
 await form.locator('[data-rw-save]').click();
 await expect(line().locator('.wl-day')).toHaveText('- 11.16.~11.19.');
 expect(db.patches.at(-1)).toMatchObject({occurred_at:'2026-11-16T15:30:00+09:00',end_day:'2026-11-19',day_none:false});
 // ③ 없음 → 쓴 날(11.17)에 두고 줄에는 '-'만
 await line().locator('.rw-day-btn').click();
 await form.locator('[data-rw-mode="none"]').click();
 await expect(form).toContainText('날짜 없이 보고에 넣어요. 쓴 주에 보여요.');
 await form.locator('[data-rw-save]').click();
 await expect(line().locator('.wl-day')).toHaveText('-');
 expect(db.patches.at(-1)).toMatchObject({occurred_at:'2026-11-17T15:30:00+09:00',end_day:null,day_none:true});
 // ④ 취소는 아무것도 안 씀, 초점은 날짜로
 const n=db.patches.length;
 await line().locator('.rw-day-btn').click();
 await form.locator('[data-rw-cancel]').click();
 await expect(form).toHaveCount(0);
 await expect(line().locator('.rw-day-btn')).toBeFocused();
 expect(db.patches.length).toBe(n);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});
test('[전체 표] 날짜 수정: DB 적용 전(day_none 칸 없음)이면 없음만 감추고 하루 수정은 됨',async({page})=>{
 const rec=U(OA,'2026-11-17','합성 3차 간담회 진행');
 const {db,errors}=await fixture(page,{width:412,records:[rec],dayNoneOff:true});
 await openTable(page);
 await expect(shown(oa(page))).toHaveCount(1);
 await shown(oa(page)).first().locator('.rw-day-btn').click();
 const form=oa(page).locator('[data-rw-day-form]');
 await expect(form.locator('[data-rw-mode]')).toHaveText(['하루','기간']);
 await form.locator('[data-rw-field="day"]').fill('2026-11-18');
 await form.locator('[data-rw-save]').click();
 await expect(shown(oa(page)).first().locator('.wl-day')).toHaveText('- 11.18.');
 expect(db.patches.at(-1)).toEqual({id:rec.id,occurred_at:'2026-11-18T12:00:00+09:00',end_day:null});
 expect(errors).toEqual([]);
});

// RECORD-보고용글잘림(요청함 11/10 ★급★): 직접 쓴 보고용 글은 60자로 자르지 않고 끝까지, [보고용으로 수정]을 다시 열면 글 전체가 칸에(잘린 글 아님).
for(const width of [412,1280])test(`[전체 표] 보고용 글은 끝까지 보이고 다시 열면 칸에 글 전체 ${width}px`,async({page})=>{
 const RAW='합성 임금교섭 결과 공유 회의를 열었다. '+'합성 원문 문장 '.repeat(12)+'원문 끝.';
 const LONG='합성 임금교섭 1차 결과: 기본급 인상안과 근속승진 기준을 지부와 함께 정리했고, 다음 교섭 전까지 조합원 설명회를 두 번 열기로 함. 마지막 문장까지 보고용.';
 const rec=U(OA,'2026-11-17',RAW),rec2=U(OB,'2026-11-18','합성 원문 '.repeat(20)+'둘째 원문 끝.');
 const marks=[{id:'m-long',workspace_id:'w',week_start:W,section:'org',ref_kind:'org_update',ref_key:rec.id,report_body:LONG,choice:null,detail:null,updated_at:NOW}];
 const {db,errors}=await fixture(page,{width,records:[rec,rec2],marks});
 await openTable(page);
 const line=shown(oa(page));
 await expect(line.locator('.wl-text')).toHaveText(LONG);
 await expect(line.locator('.rw-ok')).toHaveCount(0);
 // 다시 열면 칸에 보고용 글 전체 → 그대로 저장해도 뒷부분이 사라지지 않음(쓰기 없음)
 await menu(page,oa(page),'합성 임금교섭 1차 결과','보고용으로 수정');
 const body=page.locator('#soOverview [data-rw-field="body"]');
 await expect(body).toHaveValue(LONG);
 await body.press('Enter');
 await expect(line.locator('.wl-text')).toHaveText(LONG);
 expect(db.markWrites).toEqual([]);
 // 보고용 글이 없는 긴 원문 줄: 표에는 한 줄(…), 칸에는 원문 전체(… 없음)
 await expect(shown(ob(page)).locator('.wl-text')).toHaveText(/…$/);
 await menu(page,ob(page),'합성 원문','보고용으로 수정');
 await expect(body).toHaveValue(/둘째 원문 끝\.$/);
 await body.fill('합성 둘째 줄 보고용 '+'긴 글 '.repeat(20)+'끝까지');await body.press('Enter');
 await expect(status(page)).toHaveText('저장했어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'POST',report_body:'합성 둘째 줄 보고용 '+'긴 글 '.repeat(20)+'끝까지'});
 await expect(shown(ob(page)).locator('.wl-text')).toHaveText('합성 둘째 줄 보고용 '+'긴 글 '.repeat(20)+'끝까지');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

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
 // RECORD-한줄: 표 줄은 한 줄(60자 안팎)이라 PC 넓은 칸에서는 꺾이지 않는다. 좁은 칸(폴드·창 나눔)처럼 글 폭을 좁혀 여러 줄일 때 ⋯ 자리를 본다.
 await page.addStyleTag({content:'#soOverview .rw-line .wl-body{max-width:10em}'}); // ORG-줄바꿈날짜옆: 글·꼬리표는 내용 칸(.wl-body) 안에서 흐른다
 await openTable(page);
 await tableDrawn(page); // 메뉴를 연 뒤 표가 다시 그려지면 메뉴가 닫히고 잡아 둔 줄이 빠진다
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

// ORG-줄바꿈날짜옆(요청함 11/10 14:12 B안): 긴 줄도 날짜 바로 뒤에서 내용이 시작하고, 넘친 글의 둘째 줄은 내용 첫 글자 자리(날짜 오른쪽)에서 이어진다.
// 날짜는 한 덩어리(한 줄), ⋯ 는 줄 오른쪽 위 그대로, 꼬리표(일정·지난주)는 내용 칸 안. 폰 412는 실제 폭, 폴드·PC는 좁은 칸(창 나눔)처럼 칸 폭을 줄여 본다.
for(const width of [412,884,1280])test(`[전체 표] 긴 조직 줄: 날짜 옆에서 시작, 둘째 줄은 내용 첫 글자 자리 ${width}px`,async({page})=>{
 const rec=U(OA,'2026-11-17','합성 쟁의대책회의 — 다음 주 하루 경고 행동 추진 및 집중교섭 의견 모음과 일정 정리 결과 공유',{one_line:'합성 쟁의대책회의 — 다음 주 하루 경고 행동 추진 및 집중교섭 의견 모음과 일정 정리 결과 공유'});
 const marks=[{id:'m-ed',workspace_id:'w',week_start:W,section:'org',ref_kind:'org_update',ref_key:rec.id,choice:null,report_body:'합성 쟁의대책회의 — 다음 주 하루 경고 행동 추진 및 집중교섭 의견 모음과 일정 정리 결과 공유',detail:null,updated_at:'2026-11-16T00:00:00Z'}];
 const {errors}=await fixture(page,{width,records:[rec],marks});
 if(width>412)await page.addStyleTag({content:'#soOverview .wl-cell > .rw-line{max-width:22em}'});
 await openTable(page);
 const line=oa(page).locator('.wl-cell > .rw-line').first();
 await expect(line.locator('.wl-text')).toBeVisible();
 // 표는 일정·표시를 받은 뒤 한 번 더 그려진다 — 다 그려진(크기가 있는) 줄에서 잰다.
 const measure=()=>line.evaluate(l=>{
  const t=l.querySelector('.wl-text').firstChild,r=document.createRange();r.selectNodeContents(t);
  const rows=[];for(const b of r.getClientRects()){if(b.width<1)continue;const last=rows[rows.length-1];if(last&&Math.abs(last.y-b.y)<3)continue;rows.push({x:b.x,y:b.y})}
  const box=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}};
  return {rows,day:box(l.querySelector('.wl-day')),dayRects:l.querySelector('.wl-day').getClientRects().length,sum:box(l.querySelector('summary')),line:box(l)};
 });
 await expect.poll(async()=>(await measure()).rows.length,{timeout:8000}).toBeGreaterThan(1); // 긴 글이 여러 줄
 const g=await measure();
 expect(Math.abs(g.rows[0].y-g.day.y)).toBeLessThan(g.day.h); // 첫 줄은 날짜와 같은 줄(날짜 아래로 안 떨어짐)
 expect(g.rows[0].x).toBeGreaterThan(g.day.x+g.day.w-1); // 날짜 바로 오른쪽에서 시작
 for(const row of g.rows.slice(1))expect(Math.abs(row.x-g.rows[0].x)).toBeLessThan(1); // 둘째 줄부터 = 내용 첫 글자 x(날짜 아래는 빈칸)
 expect(g.dayRects).toBe(1); // 날짜는 한 덩어리
 expect(g.sum.y+g.sum.h/2).toBeLessThan(g.line.y+g.sum.h); // ⋯ 는 줄 오른쪽 위
 expect(Math.abs((g.sum.x+g.sum.w)-(g.line.x+g.line.w))).toBeLessThan(6);
 expect(errors).toEqual([]);
});

// ORG-줄순서(요청함 11/09, 명진 결정 14:21): 표 위 [⋯] '줄 순서' — 칸 안 줄·펼친 '지난 기록'·'뺀 줄'이 모두 고른 순서를 따르고, 서버 화면 설정(org_row_order)에 남아 새로고침 뒤에도 같다.
const ORDER_DAYS=['2026-11-13','2026-11-11','2026-11-09','2026-11-05','2026-11-03','2026-10-30','2026-10-28','2026-10-27','2026-10-26'];
const orderFixture=()=>{
 const records=[U(OA,'2026-11-18','합성 이번 주'),...ORDER_DAYS.map((d,i)=>U(OA,d,'합성 지난 줄 '+i))];
 const out=records[1];// 가장 최근 지난 줄 하나를 뺀 줄로
 const marks=[{id:'m-out',workspace_id:'w',week_start:W,section:'org',ref_kind:'org_update',ref_key:out.id,choice:'out',report_body:null,detail:null,updated_at:'2026-11-16T00:00:00Z'}];
 return {records,marks};
};
const dayTexts=loc=>loc.locator('.wl-day').allInnerTexts();
const asNum=t=>{const m=/(\d+)\.(\d+)\./.exec(t);return Number(m[1])*100+Number(m[2])};
const sortedBy=(list,dir)=>JSON.stringify(list.map(asNum))===JSON.stringify([...list.map(asNum)].sort((a,b)=>dir*(a-b)));
async function pickOrder(page,item){
 await page.locator('#soOverview .oa-bar .wl-tools summary').click();
 await page.locator('#soOverview .oa-bar .row-more-menu').getByText(item,{exact:true}).click();
}
for(const width of [390,884,1440])test(`[전체 표] 줄 순서 [⋯]: 최신 위로 → 칸 안·지난 기록·뺀 줄 모두 같은 순서, 새로고침 뒤에도 같음, 서버 화면 설정에 저장 ${width}px`,async({page})=>{
 const {records,marks}=orderFixture();
 const {errors}=await fixture(page,{width,records,marks});
 const prefs=await installViewPrefsServer(page,null);
 await openTable(page);
 const open=async()=>{
  await oa(page).locator('[data-rw-fold="folded"]').click();await oa(page).locator('[data-rw-fold="out"]').click();
  await expect(oa(page).locator('[data-rw-fold-box="folded"] .rw-line')).toHaveCount(2);await expect(oa(page).locator('[data-rw-fold-box="out"] .rw-line')).toHaveCount(1);
 };
 const read=async()=>({
  shown:await dayTexts(oa(page).locator('.wl-cell > .rw-line')),
  folded:await dayTexts(oa(page).locator('[data-rw-fold-box="folded"]')),
  out:await dayTexts(oa(page).locator('[data-rw-fold-box="out"]')),
 });
 // 기본: 오래된 것 위(지금과 같음), 접힌 목록도 같은 방향.
 await expect(shown(oa(page))).toHaveCount(7);
 await open();
 let r=await read();
 expect(sortedBy(r.shown,1)&&sortedBy(r.folded,1)).toBe(true);expect(r.folded.length).toBe(2);
 // [⋯]는 보이는 폭 안, 메뉴 맨 위 '줄 순서' 두 항목, 기본은 '✓ 오래된 것 위로'.
 await page.locator('#soOverview .oa-bar .wl-tools summary').click();
 const placed=await page.evaluate(()=>{
  const vw=window.innerWidth,box=document.querySelector('#soOverview .oa-bar .wl-tools summary').getBoundingClientRect(),m=document.querySelector('#soOverview .oa-bar .row-more-menu').getBoundingClientRect();
  return {summaryIn:box.left>=0&&box.right<=vw&&box.width>0,menuIn:m.left>=0&&m.right<=vw,items:[...document.querySelectorAll('#soOverview .oa-bar .row-more-menu button')].map(b=>b.textContent),noOverflow:document.documentElement.scrollWidth<=vw+1};
 });
 expect(placed).toEqual({summaryIn:true,menuIn:true,items:['✓ 오래된 것 위로','최신 위로'],noOverflow:true});
 await page.locator('#soOverview .oa-bar .row-more-menu').getByText('최신 위로',{exact:true}).click();
 // 바로 바뀜: 칸 안·펼친 지난 기록·뺀 줄 모두 최신 위로(펼친 상태 그대로 유지).
 await expect.poll(async()=>sortedBy((await read()).shown,-1)).toBe(true);
 r=await read();
 expect(sortedBy(r.folded,-1)).toBe(true);expect(r.shown.length).toBe(7);expect(r.folded.length).toBe(2);expect(r.out.length).toBe(1);
 await expect.poll(()=>prefs.value?.org_row_order).toBe('desc');
 expect(prefs.patches.at(-1)).toMatchObject({org_row_order:'desc'});
 // 새로고침 뒤에도 같다(서버 화면 설정에서 읽음 — 기기 저장소 아님).
 await page.reload();
 await openTable(page);
 await open();
 r=await read();
 expect(sortedBy(r.shown,-1)&&sortedBy(r.folded,-1)).toBe(true);
 // 다시 오래된 것 위로: 기본으로 돌아가고 서버 칸은 지워진다.
 await pickOrder(page,'오래된 것 위로');
 await expect.poll(async()=>sortedBy((await read()).shown,1)).toBe(true);
 r=await read();expect(sortedBy(r.folded,1)).toBe(true);
 await expect.poll(()=>prefs.value?.org_row_order).toBeUndefined();
 expect(errors).toEqual([]);
});

test('[전체 표] 줄 순서: 복사는 고른 순서와 상관없이 날짜 오름차순(주간보고 원칙)',async({page})=>{
 const {records}=orderFixture();
 const {errors}=await fixture(page,{width:1280,records});
 await openTable(page);
 await pickOrder(page,'최신 위로');
 await expect.poll(async()=>sortedBy(await dayTexts(oa(page).locator('.wl-cell > .rw-line')),-1)).toBe(true);
 const copied=await page.evaluate(async()=>{let got='';const real=navigator.clipboard;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{got=t}}});document.querySelector('#soOverview [data-oa-copy]').click();await new Promise(r=>setTimeout(r,50));Object.defineProperty(navigator,'clipboard',{configurable:true,value:real});return got});
 const days=copied.split('\n').filter(l=>l.startsWith('- ')).map(l=>asNum(l.slice(2)));
 expect(days.length).toBeGreaterThan(3);
 expect(JSON.stringify(days)).toBe(JSON.stringify([...days].sort((a,b)=>a-b)));
 expect(errors).toEqual([]);
});

test('[전체 표] 줄 순서: 서버가 아직 모르는 칸이면(적용 전) 저장만 건너뛰고 표는 오래된 것 위 그대로, 오류 없음',async({page})=>{
 const {records}=orderFixture();
 const {errors}=await fixture(page,{width:390,records,prefsOpts:{denyKeys:['org_row_order']}});
 await openTable(page);
 await pickOrder(page,'최신 위로');
 // 거절되면 되돌려 알린다 → 표도 되돌아간 순서(오래된 것 위)로 다시 그린다.
 await expect.poll(async()=>sortedBy(await dayTexts(oa(page).locator('.wl-cell > .rw-line')),1),{timeout:8000}).toBe(true);
 await expect(shown(oa(page))).toHaveCount(7);
 expect(errors).toEqual([]);
});

// UI-보기줄자리(S56-9, 11/10): 폰(~760px)은 [목록|전체 표]가 공용 아래 전환 줄(하단 탭 바로 위 가운데), 목록 맨 아래 '참고 묶음' 줄은 끝까지 내리면 그 줄 위에 보인다.
// 넓은 화면(761px~)은 지금처럼 위(목록·상세 칸 위 한 줄).
for(const width of [390,412,884,1280])test(`[목록|전체 표] 자리 ${width}px: 폰 아래 가운데·참고 묶음 안 가림, 넓은 화면 위`,async({page})=>{
 const {errors}=await fixture(page,{width});
 await clickView(page,'team');
 const tabs=page.locator('#soTeamTabs');await expect(tabs).toBeVisible();
 const tb=await tabs.boundingBox();
 const list=await page.locator('#soOrganizationList').boundingBox();
 if(width<=760){
  expect(await tabs.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
  expect(Math.abs(tb.x+tb.width/2-width/2)).toBeLessThanOrEqual(2);
  const nav=await page.evaluate(()=>{const v=getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height');return parseFloat(v)||0});
  expect(Math.abs(900-nav-(tb.y+tb.height))).toBeLessThanOrEqual(8);
  expect(tb.y).toBeGreaterThan(list.y);
  const ref=page.locator('#soOrganizationList .so-reference-entry');
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await expect(ref).toBeVisible();
  const rb=await ref.boundingBox(),tb2=await tabs.boundingBox();
  expect(rb.y+rb.height).toBeLessThanOrEqual(tb2.y+1);
  await page.locator('#soTeamTabs').getByRole('tab',{name:'전체 표'}).click();
  await expect(page.locator('#soOverview')).toBeVisible();
  await expect(tabs).toBeVisible();
 }else{
  expect(await tabs.evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');
  expect(tb.y+tb.height).toBeLessThanOrEqual(list.y+1);
 }
 expect(errors).toEqual([]);
});

// ORG-뺀줄지난줄메뉴(요청함 11/10 23:51, 명진 'ㅇ'): 뺀 줄·지난 기록 줄의 큰 [되돌리기]/[넣기] 단추를 없애고 보이는 줄과 같은 작은 ⋯ 하나로.
// 메뉴 맨 위가 [되돌리기]/[넣기], 그 아래는 보이는 줄 메뉴와 같다(이미 보고에 없는 줄이라 [보고에서 빼기]만 없음). 모든 조직 기록 줄 ⋯ 맨 아래 [기록 삭제] =
// 조직 창 삭제와 같은 서버 길(그 조직의 그 기록 한 행 DELETE) + 한 번 묻기. 일정 줄은 삭제 없이 [일정 열기]. PC 우클릭은 공용 context-menu.js가 그 줄 ⋯를 연다.
// 사진: ORG_ROW_SHOTS 폴더가 있으면 docs/design/screens/s57-10/ 용 사진을 남긴다(가짜 데이터).
const SHOTS=process.env.ORG_ROW_SHOTS||'';
const rowsFixture=()=>{
 const days=['2026-11-13','2026-11-11','2026-11-09','2026-11-05','2026-11-03','2026-10-30','2026-10-28','2026-10-27'];
 const fold=days.map((d,i)=>U(OA,d,'합성 지난 줄 '+i));
 const outRec=U(OA,'2026-11-12','합성 뺀 줄 하나');
 const marks=[{id:'mk-out',week_start:W,section:'org',ref_kind:'org_update',ref_key:outRec.id,report_body:null,choice:'out',detail:null,updated_at:NOW}];
 return {records:[U(OA,'2026-11-18','합성 이번 주 줄'),...fold,outRec],marks,outRec};
};
const menuTexts=line=>line.locator('.row-more-menu button').allTextContents();
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
for(const width of [412,1280])test(`[전체 표] 뺀 줄·지난 기록 줄 ⋯ ${width}px: 큰 단추 없이 ⋯ 하나, 맨 위 [되돌리기]/[넣기], 아래는 보이는 줄 메뉴와 같음`,async({page},info)=>{
 const {records,marks}=rowsFixture();
 const {errors}=await fixture(page,{width,records,marks});
 await openTable(page);
 await tableDrawn(page); // 아래에서 메뉴를 열고 줄 자리를 잰다 — 표가 다 그려진 뒤에
 await expect(shown(oa(page))).toHaveCount(7);
 await oa(page).locator('[data-rw-fold="folded"]').click();
 await oa(page).locator('[data-rw-fold="out"]').click();
 const lines=oa(page).locator('.rw-fold .rw-line');
 await expect(lines).toHaveCount(3);
 // 줄 끝 큰 단추([넣기]·[되돌리기])는 없고 줄마다 ⋯ 하나.
 await expect(oa(page).locator('.rw-fold .wl-btns')).toHaveCount(0);
 await expect(oa(page).locator('.rw-fold .rw-line > .row-more')).toHaveCount(3);
 const base=(await menuTexts(shown(oa(page)).first())).filter(t=>t!=='보고에서 빼기');
 expect(base).toContain('보고용으로 수정');expect(base.at(-1)).toBe('기록 삭제');
 const fold1=oa(page).locator('[data-rw-fold-box="folded"] .rw-line').first(),out1=oa(page).locator('[data-rw-fold-box="out"] .rw-line').first();
 await expect(fold1.locator('.row-more')).toHaveCount(1);
 if(SHOTS)await page.screenshot({path:`${SHOTS}/org-row-more-${width}.png`});
 await fold1.locator('summary').click();
 expect(await menuTexts(fold1)).toEqual(['넣기',...base]);
 await page.keyboard.press('Escape');
 await out1.locator('summary').click();
 expect(await menuTexts(out1)).toEqual(['되돌리기',...base]);
 if(SHOTS)await page.screenshot({path:`${SHOTS}/org-row-more-menu-${width}.png`});
 await page.screenshot({path:info.outputPath(`org-row-more-menu-${width}.png`)});
 await page.keyboard.press('Escape');
 expect(await noWide(page)).toBe(true);
 // 줄 이름 칸이 ⋯ 때문에 잘리지 않는다(줄 안에 한 줄로 들어감).
 for(const i of [0,1,2]){const b=await lines.nth(i).boundingBox();expect(b.x+b.width).toBeLessThanOrEqual(width+1)}
 expect(errors).toEqual([]);
});
test('[전체 표] 뺀 줄 ⋯ [되돌리기]·지난 기록 줄 ⋯ [넣기]는 예전 단추와 같은 길(보고 표시 한 행), 뺀 줄에서도 [보고용으로 수정]',async({page})=>{
 const {records,marks,outRec}=rowsFixture();
 const {db,errors}=await fixture(page,{width:1280,records,marks});
 await openTable(page);
 await oa(page).locator('[data-rw-fold="out"]').click();
 await foldMenu(oa(page),'합성 뺀 줄 하나','보고용으로 수정');
 const body=page.locator('#soOverview [data-rw-field="body"]');
 await expect(body).toBeFocused();
 await body.fill('합성 뺀 줄(보고용)');await body.press('Enter');
 await expect(status(page)).toHaveText('저장했어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'PATCH',id:'mk-out',report_body:'합성 뺀 줄(보고용)'});
 await foldMenu(oa(page),'(보고용)','되돌리기');
 await expect(status(page)).toHaveText('보고에 다시 넣었어요.');
 expect(db.markWrites.at(-1)).toMatchObject({m:'PATCH',id:'mk-out',choice:null});
 await expect(oa(page).locator('[data-rw-fold="out"]')).toHaveCount(0);
 expect(db.deletes).toEqual([]);
 expect(errors).toEqual([]);
});
for(const width of [412,1280])test(`[전체 표] 줄 ⋯ [기록 삭제] ${width}px: 한 번 묻고(아니오면 요청 없음), 예면 그 조직의 그 기록 한 행 DELETE, 보이는 줄·지난 기록·뺀 줄 모두, 일정 줄은 삭제 없음`,async({page})=>{
 const {records,marks,outRec}=rowsFixture();
 const events=[EV('ev9','2026-11-19','합성 가 지부 간담회')];
 const {db,errors}=await fixture(page,{width,records,marks,events});
 await openTable(page);
 await expect(shown(oa(page))).toHaveCount(7); // 조직당 7줄(일정 1줄 포함)
 const ev=oa(page).locator('.rw-line[data-rw-kind="event"]');
 await ev.locator('summary').click();
 expect(await menuTexts(ev)).toContain('일정 열기');
 expect(await menuTexts(ev)).not.toContain('기록 삭제');
 await page.keyboard.press('Escape');
 // 보이는 줄: 아니오 → 요청 없음.
 const first=oa(page).locator('.wl-cell > .rw-line[data-rw-kind="org_update"]',{hasText:'합성 이번 주 줄'});
 await first.locator('summary').click();
 await first.locator('.row-more').getByText('기록 삭제',{exact:true}).click();
 await page.locator('.kptu-ask').waitFor({state:'visible'});
 if(SHOTS)await page.screenshot({path:`${SHOTS}/org-row-delete-ask-${width}.png`});
 expect(await answerAsk(page,false)).toBe('이 기록을 삭제할까요?');
 expect(db.deletes).toEqual([]);
 await expect(first).toHaveCount(1);
 // 예 → DELETE 한 번(조직 창 삭제와 같은 주소 모양), 줄이 사라지고 알림.
 await first.locator('summary').click();
 await first.locator('.row-more').getByText('기록 삭제',{exact:true}).click();
 await answerAsk(page,true);
 await expect(status(page)).toHaveText('기록을 삭제했어요.');
 expect(db.deletes).toHaveLength(1);
 expect(db.deletes[0]).toMatchObject({org:OA,select:'id'});
 expect(db.deletes[0].prefer).toContain('return=representation');
 expect(db.records.some(r=>r.raw_text==='합성 이번 주 줄')).toBe(false);
 await expect(oa(page).locator('.rw-line',{hasText:'합성 이번 주 줄'})).toHaveCount(0);
 // 지난 기록 줄·뺀 줄도 같은 길.
 await oa(page).locator('[data-rw-fold="folded"]').click();
 const gone=oa(page).locator('[data-rw-fold-box="folded"] .rw-line',{hasText:'합성 지난 줄 7'});
 await gone.locator('summary').click();
 await gone.locator('.row-more').getByText('기록 삭제',{exact:true}).click();
 await answerAsk(page,true);
 await expect(oa(page).locator('.rw-line',{hasText:'합성 지난 줄 7'})).toHaveCount(0);
 await oa(page).locator('[data-rw-fold="out"]').click();
 await foldMenu(oa(page),'합성 뺀 줄 하나','기록 삭제');
 await answerAsk(page,true);
 await expect(oa(page).locator('[data-rw-fold="out"]')).toHaveCount(0);
 expect(db.deletes.map(d=>d.id)).toContain(outRec.id);
 expect(db.deletes).toHaveLength(3);
 expect(db.deletes.every(d=>d.org===OA)).toBe(true);
 // 새로 읽어도(다음 주 갔다 오기) 서버에서 지워져 있다. 보고 표시 쪽 DELETE(app_report_line_marks)는 하나도 없다.
 await page.locator('#soOverview [data-week-step="1"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('11.23~11.29');
 await page.locator('#soOverview [data-week-step="0"]').click();
 await expect(page.locator('#soOverview .week-pick-label')).toHaveText('11.16~11.22');
 await expect(oa(page).locator('.rw-line',{hasText:/합성 이번 주 줄|합성 지난 줄 7|합성 뺀 줄 하나/})).toHaveCount(0);
 expect(db.markWrites.filter(w=>w.m==='DELETE')).toEqual([]);
 expect(await noWide(page)).toBe(true);
 expect(errors).toEqual([]);
});
test('[전체 표] PC 우클릭: 뺀 줄·지난 기록 줄 위에서도 그 줄 ⋯ 메뉴가 열린다(공용 context-menu.js)',async({page})=>{
 const {records,marks}=rowsFixture();
 const {errors}=await fixture(page,{width:1280,records,marks});
 await openTable(page);
 await oa(page).locator('[data-rw-fold="folded"]').click();
 await oa(page).locator('[data-rw-fold="out"]').click();
 const out1=oa(page).locator('[data-rw-fold-box="out"] .rw-line').first();
 await out1.locator('.wl-text').click({button:'right'});
 await expect(out1.locator('.row-more')).toHaveJSProperty('open',true);
 expect((await menuTexts(out1))[0]).toBe('되돌리기');
 await page.keyboard.press('Escape');
 const fold1=oa(page).locator('[data-rw-fold-box="folded"] .rw-line').first();
 await fold1.locator('.wl-text').click({button:'right'});
 await expect(fold1.locator('.row-more')).toHaveJSProperty('open',true);
 expect((await menuTexts(fold1))[0]).toBe('넣기');
 if(SHOTS)await page.screenshot({path:`${SHOTS}/org-row-more-rightclick-1280.png`});
 expect(errors).toEqual([]);
});
