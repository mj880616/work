import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-창아래버튼통일(2026-11-07 명진 요청 10:55, 시안 docs/design/mockups/sheet-footer-buttons.html 'A'):
// 창 아래 버튼 줄의 [삭제]·[완료]·[저장]은 높이·모서리·글자 크기·굵기·안쪽 여백이 같고 테두리 선이 없다. 다른 것은 채움 정도만
// (저장 = 진한 채움, 보조 = 연한 채움, 삭제 = 바탕 없는 빨간 글자·왼쪽 끝). 폰(390)·폴드(884)·PC(1280). 모의 자료(openHome)만 쓴다.
test.use({hasTouch:true});
const go=(page,view)=>page.evaluate(v=>window.KPTURouter.go(v),view);
const TRANSPARENT='rgba(0, 0, 0, 0)';

// 한 줄의 보이는 버튼 모양. role: save(주 동작)·sub(보조)·del(지우기).
const DANGER='.danger,.tl-danger,.wd-danger,.ps3-danger,.ps3-danger-btn,.ps3-record-danger,.ps-danger,.ci-delete';
const readFoot=(page,sel)=>page.locator(sel).first().evaluate((foot,DANGER)=>{const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
 const probe=document.createElement('i');document.body.append(probe);const color=v=>{probe.style.color=`var(${v})`;return getComputedStyle(probe).color};
 const tokens={primary:color('--kptu-primary'),soft:color('--kptu-primary-soft'),danger:color('--kptu-danger'),onPrimary:color('--kptu-on-primary'),ink:color('--kptu-ink'),h:css('--kptu-control-height')};probe.remove();
 const buttons=[...foot.querySelectorAll('button:is(.primary,.secondary,.ghost,'+DANGER+'):not(.icon-btn,.row-act,.ds-chip,.ds-seg-btn,.mini)')].filter(b=>b.checkVisibility()&&b.getBoundingClientRect().width>0).map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);
  return {label:b.textContent.trim(),role:b.matches('.primary')?'save':b.matches(DANGER)?'del':'sub',h:Math.round(r.height*10)/10,left:Math.round(r.left),right:Math.round(r.right),
   br:s.borderRadius,fs:s.fontSize,fw:s.fontWeight,pl:s.paddingLeft,pr:s.paddingRight,bw:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].join(' '),bg:s.backgroundColor,color:s.color}});
 const fr=foot.getBoundingClientRect();return {tokens,buttons,left:Math.round(fr.left),right:Math.round(fr.right)}},DANGER);

function family(name,{tokens,buttons}){
 expect(buttons.length,name+' 버튼').toBeGreaterThan(0);
 const first=buttons[0];
 for(const b of buttons){
  const n=`${name} [${b.label}]`;
  expect(b.h,n+' 높이').toBe(parseFloat(tokens.h));
  for(const k of ['br','fs','fw','pl','pr'])expect(b[k],n+' '+k+' 같음').toBe(first[k]);
  expect(b.bw,n+' 테두리 선 없음').toBe('0px 0px 0px 0px');
  if(b.role==='save'){expect(b.bg,n+' 진한 채움').toBe(tokens.primary);expect(b.color).toBe(tokens.onPrimary);}
  if(b.role==='sub'){expect(b.bg,n+' 연한 채움').toBe(tokens.soft);expect(b.color).toBe(tokens.ink);}
  if(b.role==='del'){expect(b.bg,n+' 바탕 없음').toBe(TRANSPARENT);expect(b.color,n+' 빨간 글자').toBe(tokens.danger);}
 }
 const del=buttons.findIndex(b=>b.role==='del'),save=buttons.findIndex(b=>b.role==='save');
 if(del>=0){expect(del,name+' [삭제] 맨 왼쪽').toBe(0);if(buttons.length>1)expect(buttons[1].left-buttons[0].right,name+' [삭제]는 떨어져 왼쪽 끝').toBeGreaterThan(16);}
 if(save>=0)expect(save,name+' [저장] 맨 오른쪽').toBe(buttons.length-1);
 console.log('[footer] '+name+' | '+buttons.map(b=>`${b.label}(${b.role} ${b.h}px)`).join(' '));
}

