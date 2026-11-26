// S70-16 UI-고른글메뉴·형광펜(사용자 2026-11-25 09:51·09:54, 시안 docs/design/mockups/highlight-underline-options.html) — 브리핑 룸.
// ① 두 문단을 고르면 '선택한 글' 막대가 고른 글과 앞뒤 줄을 가리지 않는다(PC 글 칸 옆·위·아래, 폰 하단바 위). PC는 마우스를 누른 채 고르는 동안 뜨지 않고 뗀 뒤 뜬다.
// ② PC: 막대 빈 곳('선택한 글' 글자)을 끌면 따라 움직이고, 단추 위에서 끌면 움직이지 않으며, 끈 뒤에도 단추가 동작한다.
// ③ [형광펜] 색 점 → 그 색으로 글 안 표시(서버 줄 mark_kind highlight·mark_color) → 새로 불러와도 같은 색 → 칠한 곳을 골라 색 바꾸기 → 다음 [형광펜]은 마지막 색 → [삭제].
// ④ 형광 줄은 모아 보기(노트로 보관의 '밑줄')에 섞이지 않는다.
// 자료 이름·문장은 모두 예시. 서버는 흉내(helpers/select-text-bar.mjs).
import { test, expect } from '@playwright/test';
import { openBriefRoom as open, openBrief, zone, bar, pickSpan, coversText, ends, box, LINE1, LINE2, DOC } from './helpers/select-text-bar.mjs';

