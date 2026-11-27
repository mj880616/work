import {test, expect} from '@playwright/test';
// S73-06 UI-스크롤막대잡기(명진 11/27 정정: "화면 우측에 붙어있더라도 마우스를 가져다대면 커지는 편을 선호").
// 공용 규칙(base-ui.css ::-webkit-scrollbar, 값은 theme-tokens.css --ds-scrollbar-*) 한 곳이 모든 화면의 막대를 정한다.
// PC(마우스): 막대 칸 14px 고정(글 안 흔들림) · 창 오른쪽 끝에 붙음(틈 없음) · 평소 보이는 굵기 4px 톤다운 → 마우스를 올리면 10px·진하게.
// 폰(터치): 예전 그대로 6px. 막대가 실제로 그려진 모습을 사진으로 찍어 칸 안의 색칠된 폭을 잰다(headless 기본의 --hide-scrollbars를 뺀다).
test.use({launchOptions: {ignoreDefaultArgs: ['--hide-scrollbars']}});
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="${BASE}/app/theme-tokens.css"><link rel="stylesheet" href="${BASE}/app/base-ui.css"></head>
<body style="margin:0;background:#fff"><div id="box" style="width:300px;height:120px;overflow:auto;background:#fff"><div style="height:600px">긴 내용</div></div></body></html>`;

async function open(page) {
  await page.setContent(PAGE, {waitUntil: 'load'});
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-scrollbar-size').trim() !== '');
}
// 막대 칸 한가운데 높이(손잡이 위쪽 12px)의 한 줄을 읽어 흰 바탕이 아닌 칸의 왼쪽 끝·오른쪽 끝·가장 진한 밝기를 돌려준다.
async function paintedRow(page) {
  const png = await page.screenshot({clip: {x: 0, y: 0, width: 300, height: 120}});
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const k = img.width / 300, y = Math.round(12 * k);
    let first = -1, last = -1, darkest = 255;
    for (let x = 0; x < img.width; x++) {
      const [r, gg, bb] = g.getImageData(x, y, 1, 1).data, lum = (r + gg + bb) / 3;
      if (x >= 270 * k && lum < 250) { if (first < 0) first = x; last = x; darkest = Math.min(darkest, lum); }
    }
    return {first: first / k, last: (last + 1) / k, width: (last + 1 - first) / k, darkest};
  }, png.toString('base64'));
}
const taken = page => page.evaluate(() => { const b = document.getElementById('box'); return b.offsetWidth - b.clientWidth; });

test('PC 1280: 막대 칸 14px 고정 · 오른쪽 끝에 붙음 · 평소 4px 톤다운 → 마우스를 올리면 10px·진하게 · 글 폭 그대로', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 800});
  await open(page);
  expect(await page.evaluate(() => matchMedia('(hover:hover) and (pointer:fine)').matches)).toBe(true);
  await page.mouse.move(900, 600); // 막대에서 먼 곳
  expect(await taken(page)).toBe(14);
  const rest = await paintedRow(page);
  expect(rest.last).toBe(300);                 // 창(칸) 오른쪽 끝에 붙음: 끝 틈 없음
  expect(rest.width).toBeGreaterThanOrEqual(3);
  expect(rest.width).toBeLessThanOrEqual(5);   // 평소엔 가늘게
  await page.mouse.move(293, 12);              // 막대 칸 위(보이는 손잡이가 아닌 바깥쪽 투명 부분)
  const hover = await paintedRow(page);
  expect(hover.last).toBe(300);
  expect(hover.width).toBeGreaterThanOrEqual(9); // 올리면 굵게
  expect(hover.width).toBeLessThanOrEqual(11);
  expect(hover.darkest).toBeLessThan(rest.darkest); // 올리면 진하게
  expect(await taken(page)).toBe(14);          // 칸 폭 불변 = 글 안 흔들림
});

test('폰(터치): 막대는 예전 그대로 6px, 올림 효과로 굵어지지 않음', async ({browser}) => {
  const ctx = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});
  const page = await ctx.newPage();
  await open(page);
  expect(await page.evaluate(() => matchMedia('(hover:hover) and (pointer:fine)').matches)).toBe(false);
  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ['--ds-scrollbar-size', '--ds-scrollbar-inset-rest', '--ds-scrollbar-inset-hover'].map(n => cs.getPropertyValue(n).trim());
  });
  expect(m).toEqual(['6px', '0px', '0px']);
  await ctx.close();
});
