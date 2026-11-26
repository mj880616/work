import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
// PRJ-화면다듬기(2026-10-22 사용자 결정): (1) 프로젝트 목록 오른쪽 "일정 없음" 대신 "최근 기록 10.21", 기록이 없으면 빈칸
// (2) 상세 기록 칸의 [크게]는 입력 칸 안 ⤢ 아이콘(MTG-프로젝트합치기 3단계에서 입력칸과 함께 없어짐) (3) 진행 기록·조직 기록은 4줄까지만, 잘린 글을 누르면(조직은 [더보기]) 펼침
// (4) 상세 안 겹상자 테두리 제거. DB·Edge 변경 없음. (3)은 UI-기록줄높이통일(S70-66)로 바뀜 → record-fold.spec.mjs.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG=Array.from({length:12},(_,i)=>`긴 기록 ${i+1}번째 줄`).join('\n');
// MTG-프로젝트합치기 결정 ⑥: 프로젝트 상세 기록 목록에는 정리함 연결 줄만 그려진다. 연결 줄 요약은 한 줄로 이어 보이므로(줄바꿈 → 띄어쓰기)
// 1280px에서도 10줄을 넘도록 긴 요약을 따로 둔다.
const LINK_LONG=Array.from({length:120},(_,i)=>`긴 연결 요약 ${i+1}번째 문장`).join(' ');
const linkRow=(id,summary,at)=>({id,workspace_id:'w',summary,note_id:'n-'+id,organization_id:null,project_id:'p',status:'confirmed',note:{id:'n-'+id,workspace_id:'w',occurred_at:at,raw_text:'합성 원문',kind:'basket',title:null}});
async function fixture(page,width,beforeLoad=null){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page,{beforeLoad});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_project_progress_updates',r=>r.request().method()!=='GET'?r.fallback():r.fulfill({json:[
  {id:'r-long',project_id:'p',workstream_id:null,effective_on:'2026-10-21',created_at:'2026-10-21T01:00:00Z',summary:LONG,next_step:null},
  {id:'r-mid',project_id:'p',workstream_id:null,effective_on:'2026-10-20',created_at:'2026-10-20T01:00:00Z',summary:'한 줄 기록',next_step:null}]}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links'&&(u.searchParams.get('select')||'').includes('note:app_notes')&&u.searchParams.get('project_id')==='in.(p)',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:[
  linkRow('l-long',LINK_LONG,'2026-10-21T01:00:00Z'),linkRow('l-mid','한 줄 연결','2026-10-20T01:00:00Z')]}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()!=='GET'?r.fallback():r.fulfill({json:[
  {id:'u-long',organization_id:'o',raw_text:LONG,occurred_at:'2026-10-05T16:00:00Z'},
  {id:'u-short',organization_id:'o',raw_text:'짧은 기록',occurred_at:'2026-10-04T16:00:00Z'}]}));
 return {...home,errors};
}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280]){
 test(`프로젝트 목록: 일정이 없으면 최근 기록 날짜, 기록도 없으면 빈칸 ${width}`,async({page})=>{
  const f=await fixture(page,width,async()=>{
   await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_project_milestones',r=>r.fulfill({json:[]}));
   await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_spaces',async r=>{
   const url=new URL(r.request().url());
   if(r.request().method()!=='GET'||!url.searchParams.get('select')?.includes('milestones:'))return r.fallback();
   expect(url.searchParams.get('select')).toContain('progress:app_project_progress_updates!project_id(effective_on)');
   expect(url.searchParams.get('progress.limit')).toBe('1');
   const ids=url.searchParams.get('id').slice(4,-1).split(',');
   return r.fulfill({json:ids.map(id=>({id,milestones:[],progress:id==='p'?[{effective_on:'2026-10-21'}]:[]}))});
  });
  });
  await clickView(page,'projects');
  const list=page.locator('#projectGrid .ps3-plist');
  await expect(list.locator('[data-ps3-project="p"] .ps3-prow-meta')).toHaveText('최근 기록 10.21');
  await expect(list).not.toContainText('일정 없음');
  const others=list.locator('[data-ps3-project]:not([data-ps3-project="p"]) .ps3-prow-meta');
  for(const m of await others.all())await expect(m).toHaveText('');
  expect(await noOverflow(page)).toBe(true);expect(f.errors).toEqual([]);
 });

 // UI-기록줄높이통일(S70-66, 명진 2026-11-26 '두 줄'): 진행 기록·조직 기록의 4줄 자르기·[펼치기]는 같은 높이 두 줄 줄 + 누르면 그 자리 펼침으로
 // 바뀌었다 — 그 시험은 record-fold.spec.mjs. 여기는 입력 칸이 없고 겹상자가 없는 것만 본다.
 test(`프로젝트 상세: 입력 칸·⤢ 없음, 겹상자 없음 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
  await expectProjectDetail(page,'p');
  await expect(page.locator('#ps3-progress [data-ps3-record-input],#ps3-progress [data-ps3-record-big]')).toHaveCount(0);
  await expect(page.locator('#ps3-progress [data-ps3-record]')).toHaveCount(0);
  await expect(page.locator('[data-basket-link="l-long"]')).toBeVisible();
  expect(await page.locator('#ps3-progress').evaluate(e=>{const s=getComputedStyle(e);return [s.borderTopWidth,s.borderLeftWidth,s.paddingLeft]})).toEqual(['0px','0px','0px']);
  expect(await noOverflow(page)).toBe(true);expect(f.errors).toEqual([]);
 });
}
