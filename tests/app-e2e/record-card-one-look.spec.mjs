import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// UI-기록카드하나로(S70-42, 명진 11/25 15:09 "사진1 이게 너무 내용은 적은데 칸은 커서 좀;" · "사진이 있는거랑 글자가 있는거랑 먼가 통일감이 없음
// 사진은 차라리 썸네일을 보여주던가"): 담당조직 기록 목록에서 사진 기록 카드도 글 기록 카드와 같은 틀 [날짜 칸 'MM.DD.' | 본문 | ⋯].
// 큰 [사진 n ⌄] 접기 줄 없이 작은 정사각 그림을 바로(3장 넘으면 [+n]), 누르면 기존 크게 보기. 카드 높이는 글 두 줄 카드 이하. 자료는 모두 가짜.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAPAAAAC0CAIAAAAl/ja/AAACVUlEQVR4Xu3csU3DABRFUYIQEzAA4zBBakajZgImSY1SewKqiAVi5OjH4uqcHiJLV9Zvng+n8/IAFY+VB4FfgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBk/I09zSvL89z/5z/7nv5mXgEb2hSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAialMHvctzi4/Prlj/nPt6Pb/f5ob/zhiZF0KQImpTD6bwMPZBv23GFb9vBOicHKYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUixW2s1iBWU4OUgRNisUK+7BYgXVODlIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KRYrbGexArOcHKQImhSLFfZhsQLrnBykCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIsVtjOYgVmOTlIETQpFivsw2IF1jk5SBE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkWKywncUKzHJykCJoUixW2IfFCqxzcpAiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETcrgh2aGVpBwhTc0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJqUC4j6NQ80dYyPAAAAAElFTkSuQmCC','base64');
const N1='55555555-0000-4000-8000-000000000001',N2='55555555-0000-4000-8000-000000000002';
const img=n=>({drive_file_id:'drvQ'+n,file_name:`가짜 현장 사진 ${n}.png`,mime_type:'image/png',size_bytes:6});
const thisYear=new Date().getUTCFullYear();

async function fixture(page,width){
 await page.setViewportSize({width,height:width>900?800:915});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const home=await openHome(page);
 const notes={
  [N1]:{id:N1,workspace_id:'w',occurred_at:`${thisYear}-11-25T00:35:00Z`,raw_text:'',kind:'basket',title:null,attachments:[img(1)]},
  [N2]:{id:N2,workspace_id:'w',occurred_at:`${thisYear}-11-23T02:00:00Z`,raw_text:'',kind:'basket',title:null,attachments:[1,2,3,4,5,6].map(n=>img(n+1))},
 };
 const links=[
  {id:'66666666-0000-4000-8000-000000000001',workspace_id:'w',summary:'그림 1장 · 가짜 현장 사진 1.png',note_id:N1,organization_id:'o',project_id:null,status:'confirmed',origin:'record_input'},
  {id:'66666666-0000-4000-8000-000000000002',workspace_id:'w',summary:'사진 6장',note_id:N2,organization_id:'o',project_id:null,status:'confirmed',origin:'record_input'},
 ];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.request().method()==='GET'?r.fulfill({json:links.map(l=>({...l,note:structuredClone(notes[l.note_id])}))}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()==='GET'?r.fulfill({json:[{id:'u2',organization_id:'o',raw_text:'가짜 간담회 첫째 줄\n가짜 간담회 둘째 줄',occurred_at:`${thisYear}-11-24T01:00:00Z`}]}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'image/png',body:PNG}):r.fallback());
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 return {...home,errors,row:n=>page.locator(`#wdUpdates [data-basket-link="66666666-0000-4000-8000-00000000000${n}"]`),text:page.locator('#wdUpdates [data-wd-up="u2"]')};
}
const box=l=>l.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});

for(const width of [412,1280]){
 test(`사진 기록 카드는 글 기록 카드와 같은 틀: 'MM.DD.' 날짜 칸, 작은 그림, 접는 줄 없음, 높이 글 두 줄 이하 ${width}`,async({page})=>{
  const f=await fixture(page,width),photo=f.row(1),many=f.row(2);
  await expect(f.text).toBeVisible();
  await expect(photo).toBeVisible();
  // 날짜 칸: 글 카드와 같은 꼴·같은 자리
  await expect(f.text.locator('.wd-log-day')).toHaveText('11.24.');
  await expect(photo.locator('.basket-link-day')).toHaveText('11.25.');
  const [td,pd]=[await box(f.text.locator('.wd-log-day')),await box(photo.locator('.basket-link-day'))];
  expect(Math.abs(td.x-pd.x)).toBeLessThan(1.5);
  expect(await photo.locator('.basket-link-day').evaluate(e=>getComputedStyle(e).fontSize)).toBe(await f.text.locator('.wd-log-day').evaluate(e=>getComputedStyle(e).fontSize));
  // 큰 접기 줄 없음, 작은 그림이 바로 보인다(정사각, 작게)
  await expect(photo.locator('details[data-record-photos], .photo-fold-toggle')).toHaveCount(0);
  const thumb=photo.locator('[data-record-photo] img');
  await expect(thumb).toBeVisible();
  const tb=await box(photo.locator('[data-record-photo]'));
  expect(Math.abs(tb.w-tb.h)).toBeLessThan(1);expect(tb.w).toBeLessThanOrEqual(44);
  // 사진만 있는 기록: 그림 옆에 기록 한 줄(파일 이름)
  const lb=await box(photo.locator('[data-link-summary-text]'));
  expect(lb.x).toBeGreaterThan(tb.x+tb.w);expect(lb.h).toBeLessThan(26);
  // 안쪽 여백·높이: 글 두 줄 카드 이하
  expect(await photo.evaluate(e=>getComputedStyle(e).paddingTop)).toBe(await f.text.evaluate(e=>getComputedStyle(e).paddingTop));
  const [tc,pc]=[await box(f.text),await box(photo)];
  expect(pc.h).toBeLessThanOrEqual(tc.h+0.5);
  // 6장: 앞 3장 + [+3], 누르면 나머지
  await expect(many.locator('[data-photo-tile]:visible')).toHaveCount(3);
  await expect(many.locator('[data-record-photos-more]')).toHaveText('+3');
  expect((await box(many.locator('[data-link-summary-text]'))).w).toBeGreaterThan(40); // 옆 한 줄 글이 남는다
  expect((await box(many)).h).toBeLessThanOrEqual(tc.h+0.5);
  await many.locator('[data-record-photos-more]').click();
  await expect(many.locator('[data-photo-tile]:visible')).toHaveCount(6);
  await expect(many.locator('[data-record-photos-more]')).toHaveCount(0);
  // 누르면 기존 크게 보기
  await photo.locator('[data-record-photo]').click();
  await expect(page.locator('[data-basket-photo-view]')).toBeVisible();
  if(process.env.S70_42_SHOTS){await page.keyboard.press('Escape');await photo.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.S70_42_SHOTS}/org-records-${width}.png`});}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