for(const width of [390,884,1280]){
 test(`할 일 수정 창 [삭제][완료][저장] 한 가족 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page);await go(page,'tasks');
  await page.locator('#gtTaskBody [data-gt-edit]').first().click();await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtDeleteBtn')).toBeVisible();await expect(page.locator('#gtToggleBtn')).toBeVisible();
  const foot=await readFoot(page,'#gtTaskModal .gt-modal-actions');
  family('할 일 수정 '+width,foot);
  const del=foot.buttons.find(b=>b.role==='del');expect(del.left-foot.left,'[삭제]는 줄 왼쪽 끝').toBeLessThanOrEqual(2);
  expect(foot.right-foot.buttons.at(-1).right,'끝 버튼은 줄 오른쪽 끝').toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
 });

 test(`일정·자료·사업 보고·사업영역 창 아래 줄 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page);
  const open=async(view,btn,modal,name,save)=>{await go(page,view);await page.locator(btn).click();await expect(page.locator(modal)).toBeVisible();
   family(name+' '+width,await readFoot(page,`${modal} .modal-action-footer:has(${save})`));await page.keyboard.press('Escape');await expect(page.locator(modal)).toBeHidden();};
  await open('calendar','#newEventBtn','#eventModal','일정 등록','#saveEventBtn');
  await open('library','#newDocumentBtn','#documentModal','자료 등록','#saveDocumentBtn');
  await open('meetings','#newMeetingBtn','#meetingModal','사업 보고','#saveMeetingBtn');
  await open('projects','#newProjectBtn','#ps3CreateModal','사업영역 만들기','#ps3CreateSave');
  expect(errors).toEqual([]);
 });

 // 화면을 한 번씩 연 뒤 만들어진 모든 창의 아래 줄을 잠깐 보이게 해 같은 규칙을 잰다(숨은 버튼도 보이게 해서).
 test(`모든 창 아래 줄 전수 ${width}`,async({page})=>{
  test.setTimeout(120000);
  await page.setViewportSize({width,height:900});
  await openHome(page);
  for(const v of ['tasks','calendar','basket','library','meetings','team','projects','pages','files','photos','ledger','diary','home']){await go(page,v);await page.waitForTimeout(300);}
  const ids=await page.evaluate(()=>{const out=[];let i=0;for(const f of document.querySelectorAll('.modal .modal-action-footer,.modal .save-row')){
   if(f.parentElement.closest('.modal-action-footer,.save-row'))continue;f.dataset.footProbe=String(++i);out.push({i,host:f.closest('.modal').id});}return out});
  expect(ids.length,'창 아래 줄 수').toBeGreaterThanOrEqual(15);
  for(const {i,host} of ids){
   const sel=`[data-foot-probe="${i}"]`;
   await page.evaluate(sel=>{const f=document.querySelector(sel),m=f.closest('.modal');m.dataset.probeWas=m.className;m.classList.remove('hidden');m.style.visibility='visible';
    for(let p=f;p&&p!==m;p=p.parentElement){if(p.hidden){p.hidden=false;p.dataset.probeHidden='1'}if(p.classList.contains('hidden')){p.classList.remove('hidden');p.dataset.probeClass='1'}}
    f.querySelectorAll('.hidden,[hidden]').forEach(b=>{b.classList.remove('hidden');b.hidden=false});},sel);
   const foot=await readFoot(page,sel);
   if(foot.buttons.length)family(host,foot);
   await page.evaluate(sel=>{const m=document.querySelector(sel).closest('.modal');m.className=m.dataset.probeWas;m.style.visibility='';},sel);
  }
 });
}
