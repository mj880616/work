import {test, expect} from '@playwright/test';
// S73-06 UI-스크롤막대잡기(명진 11/27: 스크롤 손잡이가 창 오른쪽 끝에 너무 붙어 있어 마우스로 잡기 어렵다).
// 공용 규칙(base-ui.css ::-webkit-scrollbar, 값은 theme-tokens.css --ds-scrollbar-*) 한 곳이 모든 화면의 막대를 정한다.
// PC(마우스): 잡히는 칸 14px, 손잡이는 양옆 3px씩 띄워 보이는 폭 8px. 폰(터치): 예전 그대로 6px·틈 0.
// 화면마다 따로 보지 않고 공용 두 파일만 불러온 빈 화면에서 잰다(막대가 보이도록 headless 기본의 --hide-scrollbars를 뺀다).
test.use({launchOptions: {ignoreDefaultArgs: ['--hide-scrollbars']}});
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="${BASE}/app/theme-tokens.css"><link rel="stylesheet" href="${BASE}/app/base-ui.css"></head>
<body style="margin:0"><div id="box" style="width:300px;height:120px;overflow:auto"><div style="height:600px">긴 내용</div></div></body></html>`;

async function measure(page) {
  await page.setContent(PAGE, {waitUntil: 'load'});
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-scrollbar-size').trim() !== '');
  return page.evaluate(() => {
    const box = document.getElementById('box');
    const bar = getComputedStyle(box, '::-webkit-scrollbar'), thumb = getComputedStyle(box, '::-webkit-scrollbar-thumb');
    return {
      barWidth: bar.width, gap: thumb.borderTopWidth, clip: thumb.backgroundClip, taken: box.offsetWidth - box.clientWidth,
      pointerFine: matchMedia('(hover:hover) and (pointer:fine)').matches,
    };
  });
}

test('PC 1280: 막대 칸 14px · 손잡이는 가장자리에서 3px 띄움(보이는 폭 8px) · 내용 폭은 그만큼만 줄어듦', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 800});
  const m = await measure(page);
  expect(m.pointerFine).toBe(true);
  expect(m.barWidth).toBe('14px');
  expect(m.gap).toBe('3px');
  expect(m.clip).toBe('padding-box');
  expect(m.taken).toBe(14);
  expect(14 - 2 * parseFloat(m.gap)).toBeGreaterThanOrEqual(8);
});

test('폰(터치): 막대는 예전 그대로 6px · 틈 0', async ({browser}) => {
  const ctx = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});
  const page = await ctx.newPage();
  const m = await measure(page);
  expect(m.pointerFine).toBe(false);
  expect(m.barWidth).toBe('6px');
  expect(m.gap).toBe('0px');
  await ctx.close();
});
