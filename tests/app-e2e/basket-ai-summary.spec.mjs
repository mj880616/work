import {SHEET as AOP_SHEET,pressName,pressNamesAndSave,openFolds} from './helpers/area-org-picker.mjs';
import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {linkAction} from './helpers/basket-link-menu.mjs';
// AI-서버연동 S4: [AI 요약] next to the basket link summary box and the organization '요약 수정' box.
// ai-assist is mocked. Synthetic IDs and text only; nothing here calls a real server.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001';
const RAW='10/20 합성 기자회견 준비 회의\n장소: 합성 본사 앞\n참석 30명';
const AI_TEXT='합성 한빛지부는 10/20 합성 본사 앞 기자회견에 30명이 참석하기로 했다. 준비 회의에서 장소를 정했다.';
// 홈 화면이 스스로 보내는 AI 부탁 종류(읽을 만한 글·챙길 것·업무 가르기). 이 파일의 시험 대상이 아니다.
const HOME_BACKGROUND_ASKS=['home_day_picks','todo_radar','work_scope','journal_memorable']; // journal_memorable: 홈을 열 때 오늘 소식 고르기(forget-news-data.js pickTodayNews, PERF-첫로딩 ③ 뒤 첫 화면 뒤에 끝날 수 있음)
// Errors the browser itself logs for a mocked 4xx/5xx or an aborted request are not page errors.
const resourceNoise=text=>/Failed to load resource|net::ERR_FAILED/.test(text);

