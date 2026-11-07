// QA-주간정리메뉴간헐 재발(S52-20 #2043 CI, 서로 다른 실행 두 번): 열어 둔 줄 끝 ⋯ 가 한 번의 일 안에서 두 번 이어 다시 그려지면 닫혔다.
// row-more.js 하나만 띄워(가짜 이름 없음, 합성 줄만) 같은 자리를 여러 번 다시 그려도 열린 채인지, 같은 열쇠 두 줄은 하나만 열리는지 본다.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';

async function boot(page) {
  await page.goto(`${appOrigin}/app/login.html`).catch(() => {});
  await page.setContent('<main id="host"></main>');
  await page.addScriptTag({type: 'module', content: `import {rowMore} from '${appOrigin}/app/row-more.js';
    const items = [{text: '고치기', data: {fix: 'a'}}];
    window.paint = (keys = ['a']) => { const ul = document.createElement('ul');
      for (const k of keys) { const li = document.createElement('li'); li.append(rowMore(document, {label: '줄 ' + k, data: {more: k}, items: k === 'a' ? items : [{text: '고치기', data: {fix: k}}]})); ul.append(li); }
      document.getElementById('host').replaceChildren(ul); };
    window.paint(); window.ready = true;`});
  await page.waitForFunction(() => window.ready === true);
}
const box = (page, k = 'a') => page.locator(`#host details.row-more[data-more="${k}"]`);

test('열린 ⋯ 는 한 번의 일 안에서 두 번·세 번 이어 다시 그려도 열린 채', async ({page}) => {
  await boot(page);
  await box(page).locator('summary').click();
  await expect(box(page)).toHaveJSProperty('open', true);
  await page.evaluate(() => { window.paint(); window.paint(); window.paint(); });
  await expect(box(page)).toHaveJSProperty('open', true);
  // 열린 직후(toggle 알림 전)에 이어 두 번 다시 그려도 그대로.
  await page.evaluate(() => { const d = document.querySelector('details.row-more'); d.open = false; });
  await page.evaluate(() => { document.querySelector('details.row-more summary').click(); window.paint(); window.paint(); });
  await expect(box(page)).toHaveJSProperty('open', true);
  // 그 뒤 일(다음 틈)에 다시 그려도 그대로, 메뉴 항목은 그대로 누를 수 있다.
  await page.evaluate(() => new Promise(ok => setTimeout(() => { window.paint(); ok(); }, 0)));
  await expect(box(page)).toHaveJSProperty('open', true);
  await expect(box(page).locator('[data-fix="a"]')).toBeVisible();
});

test('같은 열쇠 줄이 둘이면 하나만 열리고, 다른 곳을 누르면 닫힘', async ({page}) => {
  await boot(page);
  await box(page).locator('summary').click();
  await page.evaluate(() => { window.paint(['a', 'a']); window.paint(['a', 'a']); });
  await expect(page.locator('#host details.row-more[open]')).toHaveCount(1);
  await page.locator('#host').click({position: {x: 300, y: 200}, force: true});
  await expect(page.locator('#host details.row-more[open]')).toHaveCount(0);
});
