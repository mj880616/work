import { test, expect } from '@playwright/test';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// S52-14 FILES-상자접힘기억(요청함 11/07 11:33, 명진 'ㅇ' — 상자만, 기기 종류별): [파일] 저장소 상자(원드라이브·구글 드라이브) 머리를 눌러 접으면
// 서버 view_prefs.box_shut.<기기>.files에 기억된다(기기 저장 없음) — 다른 화면에 갔다 오거나 새로고침해도 접힌 채, 펼치면 펼친 채.
// 기기 종류는 폰 브라우저(폭 760 이하 = phone)·그 밖(pc)이 따로: 폰에서 접어도 PC 칸은 그대로. 안쪽 폴더 펼침은 기억하지 않는다. 이름은 모두 가짜.
// 사진 [폴더] 상자는 photos-folders.spec.mjs, DB 적용 전(400) 거절은 아래 마지막 시험.
const tree = page => page.locator('#filesRoot [data-fx-tree]');
const box = (page, s) => tree(page).locator(`[data-fx-box="${s}"]`);
const toggle = (page, s) => box(page, s).locator('[data-fx-box-tog]');
const goAway = async page => {
  await clickView(page, 'photos');
  await expect(page.locator('#filesView')).toBeHidden();
};

for (const [width, device] of [[412, 'phone'], [884, 'pc'], [1280, 'pc']]) test(`파일 ${width}: 원드라이브 상자 접기 → 다른 화면 갔다 와도·새로고침해도 접힘 → 펼치면 펼친 채(서버 box_shut.${device})`, async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors } = await start(page, width);
  const prefs = await installViewPrefsServer(page);
  await openFiles(page, width);
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'gd')).toHaveAttribute('aria-expanded', 'true');
  await toggle(page, 'od').click();
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'false');
  await expect(box(page, 'od').locator('.ft-box-body')).toHaveCount(0);
  await expect(toggle(page, 'gd')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => prefs.value?.box_shut).toEqual({ [device]: { files: ['od'] } });
  await goAway(page);
  await openFiles(page, width);
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await openFiles(page, width);
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page, 'gd')).toHaveAttribute('aria-expanded', 'true');
  // 구글 드라이브도 접으면 두 개, 원드라이브를 펼치면 구글 드라이브만.
  await toggle(page, 'gd').click();
  await expect.poll(() => prefs.value?.box_shut?.[device]?.files).toEqual(['od', 'gd']);
  await toggle(page, 'od').click();
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => prefs.value?.box_shut?.[device]?.files).toEqual(['gd']);
  await page.reload();
  await openFiles(page, width);
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'gd')).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: `test-results/files-box-fold-${width}.png` });
  expect(errors).toEqual([]);
});

test('파일: 기기 종류별 — PC 칸에 접힘이 있어도 폰 브라우저(412)는 펼친 채, 폰에서 접으면 PC 칸은 그대로', async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors } = await start(page, 412);
  const prefs = await installViewPrefsServer(page, { box_shut: { pc: { files: ['od', 'gd'] }, app: { photos: ['od'] } } });
  await page.reload();
  await openFiles(page, 412);
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'gd')).toHaveAttribute('aria-expanded', 'true');
  await toggle(page, 'gd').click();
  await expect.poll(() => prefs.value?.box_shut).toEqual({ pc: { files: ['od', 'gd'] }, app: { photos: ['od'] }, phone: { files: ['gd'] } });
  expect(errors).toEqual([]);
});

test('파일 412: DB 적용 전(서버가 box_shut을 거절 400)이면 이번 접속만 접히고 알림·오류 없음', async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors } = await start(page, 412);
  const prefs = await installViewPrefsServer(page);
  prefs.denyKeys = ['box_shut'];
  await openFiles(page, 412);
  await toggle(page, 'od').click();
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(800);
  expect(prefs.value?.box_shut).toBeUndefined();
  await expect(toggle(page, 'od')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.kptu-toast, [role="alert"]:visible').filter({ hasText: '저장하지 못했어요' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