async function fixture(page,{note:over={}}={}){
 await openHome(page);const errors=[],calls=[],ai=[],note={id:n,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[],...over};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!resourceNoise(e.text()))errors.push(e.text());});
 const links=[];
 const tables={app_notes:[note],app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'}],app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 기자회견 준비',status:'active',metadata:{project_system:'v2'}}],app_suborganization_updates:[]};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=items;
  for(const key of ['id','organization_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=q.has('google_task_id')?[]:links;
  for(const key of ['id','organization_id','project_id','note_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.map(row=>({...row,note,organization:row.organization_id?{name:'합성 한빛지부'}:null,project:row.project_id?{name:'합성 기자회견 준비'}:null}))});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{
  const body=route.request().postDataJSON();calls.push(body);
  for(const target of body.p_targets)links.push({id:'40000000-0000-4000-8000-'+String(links.length+1).padStart(12,'0'),workspace_id:'w',note_id:n,status:'confirmed',summary:target.summary??null,[target.kind==='project'?'project_id':'organization_id']:target.target_id});
  return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 // Each queued reply answers one [AI 요약] call: {status,json} | 'abort' | {hold:true}.
 // STAB(S57-19): 붙잡은 답을 놓는 문(gate)은 처음부터 만들어 둔다. 화면은 '요약 만드는 중…'을 먼저 보이고 요청은 로그인 확인 뒤에 보내므로,
 // 시험의 release()가 요청이 여기 닿기 전에 불릴 수 있다 — 그때도 놓은 것이 사라지지 않게(예전에는 닿은 뒤에야 문이 생겨, 먼저 놓으면 답이 영영 붙잡혔다).
 // 붙잡기는 시험 하나에 한 번만 쓴다.
 const queue=[];let release;const gate=new Promise(r=>{release=r;});
 await page.route(SB+'/functions/v1/ai-assist',async route=>{
  if(route.request().method()!=='POST')return route.fulfill({status:204});
  const kind=route.request().postDataJSON()?.kind;
  // WEEKLY-메뉴짝짓기 P4: 조직에 확정 연결하면 그 업데이트를 주별 조직보고 제안 줄로 보낸다(이 시험의 [AI 요약]과 별개라 세지 않음).
  if(kind==='org_week_lines')return route.fulfill({status:200,json:{ok:true,kind:'org_week_lines',results:[]}});
  // STAB(S57-19): 홈이 배경으로 보내는 AI 부탁(읽을 만한 글은 홈을 연 2초 뒤)이 이 가로채기를 깐 뒤에 늦게 올 수 있다.
  // 이 시험의 [AI 요약]이 아니므로 세지도 답하지도 않고 openHome이 깐 기본 가짜 서버로 넘긴다. 그 밖의 종류는 전처럼 센다(뜻밖의 부탁은 시험이 잡는다).
  if(HOME_BACKGROUND_ASKS.includes(kind))return route.fallback();
  ai.push({body:route.request().postDataJSON(),auth:route.request().headers().authorization});
  const next=queue.shift()||{status:200,json:{ok:true,kind:'link_summary',summary:AI_TEXT}};
  if(next.hold){await gate;return route.fulfill({status:200,json:{ok:true,kind:'link_summary',summary:AI_TEXT}});}
  if(next==='abort')return route.abort('failed');
  return route.fulfill({status:next.status,json:next.json});
 });
 return {note,links,calls,ai,errors,queue,release:()=>release()};
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.tap();}else await locator.click();}
async function openLink(page,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 await tap(page,page.locator(`[data-basket-row="${n}"]`),width);await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 const detail=page.locator('[data-basket-detail]');
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);
 await tap(page,detail.locator('[data-manual-pick="organization"]'),width);
 await pressNamesAndSave(page,'합성 한빛지부');
 await expect(detail.locator(`[data-manual-summary="organization:${o}"]`)).toBeFocused();
 return detail;
}
// The press area is 44px: the box itself on phone, the compact button's ::after on PC (UI-PC다듬기묶음 ④).
const pressHeight=button=>button.evaluate(el=>Math.max(el.getBoundingClientRect().height,parseFloat(getComputedStyle(el,'::after').height)||0));
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`an empty summary box is filled by [요약 만들기] and saved only by [연결] ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page),detail=await openLink(page,width);
 const box=detail.locator(`[data-manual-summary="organization:${o}"]`),run=detail.getByRole('button',{name:'요약 만들기'});
 await expect(box).toHaveValue('');await expect(run).toBeVisible();expect(await pressHeight(run)).toBeGreaterThanOrEqual(44);
 f.queue.push({hold:true});await tap(page,run,width);
 await expect(detail.locator('[data-manual-ai-status]')).toHaveText('요약 만드는 중…');await expect(run).toBeDisabled();
 // Only the AI button waits; the rest of the panel stays usable.
 await expect(detail.getByRole('button',{name:'연결',exact:true})).toBeEnabled();
 f.release();
 await expect(box).toHaveValue(AI_TEXT);await expect(detail.locator('[data-manual-ai-status]')).toHaveText('AI 요약을 칸에 넣었어요. 아직 저장 전이에요. 수정한 뒤 [연결]을 눌러 주세요.');
 await expect(box).toBeFocused();await expect(run).toBeEnabled();
 expect(f.ai).toEqual([{body:{kind:'link_summary',note_id:n,target_kind:'organization',target_id:o},auth:expect.stringMatching(/^Bearer /)}]);
 expect(f.calls).toEqual([]);expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('ai-summary-filled-390.png'),fullPage:true});
 await box.fill(AI_TEXT+' 사용자가 수정한 끝.');
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');
 expect(f.calls).toEqual([{p_note_id:n,p_note_updated_at:stamp,p_targets:[{kind:'organization',target_id:o,reason:'직접 연결',origin:'basket',summary:AI_TEXT+' 사용자가 수정한 끝.'}]}]);
 expect(f.ai).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`a box with text keeps it; the proposal replaces it only on [이걸로 바꾸기] ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page),detail=await openLink(page,width);
 const box=detail.locator(`[data-manual-summary="organization:${o}"]`);await box.fill('직접 쓴 요약');
 await tap(page,detail.getByRole('button',{name:'요약 만들기'}),width);
 const proposal=detail.locator('[data-manual-ai-proposal]');await expect(proposal).toContainText(AI_TEXT);await expect(box).toHaveValue('직접 쓴 요약');
 await expect(detail.locator('[data-manual-ai-status]')).toHaveText('칸에 쓴 글은 그대로 두었어요. 제안을 쓰려면 [이걸로 바꾸기]를 눌러 주세요.');
 const apply=proposal.getByRole('button',{name:'이걸로 바꾸기'});await expect(apply).toBeFocused();expect(await pressHeight(apply)).toBeGreaterThanOrEqual(44);
 // Closing the proposal keeps the written text.
 await tap(page,proposal.getByRole('button',{name:'제안 닫기'}),width);await expect(proposal).toHaveCount(0);await expect(box).toHaveValue('직접 쓴 요약');
 await tap(page,detail.getByRole('button',{name:'요약 만들기'}),width);await tap(page,detail.locator('[data-manual-ai-proposal]').getByRole('button',{name:'이걸로 바꾸기'}),width);
 await expect(box).toHaveValue(AI_TEXT);await expect(detail.locator('[data-manual-ai-proposal]')).toHaveCount(0);await expect(box).toBeFocused();
 expect(f.calls).toEqual([]);
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');
 expect(f.calls[0].p_targets).toEqual([{kind:'organization',target_id:o,reason:'직접 연결',origin:'basket',summary:AI_TEXT}]);expect(f.errors).toEqual([]);
});

