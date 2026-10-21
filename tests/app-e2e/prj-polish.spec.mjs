import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
// PRJ-화면다듬기(2026-10-22 사용자 결정): (1) 프로젝트 목록 오른쪽 "일정 없음" 대신 "최근 기록 10.21", 기록이 없으면 빈칸
// (2) 상세 기록 칸의 [크게]는 입력 칸 안 ⤢ 아이콘 (3) 진행 기록·조직 기록은 4줄까지만, 잘린 글을 누르면(조직은 [더보기]) 펼침
// (4) 상세 안 겹상자 테두리 제거. DB·Edge 변경 없음.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG=Array.from({length:12},(_,i)=>`긴 기록 ${i+1}번째 줄`).join('\n');
async function fixture(page,width,beforeLoad=null){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page,{beforeLoad});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_project_progress_updates',r=>r.request().method()!=='GET'?r.fallback():r.fulfill({json:[
  {id:'r-long',project_id:'p',workstream_id:null,effective_on:'2026-10-21',created_at:'2026-10-21T01:00:00Z',summary:LONG,next_step:null},
  {id:'r-mid',project_id:'p',workstream_id:null,effective_on:'2026-10-20',created_at:'2026-10-20T01:00:00Z',summary:'한 줄 기록',next_step:null}]}));
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

 test(`프로젝트 상세: ⤢ 아이콘은 입력 칸 안, 기록은 4줄, 겹상자 없음 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
  await expectProjectDetail(page,'p');
  const form=page.locator('#ps3-progress [data-ps3-record-input]'),input=form.locator('input'),big=form.locator('[data-ps3-record-big]');
  await expect(big).toBeVisible();await expect(big).toHaveText('');await expect(big).toHaveAccessibleName('큰 창에서 쓰기');
  const [i,b]=await Promise.all([input.boundingBox(),big.boundingBox()]);
  expect(b.x).toBeGreaterThanOrEqual(i.x);expect(b.x+b.width).toBeLessThanOrEqual(i.x+i.width+1);expect(b.y).toBeGreaterThanOrEqual(i.y-1);expect(b.y+b.height).toBeLessThanOrEqual(i.y+i.height+1);
  expect(b.width).toBeGreaterThanOrEqual(44);
  // 4 lines, then the first tap opens that record only; the second tap is the old behaviour (menu).
  const long=page.locator('[data-ps3-record="r-long"] .ps3-rec-text'),mid=page.locator('[data-ps3-record="r-mid"] .ps3-rec-text');
  const lh=await long.evaluate(e=>parseFloat(getComputedStyle(e).lineHeight));
  const h1=(await long.boundingBox()).height;expect(h1).toBeLessThanOrEqual(lh*4+2);expect(h1).toBeGreaterThanOrEqual(lh*4-2);
  const hm=(await mid.boundingBox()).height;
  await long.click();await expect(long).toHaveClass(/is-open/);expect((await long.boundingBox()).height).toBeGreaterThan(lh*10);
  await expect(page.locator('#ps3RecordMenu')).toBeHidden();expect((await mid.boundingBox()).height).toBeCloseTo(hm,0);await expect(mid).not.toHaveClass(/is-open/);
  await mid.click();await expect(page.locator('#ps3RecordMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  // No box inside the dialog box.
  expect(await page.locator('#ps3-progress').evaluate(e=>{const s=getComputedStyle(e);return [s.borderTopWidth,s.borderLeftWidth,s.paddingLeft]})).toEqual(['0px','0px','0px']);
  expect(await noOverflow(page)).toBe(true);expect(f.errors).toEqual([]);
 });

 test(`조직 상세 기록: 4줄 + [더보기]가 그 기록만 펼치고 [접기]로 접힘 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
  await expect(page.locator('#wdModal')).toBeVisible();
  const long=page.locator('[data-wd-up="u-long"] .wd-log-main p').first(),short=page.locator('[data-wd-up="u-short"]');
  await expect(long).toHaveClass(/kptu-clamp/);
  const more=page.locator('[data-wd-up="u-long"] .kptu-clamp-more');await expect(more).toHaveText('더보기');
  await expect(short.locator('.kptu-clamp-more')).toHaveCount(0);
  const lh=await long.evaluate(e=>parseFloat(getComputedStyle(e).lineHeight));
  expect((await long.boundingBox()).height).toBeLessThanOrEqual(lh*4+2);
  await more.click();await expect(long).toHaveClass(/is-open/);await expect(more).toHaveText('접기');await expect(more).toHaveAttribute('aria-expanded','true');
  expect((await long.boundingBox()).height).toBeGreaterThan(lh*10);
  await more.click();await expect(long).not.toHaveClass(/is-open/);await expect(more).toHaveText('더보기');
  expect((await long.boundingBox()).height).toBeLessThanOrEqual(lh*4+2);
  expect(await noOverflow(page)).toBe(true);expect(f.errors).toEqual([]);
 });
}
