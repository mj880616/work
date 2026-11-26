import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
// UI-기록줄균일(S70-85, 명진 2026-11-26 09:29 "어떤건 위아래로 길고 어떤건 짧아 … 펼치기가 차지하는 공간 때문인거같은데 훨씬더 균일화할 방법 없나",
// 08:19 결정 '두 줄'): 조직 관리 기록·사업 관리 기록 줄은 한 줄 글·두 줄 넘는 글·그림 하나·그림 둘 모두 같은 높이(본문 두 줄 높이).
// [펼치기] 글자 줄 없음. 본문 글자를 누르면 그 자리에서 펴고 다시 누르면 접힘, 잘린 줄만 ⋯ 아래 꺾쇠(키보드 Enter·Space). ⋯ 메뉴는 그대로. 자료는 모두 가짜.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG=Array.from({length:12},(_,i)=>`가짜 긴 기록 ${i+1}번째 줄`).join('\n');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const ph=i=>({drive_file_id:'drvRow'+i,file_name:`가짜 사진 ${i}.jpg`,mime_type:'image/jpeg',size_bytes:1000});
const PDF={drive_file_id:'drvRowPdf',file_name:'가짜 공문.pdf',mime_type:'application/pdf',size_bytes:2000};
const link=(id,summary,at,attachments,place)=>({id,workspace_id:'w',summary,origin:null,note_id:'n-'+id,organization_id:place==='o'?'o':null,project_id:place==='p'?'p':null,status:'confirmed',note:{id:'n-'+id,workspace_id:'w',occurred_at:at,raw_text:summary||'',kind:'basket',title:null,attachments}});
const links=place=>[
 link('l-one','가짜 한 줄 연결 기록','2026-10-05T03:00:00Z',[],place),
 link('l-long',LONG,'2026-10-05T02:00:00Z',[],place),
 link('l-ph1','','2026-10-04T03:00:00Z',[ph(1)],place),
 link('l-ph2','','2026-10-04T02:00:00Z',[ph(2),ph(3)],place),
 link('l-mix','가짜 사진과 공문','2026-10-03T02:00:00Z',[ph(4),PDF],place),
];
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const home=await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links'&&(u.searchParams.get('select')||'').includes('note:app_notes'),r=>{
  const u=new URL(r.request().url());if(r.request().method()!=='GET'||Number(u.searchParams.get('offset')||0))return r.fulfill({json:[]});
  const place=u.searchParams.get('organization_id')==='in.(o)'?'o':u.searchParams.get('project_id')==='in.(p)'?'p':null;return r.fulfill({json:place?links(place):[]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()!=='GET'?r.fallback():r.fulfill({json:[
  {id:'u-one',organization_id:'o',raw_text:'가짜 짧은 기록',occurred_at:'2026-10-06T16:00:00Z'},
  {id:'u-long',organization_id:'o',raw_text:LONG,occurred_at:'2026-10-06T15:00:00Z'},
  {id:'u-two',organization_id:'o',raw_text:'가짜 두 줄 넘는 한 문단 기록입니다 '.repeat(10),occurred_at:'2026-10-06T14:00:00Z'}]}));
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'image/png',body:PNG}):r.fallback());
 return {...home,errors};
}
// 줄 높이 = 테두리를 뺀 안쪽 높이(사업 관리 줄은 첫 줄만 위 테두리가 없다).
const innerH=l=>l.evaluate(e=>e.clientHeight);
const SCREENS=[
 {name:'조직 관리 기록',ids:['u-one','u-long','u-two','l-one','l-long','l-ph1','l-ph2','l-mix'],row:id=>`#wdUpdates [data-wd-up="${id}"],#wdUpdates [data-basket-link="${id}"]`,
  text:{'u-long':'.wd-log-main>p','l-long':'[data-link-summary-text]'},menu:{'l-long':['[data-basket-link-menu]','#basketLinkMenu'],'u-long':['[data-wd-up-menu]','#wdUpMenu']},
  open:async page=>{await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();await expect(page.locator('#wdModal')).toBeVisible();}},
 {name:'사업 관리 기록',ids:['l-one','l-long','l-ph1','l-ph2','l-mix'],row:id=>`#ps3Body [data-ps3-records]>[data-basket-link="${id}"]`,
  text:{'l-long':'.ps3-rec-text'},menu:{'l-long':['[data-ps3-record-menu]','#ps3RecordMenu']},
  open:async page=>{await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();await expectProjectDetail(page,'p');}},
];
for(const width of [390,1280])for(const s of SCREENS){
 test(`${s.name}: 줄 높이 모두 같음 · [펼치기] 줄 없음 · 글 눌러 펴고 접기 · 꺾쇠 키보드 · ⋯ 그대로 ${width}`,async({page})=>{
  const f=await fixture(page,width);await s.open(page);
  const row=id=>page.locator(s.row(id));
  for(const id of s.ids)await expect(row(id)).toBeVisible();
  await expect(row('l-ph2').locator('[data-record-photo] img')).toHaveCount(2);
  // 1) 같은 높이(한 줄 글·두 줄 넘는 글·그림 하나·그림 둘·그림+파일)
  const hs=[];for(const id of s.ids)hs.push(await innerH(row(id)));
  for(const h of hs)expect(Math.abs(h-hs[0]),JSON.stringify({ids:s.ids,hs})).toBeLessThanOrEqual(1);
  // 작은 그림은 줄 높이 안, 본문 옆
  const thumb=await row('l-ph1').locator('[data-record-photo]').boundingBox(),rb=await row('l-ph1').boundingBox();
  expect(thumb.height).toBeLessThanOrEqual(rb.height);expect(Math.abs(thumb.width-thumb.height)).toBeLessThan(1);
  // 2) [펼치기]·[접기] 글자 줄 없음
  await expect(page.locator('.kptu-clamp-more')).toHaveCount(0);
  await expect(page.getByText(/^(펼치기|접기)$/)).toHaveCount(0);
  // 잘리지 않은 한 줄 기록은 꺾쇠 없음, 잘린 줄은 꺾쇠(⋯ 아래, 같은 줄 높이 안)
  await expect(row('l-one').locator('[data-rec-fold]')).toHaveCount(0);
  const long=row('l-long'),chev=long.locator('[data-rec-fold]'),text=long.locator(s.text['l-long']);
  await expect(chev).toHaveAttribute('aria-expanded','false');await expect(chev).toHaveAttribute('aria-label','펼치기');
  const [mb,cb,lb]=[await long.locator(s.menu['l-long'][0]).boundingBox(),await chev.boundingBox(),await long.boundingBox()];
  // ⋯(누르는 칸 44px 그대로)의 가운데 아래, 같은 열, 줄 안. 꺾쇠 자리를 누르면 꺾쇠가 눌린다(⋯ 아래쪽 위에 겹쳐 놓임).
  expect(cb.y).toBeGreaterThanOrEqual(mb.y+mb.height/2);expect(cb.y+cb.height).toBeLessThanOrEqual(lb.y+lb.height);
  expect(Math.abs((cb.x+cb.width/2)-(mb.x+mb.width/2))).toBeLessThanOrEqual(2);expect(mb.width).toBeGreaterThanOrEqual(44);expect(mb.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(([x,y])=>!!document.elementFromPoint(x,y)?.closest('[data-rec-fold]'),[cb.x+cb.width/2,cb.y+cb.height/2])).toBe(true);
  // 그림+파일: 접힌 줄에는 파일 이름이 없고(꺾쇠 있음), 펴면 보인다
  await expect(row('l-mix').locator('.record-file-name')).toBeHidden();await expect(row('l-mix').locator('[data-rec-fold]')).toHaveCount(1);
  await expect(row('l-mix').locator('[data-record-files-count]')).toBeVisible();await expect(row('l-mix').locator('[data-record-files-count]')).toHaveAttribute('aria-label','파일 1개');
  // 날짜 칸·⋯ 세로 자리는 모든 줄이 같다(줄 위끝에서 잰 거리)
  const offs=[];for(const id of s.ids)offs.push(await row(id).evaluate(e=>{const t=e.getBoundingClientRect().top,d=e.querySelector('.wd-log-day,.basket-link-day,.ps3-rec-line time').getBoundingClientRect().top,m=e.querySelector('.wd-up-more,.basket-link-more,.ps3-rec-more')?.getBoundingClientRect().top;return [Math.round(d-t),m==null?null:Math.round(m-t)]}));
  for(const o of offs){expect(Math.abs(o[0]-offs[0][0])).toBeLessThanOrEqual(1);if(o[1]!=null)expect(Math.abs(o[1]-offs[0][1])).toBeLessThanOrEqual(1);}
  // 3) 글 눌러 펴기 → 그 줄만 길어지고 기록은 열리지 않음 → 다시 눌러 접기
  await text.click();
  await expect(chev).toHaveAttribute('aria-expanded','true');await expect(chev).toHaveAttribute('aria-label','접기');
  expect(await innerH(long)).toBeGreaterThan(hs[0]+15);
  expect(await innerH(row('l-one'))).toBe(hs[s.ids.indexOf('l-one')]);
  await expect(page.locator('#kptuRecordSheet')).toBeHidden();
  expect(await page.evaluate(()=>window.KPTURouter.current)).not.toBe('basket');
  await text.click();
  await expect(chev).toHaveAttribute('aria-expanded','false');expect(await innerH(long)).toBe(hs[s.ids.indexOf('l-long')]);
  // 4) 꺾쇠 키보드: Enter로 펴고 Space로 접기
  await chev.focus();await page.keyboard.press('Enter');await expect(chev).toHaveAttribute('aria-expanded','true');
  await expect(chev).toBeFocused();await page.keyboard.press(' ');await expect(chev).toHaveAttribute('aria-expanded','false');
  // 그림+파일 줄 펴기 → 파일 이름 보임
  await row('l-mix').locator('[data-rec-fold]').click();await expect(row('l-mix').locator('.record-file-name')).toBeVisible();
  await row('l-mix').locator('[data-rec-fold]').click();await expect(row('l-mix').locator('.record-file-name')).toBeHidden();
  // 5) ⋯ 메뉴는 그대로 열린다
  const [trigger,menu]=s.menu['l-long'];await long.locator(trigger).click();await expect(page.locator(menu)).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator(menu)).toBeHidden();
  // 6) 펼칠 것이 없는 줄의 글을 누르면 지금처럼 그 기록을 연다(폰 = 겹쳐 보기, PC = 잊지 말기)
  await row('l-one').locator(s.name==='사업 관리 기록'?'.ps3-rec-text':'[data-link-summary-text]').click();
  if(width<761)await expect(page.locator('#kptuRecordSheet')).toBeVisible();
  else await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
// 조직 관리 기록의 직접 쓴 긴 기록도 같은 길(글 눌러 펴기·⋯ 그대로).
for(const width of [390,1280])test(`조직 관리 직접 쓴 기록: 글 눌러 펴고 접기, ⋯ [수정] 그대로 ${width}`,async({page})=>{
 const f=await fixture(page,width);await SCREENS[0].open(page);
 const row=page.locator('#wdUpdates [data-wd-up="u-two"]'),text=row.locator('.wd-log-main>p'),chev=row.locator('[data-rec-fold]');
 const h=await innerH(row);await expect(chev).toHaveAttribute('aria-expanded','false');
 await text.click();await expect(chev).toHaveAttribute('aria-expanded','true');expect(await innerH(row)).toBeGreaterThan(h);
 await text.click();await expect(chev).toHaveAttribute('aria-expanded','false');expect(await innerH(row)).toBe(h);
 await row.locator('[data-wd-up-menu]').click();await expect(page.locator('#wdUpMenu')).toBeVisible();
 await expect(page.locator('#wdUpMenu').getByRole('button',{name:'수정',exact:true})).toBeVisible();
 expect(f.errors).toEqual([]);
});