const failures=[
 ['daily limit',{status:429,json:{ok:false,error:'daily_limit',message:'서버 문구'}},'오늘 AI 요약을 쓸 수 있는 횟수를 다 썼어요. 요약은 직접 써 주세요.',false],
 ['monthly limit',{status:429,json:{ok:false,error:'monthly_limit'}},'이번 달 AI 한도에 닿았어요. 요약은 직접 써 주세요.',false],
 ['key not set',{status:503,json:{ok:false,error:'ai_not_configured'}},'지금은 AI를 쓸 수 없어요.',false],
 ['timeout',{status:504,json:{ok:false,error:'ai_timeout'}},'AI 답이 늦어 멈췄어요. 잠시 뒤 다시 눌러 주세요.',true],
 ['bad answer',{status:502,json:{ok:false,error:'ai_invalid_response'}},'AI 답을 읽지 못했어요. 다시 눌러 주세요.',true],
 ['unsupported kind',{status:400,json:{ok:false,error:'unsupported_kind'}},'아직 지원하지 않는 AI 기능이에요.',false],
 ['not deployed (404)',{status:404,json:{code:'NOT_FOUND',message:'Requested function was not found'}},'AI 요약은 아직 준비 중이에요.',false],
 ['not deployed (network)','abort','AI 요약은 아직 준비 중이에요.',false],
];
for(const [name,reply,message,retry] of failures)test(`${name}: the box stays as it was with one plain message`,async({page})=>{
 const f=await fixture(page),detail=await openLink(page,1280),box=detail.locator(`[data-manual-summary="organization:${o}"]`);
 await box.fill('삭제하면 안 되는 초안');f.queue.push(reply);
 await detail.getByRole('button',{name:'요약 만들기'}).click();
 await expect(detail.locator('[data-manual-ai-status]')).toHaveText(message);await expect(box).toHaveValue('삭제하면 안 되는 초안');
 await expect(detail.locator('[data-manual-ai-proposal]')).toHaveCount(0);await expect(detail.locator('[data-manual-status]')).toHaveText('');
 const again=detail.locator('[data-manual-ai-run]');await expect(again).toBeEnabled();await expect(again).toHaveText(retry?'다시 시도':'요약 만들기');await expect(again).toBeFocused();
 await expect(detail.locator('.ai-summary-status')).toHaveCount(1);expect(f.calls).toEqual([]);expect(f.errors).toEqual([]);
});

test('[다시 시도] after a busy AI asks once more and then offers the proposal',async({page})=>{
 const f=await fixture(page),detail=await openLink(page,1280);f.queue.push({status:503,json:{ok:false,error:'ai_busy'}});
 await detail.getByRole('button',{name:'요약 만들기'}).click();await expect(detail.locator('[data-manual-ai-status]')).toHaveText('AI가 지금 바빠요. 잠시 뒤 다시 눌러 주세요.');
 await detail.getByRole('button',{name:'요약 만들기 다시 시도'}).click();
 await expect(detail.locator(`[data-manual-summary="organization:${o}"]`)).toHaveValue(AI_TEXT);await expect(detail.locator('[data-manual-ai-run]')).toHaveText('요약 만들기');
 expect(f.ai).toHaveLength(2);expect(f.errors).toEqual([]);
});

test('a late AI answer for a removed pick or a cancelled panel changes nothing',async({page})=>{
 const f=await fixture(page),detail=await openLink(page,1280);f.queue.push({hold:true});
 await detail.getByRole('button',{name:'요약 만들기'}).click();await expect(detail.locator('[data-manual-ai-status]')).toHaveText('요약 만드는 중…');
 await detail.getByRole('button',{name:'합성 한빛지부 빼기'}).click();await expect(detail.locator('[data-manual-target]')).toHaveCount(0);
 await f.release();await expect.poll(()=>f.ai.length).toBe(1);await page.waitForTimeout(100);
 await expect(detail.locator('[data-manual-target]')).toHaveCount(0);await expect(detail.locator('[data-manual-status]')).toHaveText('');expect(f.calls).toEqual([]);expect(f.errors).toEqual([]);
});

test('an AI-excluded update never opens the link panel, so there is no [요약 만들기]',async({page})=>{
 const f=await fixture(page,{note:{ai_export_allowed:false}});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);await page.locator(`[data-basket-row="${n}"]`).click();
 const detail=page.locator('[data-basket-detail]');await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 await detail.getByRole('button',{name:'연결하기'}).click();await expect(detail.locator('[data-basket-status]')).toContainText('AI 제외로 표시된 업데이트');
 await expect(detail.locator('[data-manual-link]')).toHaveCount(0);await expect(page.locator('[data-manual-ai-run]')).toHaveCount(0);expect(f.ai).toEqual([]);expect(f.errors).toEqual([]);
});

