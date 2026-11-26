import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
// UI-기록줄높이통일(S70-66, 사용자 결정 2026-11-26 08:19 "두 줄" — 시안 B 나안): 조직 관리 기록·사업 관리 진행 기록 줄은 짧든 길든 같은 높이
// [날짜 · 요약 두 줄까지 '…' · 첨부·메모 수 · ›]. 줄을 누르면(Enter/Space도) 그 자리에서 본문 전체·첨부가 펼쳐지고 다시 누르면 접힌다.
// 폴드 펼침·PC 폭에서는 분류 칩(기록이 온 곳) 글자가 줄 안에 보인다. 폰 390 · 폴드 펼침 690 · PC 1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG=Array.from({length:12},(_,i)=>`긴 기록 ${i+1}번째 줄`).join('\n');
const FILES=[{drive_file_id:'f-one',file_name:'합성 자료.pdf',mime_type:'application/pdf'},{drive_file_id:'f-two',file_name:'합성 표.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}];
const link=(id,place,{summary=null,raw='합성 원문',at,files=[],kind='basket'})=>({id,workspace_id:'w',summary,origin:null,note_id:'n-'+id,organization_id:place==='o'?'o':null,project_id:place==='p'?'p':null,status:'confirmed',
 note:{id:'n-'+id,workspace_id:'w',occurred_at:at,raw_text:raw,kind,title:null,metadata:null,attachments:files}});
async function fixture(page,width){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page,{beforeLoad:async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links'&&(u.searchParams.get('select')||'').includes('note:app_notes'),r=>{
   const url=new URL(r.request().url());if(Number(url.searchParams.get('offset')||0))return r.fulfill({json:[]});
   if(url.searchParams.get('project_id')==='in.(p)')return r.fulfill({json:[link('p-long','p',{raw:LONG,at:'2026-10-21T01:00:00Z',files:FILES,kind:'note'}),link('p-short','p',{summary:'한 줄 연결',at:'2026-10-20T01:00:00Z'})]});
   if(url.searchParams.get('organization_id')==='in.(o)')return r.fulfill({json:[link('o-link','o',{raw:LONG,at:'2026-10-03T01:00:00Z',files:FILES,kind:'note'})]});
   return r.fallback();
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()!=='GET'?r.fallback():r.fulfill({json:[
   {id:'u-long',organization_id:'o',raw_text:LONG,occurred_at:'2026-10-05T16:00:00Z'},
   {id:'u-short',organization_id:'o',raw_text:'짧은 기록',occurred_at:'2026-10-04T16:00:00Z'}]}));
 }});
 return {...home,errors};
}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const height=loc=>loc.evaluate(el=>Math.round(el.getBoundingClientRect().height));