for (const [label, width, height] of [['phone-390', 390, 844], ['pc-1280', 1280, 860]]) {
  test(`고른 글 막대: 글 안 가림·끌어 옮기기·형광펜 색 칠하기·바꾸기·삭제 (${label})`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const s = await open(page);
    await openBrief(page);
    const pc = width > 760;

    // ① 두 문단 고르기 — PC는 진짜 마우스 끌기(누른 채에는 막대 없음, 뗀 뒤 뜸).
    if (pc) {
      const p = await ends(page, LINE1, LINE2);
      await page.mouse.move(p.a.x, p.a.y);
      await page.mouse.down();
      await page.mouse.move((p.a.x + p.b.x) / 2, (p.a.y + p.b.y) / 2, { steps: 4 });
      await page.mouse.move(p.b.x, p.b.y, { steps: 4 });
      await page.waitForTimeout(150);
      await expect(bar(page)).toBeHidden();
      await page.mouse.up();
    } else {
      expect(await pickSpan(page, LINE1, LINE2)).toBe(true);
    }
    await expect(bar(page)).toBeVisible();
    const pen = bar(page).getByRole('button', { name: '형광펜', exact: true });
    await expect(pen).toBeVisible();
    await expect(bar(page).getByRole('button', { name: '밑줄 저장', exact: true })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /^형광펜 (노랑|초록|파랑|분홍|주황)$/ })).toHaveCount(5);
    expect(await coversText(page)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${label}-select.png` });
    if (!pc) {
      // 폰: 하단바 위 고정 줄(하단바와 겹치지 않음).
      const tabs = await page.locator('nav.mobile-tabs').evaluate(el => el.getBoundingClientRect().top).catch(() => height);
      const b = await box(bar(page));
      expect(b.y + b.h).toBeLessThanOrEqual(tabs + 1);
    }

    // ② PC 끌어 옮기기: '선택한 글' 글자를 잡고 끌면 움직임, 단추 위 끌기는 안 움직임.
    if (pc) {
      const before = await box(bar(page));
      const grip = await box(bar(page).locator('.hl-bar-label'));
      await page.mouse.move(grip.x + 6, grip.y + grip.h / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + 66, grip.y + grip.h / 2 + 90, { steps: 6 });
      await page.mouse.up();
      const moved = await box(bar(page));
      expect(Math.round(moved.x - before.x)).toBe(60);
      expect(Math.round(moved.y - before.y)).toBe(90);
      await expect(bar(page)).toBeVisible();
      const copy = await box(bar(page).getByRole('button', { name: '복사', exact: true }));
      await page.mouse.move(copy.x + copy.w / 2, copy.y + copy.h / 2);
      await page.mouse.down();
      await page.mouse.move(copy.x + copy.w / 2 + 50, copy.y + copy.h / 2 + 40, { steps: 5 });
      await page.mouse.up();
      expect(await box(bar(page))).toEqual(moved);
      // 끈 자리도 화면 안.
      expect(moved.x).toBeGreaterThanOrEqual(0);
      expect(moved.x + moved.w).toBeLessThanOrEqual(width);
      if (!(await bar(page).isVisible())) expect(await pickSpan(page, LINE1, LINE2)).toBe(true);
    }

    // ③ 초록 점 → 초록 형광(서버 줄) — 끈 뒤에도 단추가 동작.
    await bar(page).getByRole('button', { name: '형광펜 초록' }).click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toMatchObject({ source_type: 'brief', source_id: DOC, mark_kind: 'highlight', mark_color: 'green', memo: null });
    expect(s.posts[0].quote).toContain(LINE1);
    expect(s.posts[0].quote).toContain(LINE2);
    const marks = zone(page).locator('mark.hl-mark.hl-pen');
    await expect(marks.first()).toHaveClass(/hl-c-green/);
    await expect(zone(page)).toContainText(LINE1);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${label}-green.png` });
    const bg = await marks.first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // 새로 불러와도 같은 색.
    await page.reload();
    await expect(page.locator('#appView')).toBeVisible();
    await openBrief(page);
    await expect(zone(page).locator('mark.hl-mark.hl-pen').first()).toHaveClass(/hl-c-green/);

    // 칠한 곳을 고르면 [삭제]·색 바꾸기. 파랑으로.
    expect(await pickSpan(page, '통합 운영', '연내')).toBe(true);
    await expect(bar(page).getByRole('button', { name: '삭제', exact: true })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: '형광펜', exact: true })).toBeHidden();
    await expect(bar(page).getByRole('button', { name: '형광펜 초록' })).toHaveAttribute('aria-pressed', 'true');
    await bar(page).getByRole('button', { name: '형광펜 파랑' }).click();
    await expect.poll(() => s.patches.length).toBe(1);
    expect(s.patches[0]).toMatchObject({ mark_color: 'blue' });
    expect(Object.keys(s.patches[0]).sort()).toEqual(['mark_color', 'updated_at']);
    await expect(zone(page).locator('mark.hl-mark.hl-pen').first()).toHaveClass(/hl-c-blue/);

    // 다음 형광은 마지막 색(파랑).
    expect(await pickSpan(page, '예시 위원: 다음 회의', '다시 보기로')).toBe(true);
    await expect(bar(page).getByRole('button', { name: '형광펜 파랑' })).toHaveAttribute('aria-pressed', 'true');
    await bar(page).getByRole('button', { name: '형광펜', exact: true }).click();
    await expect.poll(() => s.posts.length).toBe(2);
    expect(s.posts[1]).toMatchObject({ mark_kind: 'highlight', mark_color: 'blue' });

    // 형광 줄은 모아 보기(노트로 보관 '밑줄')에 섞이지 않는다.
    await detail(page).locator('[data-br-archive]').click();
    await expect.poll(() => s.notes.length).toBe(1);
    expect(s.notes[0].raw_text).not.toContain('## 밑줄');

    // [삭제] → 사라짐.
    expect(await pickSpan(page, '통합 운영', '연내')).toBe(true);
    await bar(page).getByRole('button', { name: '삭제', exact: true }).click();
    await expect.poll(() => s.deletes).toBe(1);
    await expect(zone(page).locator('mark.hl-mark.hl-pen')).toHaveCount(1);
    await expect(zone(page).locator('mark.hl-mark.hl-pen', { hasText: '통합 운영' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
const detail = page => page.locator('#briefView [data-br-detail]');
