import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { WIDTHS, measureWidth, uniqueWidthIssues } from './helpers/width-audit.mjs';
import { cases } from './helpers/width-screens.mjs';
// LAYOUT-폭별검사(사용자 요청 2026-11-28: 폴드 펼친 화면에서 노트 화면이 완전히 깨졌던 것 같은 일이 또 있는지 조사해 체크).
// 폭 표(helpers/width-audit.mjs WIDTHS: 폰·폴드 접힘·펼침 세로·가로·태블릿·PC와 미디어 쿼리 경계 양쪽) × 화면 표(helpers/width-screens.mjs SCREENS:
// 메뉴의 모든 화면 + 상세 화면, 화면마다 폴더 누르기·줄 밀기·메뉴 열기 같은 동작)의 칸마다 가로 넘침·글 칸 너무 좁음·0폭 칸·겹침·막대가 창을 덮음을 잰다.
// 가짜 서버·지어낸 자료만 쓴다(운영 접속 없음). 조사 결과: docs/design/fold-layout-audit.md.
// 알려진 실패: tests/app-e2e/width-layout-known.json — 아직 안 고친 칸만, 이유·원장 이름과 함께. 고친 PR은 그 줄을 지워 검사를 다시 켠다.
// AUDIT_OUT=폴더 를 주면 칸마다 잰 결과(json)와 사진(png)을 남기고 판정하지 않는다(조사 보고 만들 때만).
const KNOWN = JSON.parse(readFileSync(new URL('./width-layout-known.json', import.meta.url), 'utf8')).known;
const known = (screen, act, w) => {
  const hit = KNOWN.filter(k => k.screen === screen && k.acts.includes(act) && (k.widths === '*' || k.widths.includes(w)));
  return new Set(hit.flatMap(k => k.kinds));
};

for (const c of cases()) for (const W of WIDTHS) {
  if (!c.only(W.w)) continue;
  const title = `WL ${c.screen}${c.act ? ' · ' + c.act : ''} ${W.w}×${W.h}: 넘침·좁은 칸·0폭 칸·겹침 없음`;
  test(title, async ({ browser }) => {
    test.setTimeout(90000);
    // 줄 밀기는 손가락 입력이라 폰 틀 동작만 터치 기기로 연다(PC 폭은 마우스 기기 — pointer 미디어 쿼리가 실제 기기와 같게).
    const touch = /밀기/.test(c.act);
    const context = await browser.newContext({ viewport: { width: W.w, height: W.h }, hasTouch: touch });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.setViewportSize({ width: W.w, height: W.h });
      await c.run(page, W.w);
      await page.setViewportSize({ width: W.w, height: W.h }); // 화면 여는 도우미가 높이를 바꿨으면 기기 모양으로 되돌린다
      await page.waitForTimeout(700); // 가짜 서버 응답과 마지막 그리기가 끝날 때까지
      const issues = uniqueWidthIssues(await measureWidth(page));
      const dir = process.env.AUDIT_OUT;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        const key = `${c.screen}${c.act ? '-' + c.act : ''}-${W.w}`.replace(/[\s·/]/g, '');
        writeFileSync(`${dir}/${key}.json`, JSON.stringify({ screen: c.screen, act: c.act, width: W.w, height: W.h, issues, errors }, null, 1));
        if (issues.length || process.env.AUDIT_SHOTS) await page.screenshot({ path: `${dir}/${key}.png` });
        return;
      }
      const allow = known(c.screen, c.act, W.w);
      expect(issues.filter(i => !allow.has(i.kind))).toEqual([]);
    } finally { await context.close(); }
  });
}

// 알려진 실패 목록 자체 점검: 화면·동작 이름이 화면 표에 있고, 이유와 원장 이름이 있다(오타로 아무 칸도 막지 않는 줄이 남지 않게).
test('WL 알려진 실패 목록: 화면·동작이 화면 표에 있고 이유·원장 이름이 있음', () => {
  const names = new Set(cases().map(c => c.screen + '|' + c.act));
  for (const k of KNOWN) {
    for (const act of k.acts) expect(names.has(k.screen + '|' + act), `${k.screen} · ${act}`).toBe(true);
    expect(k.reason?.length > 5 && k.ledger?.length > 2, k.screen).toBe(true);
    expect(k.widths === '*' || k.widths.every(w => WIDTHS.some(x => x.w === w)), k.screen).toBe(true);
  }
});
