import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-버튼줄이기(2026-10-22 사용자 결정): UI-버튼기준 점검 표(#957 ③)와 자료 화면 점검에서 고른 큰 버튼만 줄인다.
// 창 안 주 동작은 글자 폭·36px(--kptu-control-height)·오른쪽, 보조는 32px(--ds-compact-height), 누르는 범위는 그대로 44px.
// 모의 자료(openHome)만 쓴다. 실제 서버는 부르지 않는다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';

async function boot(page,width,beforeLoad){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page,beforeLoad?{beforeLoad:()=>beforeLoad(page)}:{});
 if(beforeLoad){await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});}
 return errors;
}
const go=(page,view)=>page.evaluate(v=>window.KPTURouter.go(v),view);
// 보이는 크기와 누르는 범위(버튼 또는 ::after 중 큰 쪽).
const measure=loc=>loc.evaluate(el=>{const r=el.getBoundingClientRect(),a=getComputedStyle(el,'::after');
 const press=Math.max(r.height,a.content==='none'?0:Math.max(parseFloat(a.height)||0,parseFloat(a.minHeight)||0));
 return {h:Math.round(r.height),w:Math.round(r.width),top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right),press,font:getComputedStyle(el).fontSize}});
async function check(loc,h,name){await expect(loc,name).toBeVisible();const m=await measure(loc);expect(m.h,name+' 보이는 높이').toBe(h);expect(m.press,name+' 누르는 범위').toBeGreaterThanOrEqual(44);
 if(await loc.isEnabled()){await loc.focus();expect(await loc.evaluate(el=>document.activeElement===el),name+' 키보드 초점').toBe(true);}return m;}
// 창 주 동작: 36px, 창 폭보다 훨씬 좁고(글자 폭), 오른쪽 끝에 붙음.
async function modalSave(page,modal,save,name){
 const m=await check(page.locator(save),36,name);
 const card=await page.locator(modal+' .modal-card').first().evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {w:r.width,right:r.right-parseFloat(s.paddingRight)}});
 expect(m.w,name+' 글자 폭').toBeLessThan(card.w/2);
 expect(Math.abs(m.right-card.right),name+' 오른쪽').toBeLessThanOrEqual(2);
}
const noWideScroll=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);