for(const width of [390,690,1280]){
 test(`조직 관리 기록: 짧은·긴 기록 줄 높이가 같고, 누르면 본문 전체·첨부, 다시 누르면 접힘 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
  await expect(page.locator('#wdModal')).toBeVisible();
  const row=id=>page.locator(`#wdUpdates [data-wd-up="${id}"]`),longHead=row('u-long').locator('[data-rec-fold-toggle]'),shortHead=row('u-short').locator('[data-rec-fold-toggle]');
  const linkRow=page.locator('#wdUpdates [data-basket-link="o-link"]'),linkHead=linkRow.locator('[data-rec-fold-toggle]');
  await expect(longHead).toBeVisible();await expect(linkHead).toBeVisible();
  // 같은 높이(글 기록 둘·연결 기록 하나 모두), 요약은 두 줄까지.
  const hs=[await height(row('u-long')),await height(row('u-short')),await height(linkRow)];
  expect(hs[0]).toBe(hs[1]);expect(hs[2]).toBe(hs[0]);
  const sum=row('u-long').locator('.rec-fold-sum'),lh=await sum.evaluate(e=>parseFloat(getComputedStyle(e).lineHeight));
  expect((await sum.boundingBox()).height).toBeLessThanOrEqual(lh*2+2);
  // 첨부 수(연결 기록)·접힌 본문
  await expect(linkRow.locator('[data-rec-fold-files]')).toHaveAttribute('data-rec-fold-files','2');
  await expect(linkRow.locator('[data-rec-fold-files]')).toContainText('2');
  await expect(row('u-long').locator('[data-rec-fold-body]')).toBeHidden();await expect(linkRow.locator('.record-files')).toBeHidden();
  // 누르면 그 자리에서 본문 전체
  await longHead.click();
  await expect(longHead).toHaveAttribute('aria-expanded','true');
  const body=row('u-long').locator('[data-rec-fold-body]');await expect(body).toBeVisible();
  await expect(body).toContainText('긴 기록 12번째 줄');
  expect((await body.boundingBox()).height).toBeGreaterThan(lh*10);
  await expect(page.locator('#kptuRecordSheet')).toBeHidden();await expect(page.locator('#wdUpMenu')).toBeHidden();
  expect(await height(row('u-short'))).toBe(hs[1]); // 다른 줄은 그대로
  // 다시 누르면 접힘
  await longHead.click();await expect(longHead).toHaveAttribute('aria-expanded','false');await expect(body).toBeHidden();
  expect(await height(row('u-long'))).toBe(hs[0]);
  // 키보드: Enter로 펼치고 Space로 접기 — 연결 기록은 펼치면 첨부 띠도 보인다(이 화면을 떠나지 않음).
  await linkHead.focus();await page.keyboard.press('Enter');
  await expect(linkHead).toHaveAttribute('aria-expanded','true');await expect(linkRow.locator('.record-files')).toBeVisible();
  await expect(linkRow.locator('[data-record-file="f-one"]')).toBeVisible();await expect(page.locator('#wdModal')).toBeVisible();
  await page.keyboard.press('Space');await expect(linkHead).toHaveAttribute('aria-expanded','false');await expect(linkRow.locator('.record-files')).toBeHidden();
  // 분류 칩(노트에서 이은 줄만 '노트 연결' — 잊지 말기에서 온 줄은 표시 없음): 폰은 그림만, 폴드 펼침·PC는 글자도 줄 안에
  await expect(row('u-long').locator('.rec-fold-chip')).toHaveCount(0);
  const chip=linkRow.locator('.rec-fold-chip-t');
  if(width<600)await expect(chip).toBeHidden();else await expect(chip).toBeVisible();
  expect(await noOverflow(page)).toBe(true);expect(f.errors).toEqual([]);
 });

 test(`사업 관리 진행 기록: 짧은·긴 줄 높이 같음, 누르면 본문 전체·첨부, 다시 누르면 접힘 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
  await expectProjectDetail(page,'p');
  const long=page.locator('[data-basket-link="p-long"]'),short=page.locator('[data-basket-link="p-short"]'),head=long.locator('[data-rec-fold-toggle]');
  await expect(head).toBeVisible();
  // 줄 높이 = 줄(머리 줄 + ⋯) 높이. 목록 줄 사이 선(첫 줄 위는 없음)은 빼고 잰다.
  const line=x=>x.locator('.rec-fold-line'),h=await height(line(long));expect(h).toBe(54);expect(await height(line(short))).toBe(h);
  await expect(long.locator('[data-rec-fold-files]')).toHaveAttribute('data-rec-fold-files','2');
  await expect(short.locator('[data-rec-fold-files]')).toHaveCount(0);
  const route=await page.evaluate(()=>window.KPTURouter.current);
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded','true');
  await expect(long.locator('[data-rec-fold-body]')).toContainText('긴 기록 12번째 줄');
  await expect(long.locator('[data-record-file="f-two"]')).toBeVisible();
  await expect(page.locator('#kptuRecordSheet')).toBeHidden();await expect(page.locator('#ps3DetailModal')).toBeVisible();
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe(route);
  expect(await height(line(short))).toBe(h);
  await head.click();await expect(head).toHaveAttribute('aria-expanded','false');await expect(long.locator('[data-rec-fold-body]')).toBeHidden();
  expect(await height(line(long))).toBe(h);
  // 노트 열기는 ⋯ 메뉴에 그대로 있다(노트에서 이은 줄).
  await long.locator('[data-ps3-record-menu]').click();
  await expect(page.locator('#ps3RecordMenu [data-ps3-record-action="open-note"]')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);expect(f.errors).toEqual([]);
 });
}
