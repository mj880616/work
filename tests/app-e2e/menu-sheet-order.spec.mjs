import {test,expect} from '@playwright/test';
import {openHome,OPERATOR_MENU_FEATURES} from './helpers/home-entry.mjs';
// S68-36 메뉴 창 정리(명진 11/23 07:58 "여기 메뉴를 아래로 하고 프로필 쓰는 법 이런걸 위로 … 좀 정리좀", 시안 확정 07:59 "ㄱㄱ").
// 폰 [메뉴] 창은 위에서부터 손잡이 → 설정 링크 묶음 → 운영 줄(운영자만 보이는 줄 + 줄 끝 로그아웃) → 선 → 전체 검색 → 메뉴 칸(맨 아래, 하단바 바로 위).
// 메뉴 칸 순서는 사람마다 서버에 저장한 메뉴 순서(view_prefs.menu_layout) 그대로. 운영 줄은 서버 기능 답(app_my_features의 dev_inbox)일 때만 그려진다.
const SETTINGS=['내 프로필','업데이트 소식','앱 정보','쓰는 법','메뉴 수정','화면 색','잠금','의견 보내기'];
const OPERATOR=[...OPERATOR_MENU_FEATURES,'dev_inbox'];
const LAYOUT={bar:['home','note','calendar','meetings','team'],rest:['pages','library','basket','reading','files','brief','hwp','photos','outside','bottom','calls','telegram','arsenal']};
const names=locator=>locator.evaluateAll(list=>list.filter(el=>el.getClientRects().length).map(el=>(el.querySelector('.account-action-name')||el).textContent.trim()));
const rect=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};});

async function openSheet(page){
  const panel=page.locator('#mobileMenu .mobile-menu-panel');
  await page.locator('#mobileMenuTab').click();
  await expect(page.locator('#mobileMenu')).toBeVisible();
  await expect.poll(()=>panel.evaluate(el=>el.getAnimations().length)).toBe(0);
  return panel;
}

for(const width of [390,412]){
  for(const who of ['운영자','일반 사용자']){
    test(`메뉴 창 순서 (${width}px · ${who}): 설정 묶음 → 운영 줄 → 메뉴 칸`,async({page})=>{
      test.setTimeout(90000);
      const operator=who==='운영자';
      await page.setViewportSize({width,height:844});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await openHome(page,operator?{features:OPERATOR,menuLayout:LAYOUT}:{features:[],menuLayout:null});
      const panel=await openSheet(page);
      const settings=page.locator('#mobileMenu .mobile-menu-settings'),ops=page.locator('#mobileMenu .mobile-menu-ops');

      // 위에서 아래로: 설정 묶음 → 운영 줄 → 메뉴 칸. 메뉴 칸 아래 끝이 하단바 바로 위. S70-57: 전체 검색 입구는 홈 머리 줄로(메뉴 창에는 없음).
      await expect(page.locator('#mobileMenu .gs-menu-entry')).toHaveCount(0);
      const tops=await Promise.all(['.mobile-menu-settings','.mobile-menu-ops','nav[aria-label="더 보기"]'].map(s=>rect(page.locator('#mobileMenu '+s)).then(r=>r.top)));
      for(let i=1;i<tops.length;i++)expect(tops[i-1]).toBeLessThan(tops[i]);
      const nav=await rect(page.locator('#mobileMenu nav')),bar=await rect(page.locator('.mobile-tabs'));
      expect(bar.top-nav.bottom).toBeGreaterThanOrEqual(0);expect(bar.top-nav.bottom).toBeLessThanOrEqual(24);

      // 설정 링크 묶음(이 기기에서만 붙는 앱 설치·내려받기 줄은 빼고 본다).
      const shown=(await names(settings.locator('.account-action'))).filter(n=>!/앱 설치|내려받기/.test(n));
      expect(shown).toEqual(SETTINGS);
      // 운영 줄: 운영자는 업데이트 기록·가입자 현황·받은 의견 + 로그아웃, 일반 사용자는 로그아웃만.
      await expect.poll(()=>names(ops.locator('.account-action'))).toEqual(operator?['업데이트 기록','가입자 현황','받은 의견','로그아웃']:['로그아웃']);
      // 로그아웃은 운영 줄 맨 오른쪽 끝.
      const out=await rect(ops.locator('[data-kptu-logout]')),line=await rect(ops);
      expect(Math.abs(line.right-out.right)).toBeLessThanOrEqual(1);

      // 메뉴 칸: 운영자는 저장한 메뉴 순서 그대로(저장값 맨 앞의 옛 공유 페이지는 없어진 메뉴라 빠지고 자료실이 맨 앞), 일반 사용자는 기본 순서(운영자 메뉴 없음).
      const tiles=await page.locator('#mobileMenu nav button').evaluateAll(list=>list.filter(el=>el.getClientRects().length).map(el=>el.dataset.view||el.dataset.basketKindNav));
      if(operator)expect(tiles).toEqual(['library','basket','reading','files','brief','photos','outside','calls','telegram','arsenal']); // S71-61: 저장값의 hwp는 건너뜀
      else{expect(tiles.slice(0,4)).toEqual(['basket','reading','team','meetings']); /* S68-37: 새 기본에서 자료실·사진은 하단바 칸 */for(const id of ['calls','telegram','arsenal'])expect(tiles).not.toContain(id);}

      // 가로 넘침 없음(화면도 창도).
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      await page.screenshot({path:`test-results/menu-sheet-${width}-${operator?'op':'user'}.png`});

      // 키보드: 손잡이에서 Tab → 내 프로필(화면 순서), Esc로 닫으면 [메뉴] 칸으로 돌아온다.
      const grip=page.locator('#mobileMenu [data-mobile-menu-close]');
      await expect(grip).toBeFocused();
      await page.keyboard.press('Tab');await expect(page.locator('#mobileMenu [data-profile-open]')).toBeFocused();
      await page.keyboard.press('Escape');await expect(page.locator('#mobileMenu')).toBeHidden();await expect(page.locator('#mobileMenuTab')).toBeFocused();
      // 뒤로가기로 닫힌다.
      await openSheet(page);await page.goBack();await expect(page.locator('#mobileMenu')).toBeHidden();
      expect(errors).toEqual([]);
    });
  }
}

test('메뉴 창 (390px · 낮은 화면): 아래 끝에 맞춰 열려 메뉴 칸이 먼저 보이고, 위로 밀면 설정 묶음이 보인다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openHome(page,{features:OPERATOR,menuLayout:LAYOUT});
  await page.setViewportSize({width:390,height:460});
  const panel=await openSheet(page);
  expect(await panel.evaluate(el=>el.scrollHeight>el.clientHeight+1&&Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<=1)).toBe(true);
  const last=await rect(page.locator('#mobileMenu nav button:visible').last()),bar=await rect(page.locator('.mobile-tabs'));
  expect(last.bottom).toBeLessThanOrEqual(bar.top);
  await panel.evaluate(el=>{el.scrollTop=0});
  const grip=await rect(page.locator('#mobileMenu [data-mobile-menu-close]')),profile=await rect(page.locator('#mobileMenu [data-profile-open]'));
  expect(profile.top).toBeGreaterThanOrEqual(grip.bottom);
});