for(const width of [390,1280]){
 test(`빠른 입력 [추가] 36px·할 일 추가 창 ${width}`,async({page})=>{
  const errors=await boot(page,width);
  await check(page.locator('#homeView .home-quick [data-quick-save]'),36,'홈 [추가]');
  if(width<1024)await check(page.locator('#homeView .home-quick .home-quick-big'),32,'홈 [큰 창에서 쓰기]');
  await go(page,'basket');await check(page.locator('#basketView [data-basket-list] .home-quick [data-quick-save]').first(),36,'정리함 [추가]');
  await go(page,'tasks');await check(page.locator('#tasksView .home-quick [data-quick-save]'),36,'할 일 [추가]');
  if(width<1024)await check(page.locator('#tasksView .home-quick .home-quick-detail'),32,'할 일 [상세 설정으로 추가]');
  await page.locator('#tasksView .home-quick-detail').click();await expect(page.locator('#eventModal')).toBeVisible();
  await modalSave(page,'#eventModal','#saveEventBtn','할 일 창 [저장]');
  await check(page.locator('#eventTaskProject'),32,'[프로젝트 선택 ▾]');
  await check(page.locator('#eventModal .gt-pick-btn'),32,'[파일 붙이기]');
  await noWideScroll(page);expect(errors).toEqual([]);
 });

 test(`할 일 수정: 기한 줄 한 줄·같은 높이, [저장] 작게 ${width}`,async({page})=>{
  const errors=await boot(page,width);await go(page,'tasks');
  await page.locator('#gtTaskBody [data-gt-edit]').first().click();await expect(page.locator('#gtTaskModal')).toBeVisible();
  if(width>=1024){
   const due=await measure(page.locator('#gtEditDue'));expect(due.h).toBe(36);
   for(const b of await page.locator('#gtTaskModal .gt-due-quick>button').all()){const m=await check(b,36,'기한 빠른 버튼');expect(m.top).toBe(due.top);expect(m.bottom).toBe(due.bottom);}
   // UI-저장자리(2026-10-27): PC에서도 [저장]은 창 아래 줄 오른쪽(36px). 제목 줄로 올린 10/20 배치는 되돌렸다.
   const save=await check(page.locator('#gtSaveBtn'),36,'아래 줄 [저장]');
   expect(save.top).toBeGreaterThan(due.bottom);
   await check(page.locator('#gtDeleteBtn'),32,'[삭제]');
  }else{
   await check(page.locator('#gtSaveBtn'),36,'할 일 수정 창 [저장]');
   await check(page.locator('#gtDeleteBtn'),32,'[삭제]');
  }
  await noWideScroll(page);expect(errors).toEqual([]);
 });

 test(`창 주 동작 글자 폭: 일정·회의·자료·프로젝트 ${width}`,async({page})=>{
  const errors=await boot(page,width);
  await go(page,'calendar');await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
  await modalSave(page,'#eventModal','#saveEventBtn','일정 [저장]');await page.keyboard.press('Escape');await expect(page.locator('#eventModal')).toBeHidden();
  await go(page,'meetings');await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
  await modalSave(page,'#meetingModal','#saveMeetingBtn','[사업 보고 저장]');await page.keyboard.press('Escape');await expect(page.locator('#meetingModal')).toBeHidden();
  await go(page,'library');await page.locator('#newDocumentBtn').click();await expect(page.locator('#documentModal')).toBeVisible();
  await modalSave(page,'#documentModal','#saveDocumentBtn','자료 [등록]');await page.keyboard.press('Escape');await expect(page.locator('#documentModal')).toBeHidden();
  await go(page,'projects');await page.locator('#newProjectBtn').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await modalSave(page,'#ps3CreateModal','#ps3CreateSave','프로젝트 [저장]');
  await noWideScroll(page);expect(errors).toEqual([]);
 });

 test(`프로젝트·담당조직 상세 버튼 ${width}`,async({page})=>{
  const errors=await boot(page,width);
  await go(page,'projects');await page.locator('#projectGrid [data-ps3-project="p"]').first().click();await expect(page.locator('#ps3DetailModal')).toBeVisible();
  // MTG-프로젝트합치기 3단계: 기록 입력칸·[기록]·[큰 창에서 쓰기]는 없어졌다(기록은 사업 보고 한 곳). 잴 버튼이 없음을 확인한다.
  await expect(page.locator('#ps3DetailModal [data-ps3-record-input],#ps3DetailModal [data-ps3-record-big]')).toHaveCount(0);
  // TASK-바로처리통일: 할 일 줄 [연결 해제]는 줄 ⋯ 안(공용 할 일 줄)이라 따로 잴 버튼이 없다.
  await expect(page.locator('#ps3DetailModal .gt-linked').getByRole('button',{name:/연결 해제/})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await go(page,'team');await page.locator('[data-ps-workplace-org="o"]').first().click();await expect(page.locator('#wdModal')).toBeVisible();
  // TEST-시험안정화: 창이 먼저 뜨고 조직 이름·할 일·자료가 늦게 붙어 위 높이가 바뀐다(가운데 정렬 창이라 버튼 위치도 같이 움직임). 상태 소유자(workplace-detail)가 다 그린 뒤의 최종 상태를 기다린 다음에 잰다.
  await expect(page.locator('#wdTitle')).not.toHaveText('조직 상세');await expect(page.locator('#wdState')).toHaveText('');
  await expect(page.locator('#wdTaskBody [data-wait]')).toHaveCount(0);await expect(page.locator('#wdDocBody [data-wd-doc-state]')).toBeAttached();
  // ORG-PC상세정리(요청 14:10) → UI-전수디자인점검 F08: PC 상세 칸·폰 창 모두 ⤢가 입력칸 안 오른쪽 아래(보조 32px), [저장]은 작은 버튼(32px), 누르는 범위 44px.
  const input=await measure(page.locator('#wdInboxText')),big=await check(page.locator('#wdInboxBig'),32,'조직 ⤢');await check(page.locator('#wdInboxSave'),32,'조직 [저장]');
  expect(big.bottom).toBeLessThanOrEqual(input.bottom);expect(big.right).toBeLessThanOrEqual(input.right);expect(big.top).toBeGreaterThan(input.top);
  if(width<1024)await expect(page.locator('#wdModal .gt-linked').getByRole('button',{name:/연결 해제/})).toHaveCount(0);
  await noWideScroll(page);expect(errors).toEqual([]);
 });

 test(`업무일지·공유 페이지·HWP 버튼 ${width}`,async({page})=>{
  const errors=await boot(page,width);
  await go(page,'journal');await check(page.locator('#journalView [data-journal-save]'),36,'업무일지 [저장]');
  await go(page,'pages');await check(page.locator('#pagesView [data-sp-new]'),36,'[새 공유 페이지]');
  await go(page,'hwp');
  if(width<1024){
   // HWP-화면가득: 폰은 위 얇은 줄의 [파일 ▾]·[저장 ▾]만 작은 버튼(32px)으로 보인다.
   await check(page.locator('#hwpMenuFile'),32,'[파일 ▾]');await check(page.locator('#hwpMenuSave'),32,'[저장 ▾]');
  }else{
   await check(page.locator('#hwpLabPick'),32,'[파일 선택]');await check(page.locator('#hwpLabUpload'),32,'[자료실에 올리기]');
   await expect(page.locator('#hwpLabSave')).toBeVisible();expect((await measure(page.locator('#hwpLabSave'))).h).toBe(36);
  }
  await noWideScroll(page);expect(errors.filter(e=>!/rhwp|wasm/i.test(e))).toEqual([]);
 });

 // 자료가 있어야 보이는 화면(#957에서 못 본 곳): 바구니 파일 카드·⋯ 메뉴 창에 보이는 높이 35px 이상 버튼이 없음.
 test(`자료 화면 점검: 정리함 파일 카드·⋯ 메뉴 ${width}`,async({page})=>{
  const HWP={drive_file_id:'drive-hwp',file_name:'가상 요구안.hwp',mime_type:'application/x-hwp',size_bytes:2048};
  const errors=await boot(page,width,p=>p.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>r.fulfill({json:[{id:'n1',workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:'',ai_export_allowed:true,archived_at:null,attachments:[HWP],metadata:{}}]})));
  await go(page,'basket');await page.locator('[data-basket-row="n1"]').first().click();await expect(page.locator('[data-basket-file-card]').first()).toBeVisible();
  const big=root=>page.evaluate(root=>[...document.querySelectorAll(root+' :is(button,a)')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().height>=35)
   .filter(e=>getComputedStyle(e).borderTopStyle!=='none'&&parseFloat(getComputedStyle(e).borderTopWidth)>0&&!e.closest('[role="menu"],.basket-more-menu')).map(e=>e.textContent.trim()),root);
  expect(await big('[data-basket-detail]')).toEqual([]);
  await noWideScroll(page);expect(errors).toEqual([]);
 });
}