// '요약 수정' in organization detail (the shared summary editor), on the detail fixture.
const detailFixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html',FN='https://fixture.invalid/functions/v1/ai-assist';
async function detailReady(page,note={}){
 await page.goto(detailFixture);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);
 await page.evaluate(over=>Object.assign(window.__detailState.notes[0],{kind:'basket',archived_at:null,ai_export_allowed:true,raw_text:'합성 원문 한 줄'},over),note);
 const ai=[],queue=[];
 await page.route(FN,route=>{ai.push(route.request().postDataJSON());const next=queue.shift()||{status:200,json:{ok:true,kind:'link_summary',summary:AI_TEXT}};return next==='abort'?route.abort('failed'):route.fulfill({status:next.status,json:next.json});});
 await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.org));
 return {ai,queue};
}
const editRow=async(page,which)=>{const id=await page.evaluate(w=>window.__detailState.ids[w],which),row=page.locator(`#wdUpdates [data-basket-link="${id}"]`);await linkAction(row,'요약 수정');return row;};

for(const width of [390,1280])test(`요약 수정: the current summary stays; the proposal needs [이걸로 바꾸기], then [저장] saves ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await detailReady(page),row=await editRow(page,'link'),input=row.locator('[data-link-summary-input]');
 await expect(input).toHaveValue('연결 요약');const run=row.getByRole('button',{name:'요약 만들기'});await expect(run).toBeVisible();expect(await pressHeight(run)).toBeGreaterThanOrEqual(44);
 await run.click();const proposal=row.locator('[data-link-summary-ai-proposal]');await expect(proposal).toContainText(AI_TEXT);await expect(input).toHaveValue('연결 요약');
 expect(f.ai).toEqual([{kind:'link_summary',note_id:await page.evaluate(()=>window.__detailState.ids.note),target_kind:'organization',target_id:await page.evaluate(()=>window.__detailState.ids.org)}]);
 expect(await page.evaluate(()=>window.__detailState.calls.filter(x=>x.method!=='GET'))).toEqual([]);
 await proposal.getByRole('button',{name:'이걸로 바꾸기'}).click();await expect(input).toHaveValue(AI_TEXT);await expect(proposal).toHaveCount(0);await expect(input).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await row.locator('[data-link-summary-save]').click();await expect(row.locator('[data-link-summary-input]')).toHaveCount(0);await expect(row.locator('[data-link-summary-text]')).toHaveText(AI_TEXT);
 const writes=await page.evaluate(()=>window.__detailState.calls.filter(x=>x.method!=='GET'));expect(writes).toHaveLength(1);expect(writes[0].body).toEqual({p_link_id:await page.evaluate(()=>window.__detailState.ids.link),p_expected_summary:'연결 요약',p_summary:AI_TEXT});
});

test('요약 수정: an empty summary (NULL) is filled at once and not saved until [저장]',async({page})=>{
 await detailReady(page);const row=await editRow(page,'nullLink'),input=row.locator('[data-link-summary-input]');await expect(input).toHaveValue('');
 await row.getByRole('button',{name:'요약 만들기'}).click();await expect(input).toHaveValue(AI_TEXT);
 await expect(row.locator('[data-link-summary-ai-status]')).toHaveText('AI 요약을 칸에 넣었어요. 아직 저장 전이에요. 수정한 뒤 [저장]을 눌러 주세요.');
 expect(await page.evaluate(()=>window.__detailState.calls.filter(x=>x.method!=='GET'))).toEqual([]);
});

test('요약 수정: not deployed and daily limit keep the box with one plain message',async({page})=>{
 const f=await detailReady(page),row=await editRow(page,'link'),input=row.locator('[data-link-summary-input]');
 f.queue.push('abort',{status:429,json:{ok:false,error:'daily_limit'}});
 await row.getByRole('button',{name:'요약 만들기'}).click();await expect(row.locator('[data-link-summary-ai-status]')).toHaveText('AI 요약은 아직 준비 중이에요.');await expect(input).toHaveValue('연결 요약');
 await row.getByRole('button',{name:'요약 만들기'}).click();await expect(row.locator('[data-link-summary-ai-status]')).toHaveText('오늘 AI 요약을 쓸 수 있는 횟수를 다 썼어요. 요약은 직접 써 주세요.');await expect(input).toHaveValue('연결 요약');
 await expect(row.locator('[data-link-summary-status]')).toHaveText('');
});

for(const [name,note] of [['archived',{archived_at:'2026-10-12T01:00:00Z'}],['AI-excluded',{ai_export_allowed:false}],['diary',{kind:'diary'}]])test(`요약 수정: no [요약 만들기] for a ${name} note`,async({page})=>{
 const f=await detailReady(page,note),row=await editRow(page,'link');await expect(row.locator('[data-link-summary-input]')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__detailState.calls.some(c=>c.path.includes('/app_notes?')))).toBe(true);
 await page.waitForTimeout(100);await expect(row.locator('[data-link-summary-ai-run]')).toHaveCount(0);expect(f.ai).toEqual([]);
});
