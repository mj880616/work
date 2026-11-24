// SHARE-보관함·HTML공유 (docs/design/share-html-pages.md): the share page shows an HTML file page in its own sandboxed frame
// (share/frame.html); the file cannot read the sign-in (browser storage), cookies or the page around it, while its own scripts and
// a CDN library run. NOTE-게시 ③: the Web2 upload screen (공유 페이지 [+ HTML]) is gone; links already sent keep opening here.
import {test, expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const READ = SB + '/functions/v1/share-page-read';
const CDN = 'https://cdn.jsdelivr.net/npm/fake-chart@1.0.0/dist/chart.min.js';
const CODE = 'k7q2m9xa';


// The file: an inline script draws a "graph", a CDN library adds a line, and probes try to reach what must stay out of reach.
const FILE = (mark = '첫 판') => `<!doctype html><html><head><meta charset="utf-8"><title>민자철도 그래프</title>
<script src="${CDN}"></script></head><body>
<h1 id="mark">${mark}</h1><canvas id="c" width="120" height="40"></canvas><p id="graph"></p><p id="cdn"></p><pre id="probe"></pre>
<script>
var g=document.getElementById('c').getContext('2d');g.fillRect(0,0,60,20);document.getElementById('graph').textContent='graph ok';
document.getElementById('cdn').textContent=window.fakeChart?'cdn ok':'cdn missing';
function probe(f){try{var v=f();return 'open:'+String(v).slice(0,80);}catch(e){return 'blocked';}}
var r={
 storage:probe(function(){return localStorage.length+JSON.stringify(Object.keys(localStorage));}),
 parentStorage:probe(function(){return parent.localStorage.length;}),
 cookie:probe(function(){return document.cookie;}),
 parentDoc:probe(function(){return parent.document.title;}),
 topHref:probe(function(){return top.location.href;})
};
document.getElementById('probe').textContent=JSON.stringify(r);
</script></body></html>`;

const cdnRoute = page => page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({status:200, contentType:'application/javascript', body:'window.fakeChart={ok:true};'}));
async function expectSealed(frame) {
  await expect(frame.locator('#graph')).toHaveText('graph ok');
  await expect(frame.locator('#cdn')).toHaveText('cdn ok');
  const probe = JSON.parse(await frame.locator('#probe').textContent());
  expect(probe).toEqual({storage:'blocked', parentStorage:'blocked', cookie:'blocked', parentDoc:'blocked', topHref:'blocked'});
}

for (const width of [412, 1440]) test('공유 화면: 짧은 주소로 HTML 파일이 격리 칸에서 열리고, 꺼진 링크는 안 열림 ' + width, async ({page}) => {
  const errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.setViewportSize({width, height:900});
  await cdnRoute(page);
  let open = true, html = FILE();
  const asked = [];
  await page.route(SB + '/**', route => {
    const request = route.request();
    if (request.url() !== READ) return route.abort();
    asked.push(request.postDataJSON());
    return open
      ? route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:{kind:'html', title:'민자철도 그래프', html}})})
      : route.fulfill({status:404, contentType:'application/json', body:JSON.stringify({error:'not_found'})});
  });
  // The file must not reach this site's storage either (e.g. an old Web1 sign-in): the probe below says 'blocked'.
  await page.goto(testOrigin + `/share/?s=graph-test-${CODE}`);
  // ?s= moves after # at once (a reload does not send it again).
  await expect.poll(() => page.evaluate(() => location.search + '|' + location.hash)).toBe(`|#s=graph-test-${CODE}`);
  const frame = page.locator('iframe.sr-html-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  await expectSealed(page.frameLocator('iframe.sr-html-frame'));
  await expect(page).toHaveTitle('민자철도 그래프 · 공유 페이지');
  expect(asked[0]).toEqual({slug:`graph-test-${CODE}`});
  const box = await frame.boundingBox();
  expect(box.width).toBeGreaterThan(width * 0.9);
  // A new file on the same link: the same address shows it.
  html = FILE('둘째 판');
  await page.reload();
  await expect(page.frameLocator('iframe.sr-html-frame').locator('#mark')).toHaveText('둘째 판');
  // The link is off: the same "can't open" card, no frame.
  open = false;
  await page.reload();
  await expect(page.locator('.sr-closed')).toContainText('열 수 없는 링크예요');
  await expect(page.locator('iframe.sr-html-frame')).toHaveCount(0);
  // frame.html opened directly (not sandboxed) draws nothing.
  await page.goto(testOrigin + '/share/frame.html');
  await page.evaluate(() => window.postMessage({type:'kptu-share-html', html:'<p id="x">ran</p>'}, '*'));
  await expect(page.locator('#x')).toHaveCount(0);
  expect(consoleErrors.filter(t => /Content Security Policy/i.test(t))).toEqual([]);
  expect(errors).toEqual([]);
});
