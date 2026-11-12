import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-기록첨부표시이름(S61-2): 조직 기록 목록에서 글 없이 사진만 올린 기록은 '요약 없음' 대신 '사진 3장', 파일만이면 '파일 n개'.
// 글이 있는 기록은 그 글 그대로. 자료는 모두 가짜.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const N1='33333333-0000-4000-8000-000000000001',N2='33333333-0000-4000-8000-000000000002',N3='33333333-0000-4000-8000-000000000003';
const img=n=>({drive_file_id:'drvP'+n,file_name:`photo_2026-11-09_0${n}.jpg`,mime_type:'image/jpeg',size_bytes:6});

async function fixture(page,width){
 await page.setViewportSize({width,height:width>900?800:915});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const home=await openHome(page);
 const notes={
  [N1]:{id:N1,workspace_id:'w',occurred_at:'2026-11-11T06:28:00Z',raw_text:'',kind:'basket',title:null,attachments:[img(1),img(2),img(3)]},
  [N2]:{id:N2,workspace_id:'w',occurred_at:'2026-11-10T02:00:00Z',raw_text:'',kind:'basket',title:null,attachments:[{drive_file_id:'drvH',file_name:'합성 요구안.hwp',mime_type:'application/x-hwp',size_bytes:6}]},
  [N3]:{id:N3,workspace_id:'w',occurred_at:'2026-11-09T02:00:00Z',raw_text:'합성 지부 간담회 결과 정리',kind:'basket',title:null,attachments:[img(4)]},
 };
 const links=[N1,N2,N3].map((n,i)=>({id:`44444444-0000-4000-8000-00000000000${i+1}`,workspace_id:'w',summary:null,note_id:n,organization_id:'o',project_id:null,status:'confirmed'}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.request().method()==='GET'?r.fulfill({json:links.map(l=>({...l,note:structuredClone(notes[l.note_id])}))}):r.fallback());
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 return {...home,errors,row:n=>page.locator(`#wdUpdates [data-basket-link="44444444-0000-4000-8000-00000000000${n}"]`)};
}
const shot=async(page,name)=>{if(process.env.S61_2_SHOTS)await page.screenshot({path:`docs/design/screens/s61-2/${name}.png`})};

for(const width of [412,1280]){
 test(`사진만 올린 기록은 '사진 3장', 파일만은 '파일 1개', 글이 있으면 그 글 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await expect(f.row(1).locator('[data-link-summary-text]')).toHaveText('사진 3장');
  await expect(f.row(2).locator('[data-link-summary-text]')).toHaveText('파일 1개');
  await expect(f.row(3).locator('[data-link-summary-text]')).toHaveText('합성 지부 간담회 결과 정리');
  await expect(page.locator('#wdUpdates')).not.toContainText('요약 없음');
  // 사진 띠([사진 n])는 그대로 아래에 있다.
  await expect(f.row(1).locator('[data-record-photos] > summary')).toContainText('사진 3');
  await f.row(1).evaluate(el=>el.scrollIntoView({block:'start'}));
  await shot(page,`org-records-${width}`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
