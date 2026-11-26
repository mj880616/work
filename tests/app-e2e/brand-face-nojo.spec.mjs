import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// APP-올인원다이어리 단계 2: 화면 이름·메뉴 글자의 노조 색 단어가 얼굴 단어표(app/brand/brand.mjs)를 거쳐 나오게 바꿨다.
// 저장소(=WORK ON+ 얼굴)에서는 PC 왼쪽 메뉴·폰 하단바·폰 [메뉴] 창·상단 줄·폰 머리줄·탭 제목이 얼굴 기능 전과 한 글자도 같아야 한다.
const texts=(page,selector)=>page.locator(selector).evaluateAll(els=>els.map(el=>el.textContent.trim()));
const settle=async page=>{await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await page.waitForTimeout(300);};
const PC_LABELS={home:'홈',calendar:'일정',team:'조직 관리',meetings:'사업 관리',basket:'잊지 말기',library:'자료실',files:'파일',brief:'브리핑 룸',photos:'사진',outside:'읽을 거리',calls:'통화',telegram:'텔레그램 소식',arsenal:'아스날'};

test('WORK ON+ PC 1280: 메뉴 이름·상단 줄·탭 제목이 그대로다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page);await settle(page);
  await expect(page.locator('.topbar .brand span')).toHaveText('WORK ON+');
  const nav=await page.locator('#appNav .nav-btn[data-view]').evaluateAll(els=>els.map(el=>[el.dataset.view,el.querySelector('.nav-label')?.textContent.trim()||el.textContent.trim()]));
  for(const [view,label] of nav)if(PC_LABELS[view])expect(label,view).toBe(PC_LABELS[view]);
  expect(nav.map(([view])=>view)).toEqual(expect.arrayContaining(['team','meetings']));
  await expect(page).toHaveTitle('홈 · WORK ON+');
  for(const [view,title,where] of [['team','조직 관리 · WORK ON+',['조직 관리']],['meetings','사업 관리 · WORK ON+',['사업 관리']]]){
    await page.evaluate(v=>window.KPTURouter.go(v),view);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('[data-topline-where] li').first()).toHaveText(where[0]);
  }
  await expect(page.locator('#meetingsListCard .add-list-head h2')).toHaveText('사업 관리'); // S70-57: 화면 첫 줄 제목은 없앰(앱 머리 줄) — 읽기용 제목
  expect(errors).toEqual([]);
});

test('WORK ON+ 폰 412: 하단바·[메뉴] 창·머리줄 이름이 그대로다',async({page})=>{
  await page.setViewportSize({width:412,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page,{menuLayout:null});await settle(page);
  expect(await texts(page,'#appView .mobile-tabs button[data-view] span, #appView .mobile-tabs button[data-basket-kind-nav] span')).toEqual(['홈','노트','일정','자료실','사진']); // S68-37: 새 계정 하단바
  const sheet=await texts(page,'#mobileMenu nav[aria-label="더 보기"] button span');
  expect(sheet).toEqual(expect.arrayContaining(['잊지 말기','조직 관리','사업 관리','파일','브리핑 룸']));
  expect(sheet).not.toContain('HWP 편집'); // S71-61: 노트 안 화면
  for(const [view,name] of [['team','조직 관리'],['meetings','사업 관리']]){
    await page.evaluate(v=>window.KPTURouter.go(v),view);
    await expect(page.locator('[data-mobile-view-name]')).toHaveText(name);
  }
  expect(errors).toEqual([]);
});
