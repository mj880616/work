// UI-화면정리 C '구성 개선'(요청함 10/28 20:03 C-1~6, S48-46): 세 폭(폰 접은 412·펼친 884·PC 1440)에서 이번에 바꾼 곳을 재고 사진을 남긴다.
// 가짜 서버(filter-chip-fixture)만 쓰고 운영 서버는 부르지 않는다. 사진은 test-results/ui-audit/c-*.png(app-e2e-check.yml이 ui-audit-<shard>로 올림),
// 잰 값은 '::notice title=ui-abc-c'로 남겨 PR의 세 폭 비교표 '후' 칸에 옮긴다. 아래 기대값은 바뀐 규칙이 그대로인지 확인한다.
import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {baseState, mockApp, signIn} from './helpers/filter-chip-fixture.mjs';

const WIDTHS = [[412, 915], [884, 1000], [1440, 900]];
const DIR = 'test-results/ui-audit';
const go = async (page, view) => { await page.evaluate(v => window.KPTURouter?.go?.(v), view); await expect(page.locator(`#${view}View`)).toBeVisible(); await page.waitForTimeout(600); await page.evaluate(() => window.scrollTo(0, 0)); };

for (const [width, height] of WIDTHS) {
  test(`UI-화면정리 C 세 폭 비교 ${width}px`, async ({page}) => {
    test.setTimeout(180000);
    mkdirSync(DIR, {recursive: true});
    await page.setViewportSize({width, height});
    const state = baseState(); state.meetings = []; state.meetingWrites = []; state.downloads = []; state.deletes = [];
    await mockApp(page, state);
    await signIn(page);
    const out = {};

    // C2 정리함 폭: PC는 본문 칸 끝까지(예전 1100px에서 멈춤).
    await go(page, 'basket');
    const basket = await page.evaluate(() => {
      const v = document.querySelector('#basketView').getBoundingClientRect(), a = document.querySelector('#appView'), cs = getComputedStyle(a);
      return {width: Math.round(v.width), gapRight: Math.round(a.getBoundingClientRect().right - parseFloat(cs.paddingRight) - v.right)};
    });
    out.basketWidth = basket.width; out.basketGapRight = basket.gapRight;
    if (width >= 761) expect(Math.abs(basket.gapRight), '정리함 오른쪽 빈 띠').toBeLessThanOrEqual(2);
    // C4 업데이트 줄: 복사 아이콘 없음, ⋯ 하나.
    out.rowCopy = await page.locator('[data-basket-row-copy]').count();
    expect(out.rowCopy).toBe(0);
    out.rowState = await page.locator('#basketRows .basket-row-state').allTextContents().then(t => t.filter(x => x.trim() === '미분류').length);
    expect(out.rowState, '[미분류] 칩을 고른 동안 줄의 미분류 글자').toBe(0);
    await page.screenshot({path: `${DIR}/c-basket-${width}.png`});

    // C3 일기 달력: 칸 사이 0(격자선 한 겹), 둥근 모서리 없음. 한 달 높이와 그 아래 목록 시작 자리.
    await go(page, 'diary');
    const diary = await page.evaluate(() => {
      const days = document.querySelector('#diaryRoot .diary-days'), cell = document.querySelector('#diaryRoot .diary-days .diary-cell:not(.diary-blank)') || document.querySelector('#diaryRoot .diary-days > *');
      const cs = getComputedStyle(days), cc = getComputedStyle(cell), r = days.getBoundingClientRect();
      return {gap: cs.columnGap, radius: cc.borderTopLeftRadius, monthHeight: Math.round(r.height), monthBottom: Math.round(r.bottom), vh: innerHeight};
    });
    Object.assign(out, {diaryGap: diary.gap, diaryRadius: diary.radius, diaryMonthHeight: diary.monthHeight, diaryMonthBottom: diary.monthBottom});
    expect(diary.gap).toBe('0px'); expect(diary.radius).toBe('0px');
    await page.screenshot({path: `${DIR}/c-diary-${width}.png`});

    // C5 폰 하단바: 하단바에 칸이 없는 화면(자료실)에서는 아무 칸도 칠하지 않는다.
    if (width <= 760) {
      await go(page, 'library');
      out.tabCurrent = await page.locator('.mobile-tabs button[aria-current="page"]').count();
      expect(out.tabCurrent).toBe(0);
    }

    // C6 메뉴 창: 폰은 메뉴 줄 → 계정(맨 아래), 펼친 폭 서랍은 줄마다 선 없음.
    if (width < 1024) {
      await page.locator('#mobileMenuTab:visible, [data-mobile-menu-open]:visible, .topline-menu-btn:visible').first().click({timeout: 3000}).catch(() => {});
      const menuOpen = await page.locator('#mobileMenu').isVisible();
      if (menuOpen) {
        const m = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('#mobileMenu .mobile-menu-panel nav button')].filter(b => b.getClientRects().length);
          const lines = btns.filter(b => parseFloat(getComputedStyle(b).borderTopWidth) > 0).length;
          const nav = document.querySelector('#mobileMenu .mobile-menu-panel nav').getBoundingClientRect(), acc = document.querySelector('#mobileAccountGroup');
          const accTop = acc && acc.children.length ? acc.getBoundingClientRect().top : null;
          return {lines, accountBelow: accTop === null ? null : accTop >= nav.bottom - 1};
        });
        out.menuRowLines = m.lines; out.menuAccountBelow = m.accountBelow;
        expect(m.lines, '메뉴 줄마다 그은 선').toBe(0);
        if (m.accountBelow !== null) expect(m.accountBelow, '계정은 메뉴 줄 아래').toBe(true);
        await page.screenshot({path: `${DIR}/c-menu-${width}.png`});
        await page.keyboard.press('Escape');
      } else out.menu = 'not-opened';
    }

    const esc = t => t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    process.stdout.write(`::notice title=ui-abc-c ${width}::${esc(JSON.stringify(out))}\n`);
  });
}
