import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {noteAction,showBasketRow} from './helpers/basket-more.mjs';
import { openHome } from './helpers/home-entry.mjs';
// MD-표시: 바구니 메모 읽기 화면이 ChatGPT식 마크다운·Mermaid·수식을 안전하게 그리는지, 외부 요청이 0건인지,
// [원문 그대로 보기]가 저장된 글을 그대로 보여 주는지, 도식·수식 도구는 필요한 글에서만 불러오는지 확인한다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const FENCE='```';
const RICH=[
 '# 주간 정리',
 '**굵게** 와 *기울임*, ~~취소~~',
 '',
 '- [ ] 보도자료 초안',
 '- [x] 회의실 예약',
 '',
 '1. 첫째',
 '2. 둘째',
 '',
 '> 인용한 말',
 '',
 '[기사 링크](https://example.com/news) [나쁜 링크](javascript:alert(1)) <script>window.__mdHacked=1</script> <img src="https://tracker.example/pixel.png" onerror="window.__mdHacked=2">',
 '![현장 사진](https://images.example/photo.png)',
 '',
 '---',
 '',
 '| 항목 | 담당 | 기한 |',
 '| :-- | :-: | --: |',
 '| 성명 | 홍보 | 10/20 |',
 '| 집회 | 조직 | 10/25 |',
 '',
 FENCE+'js',
 'const ok = 1 < 2;',
 FENCE,
 '',
 FENCE+'mermaid',
 'flowchart TD',
 '  A[접수] --> B{검토}',
 '  B -->|승인| C[발송]',
 '  B -->|보완| A',
 FENCE,
 '',
 FENCE+'mermaid',
 'sequenceDiagram',
 '  사무국->>위원장: 초안 보고',
 '  위원장-->>사무국: 수정 요청',
 FENCE,
 '',
 '식 $E=mc^2$ 와 가격 $5와 $10',
 '',
 '$$',
 '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
 '$$',
].join('\n');
const PLAIN='그냥 메모\n둘째 줄';

async function fixture(page){
 const seen={external:[],libs:[],errors:[]};
 page.on('pageerror',e=>seen.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')seen.errors.push(m.text());});
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.origin!==testOrigin&&url.origin!==SB)seen.external.push(request.url());
  if(url.pathname.includes('/app/markdown-lib/'))seen.libs.push(url.pathname.split('/app/markdown-lib/')[1]);
 });
 const notes=[
  {id:'rich',raw_text:RICH,occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]},
  {id:'plain',raw_text:PLAIN,occurred_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z',ai_export_allowed:true,attachments:[]},
 ];
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:notes}):r.fulfill({status:500,json:{}}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return seen;
}
async function press(page,locator,width){
 await expect(locator).toBeVisible();
 if(width<761){await locator.evaluate(el=>el.scrollIntoView({block:'center'}));const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();
}
const startedLibs=seen=>[...new Set(seen.libs.map(path=>path.split('/')[0].replace(/-\d.*$/,'')))].sort();

for(const width of [390,1280]){
 test(`basket memo shows ChatGPT markdown, diagrams and math safely with no outside request ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const seen=await fixture(page),detail=page.locator('[data-basket-detail]'),read=detail.locator('[data-basket-read-text]');
  await press(page,page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible'),width);await expect(page.locator('[data-basket-row]')).toHaveCount(2);
  // Plain note first: formatted, but the diagram and math tools are not loaded.
  await press(page,page.locator('[data-basket-row="plain"]'),width);
  await expect(read).toHaveClass(/md-body/);await expect(read.locator('p')).toHaveCount(1);expect(await read.innerText()).toBe(PLAIN);
  expect(startedLibs(seen)).toEqual(['dompurify','markdown-it']);
  await press(page,detail.locator('[data-basket-close]'),width);

  await press(page,page.locator('[data-basket-row="rich"]'),width);
  await expect(read).toHaveClass(/md-body/);
  await expect(read.locator('h1')).toHaveText('주간 정리');
  await expect(read.locator('strong')).toHaveText('굵게');await expect(read.locator('em')).toHaveText('기울임');await expect(read.locator('s')).toHaveText('취소');
  const boxes=read.locator('input.md-task');await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).not.toBeChecked();await expect(boxes.nth(1)).toBeChecked();await expect(boxes.nth(0)).toBeDisabled();await expect(boxes.nth(1)).toBeDisabled();
  await expect(read.locator('ol > li')).toHaveCount(2);await expect(read.locator('blockquote')).toHaveText('인용한 말');await expect(read.locator('hr')).toHaveCount(1);
  // Links: only http(s)/mailto, new window, no opener. The javascript: link is not a link.
  const links=read.locator('a');
  await expect(read.locator('a',{hasText:'기사 링크'})).toHaveAttribute('href','https://example.com/news');
  for(const a of await links.all()){expect(await a.getAttribute('target')).toBe('_blank');expect(await a.getAttribute('rel')).toBe('noopener noreferrer');expect(await a.getAttribute('href')).toMatch(/^(https?|mailto):/);}
  await expect(read.locator('a',{hasText:'나쁜 링크'})).toHaveCount(0);
  // Raw HTML stays text; images are links, never loaded.
  await expect(read.locator('script,img,iframe,object,embed,[onerror],[onclick]')).toHaveCount(0);await expect(read.locator('style:not(.md-mermaid-figure svg > style)')).toHaveCount(0);await expect(read).toContainText('<script>window.__mdHacked=1</script>');
  await expect(read.locator('a.md-image-link')).toHaveText('이미지: 현장 사진');await expect(read.locator('a.md-image-link')).toHaveAttribute('href','https://images.example/photo.png');
  // Table with alignment, code block as text.
  await expect(read.locator('table tr')).toHaveCount(3);await expect(read.locator('th').nth(1)).toHaveAttribute('style','text-align:center');await expect(read.locator('td').first()).toHaveText('성명');
  await expect(read.locator('pre code.language-js')).toHaveText('const ok = 1 < 2;');
  // Mermaid diagrams become sanitized SVG; math becomes KaTeX; prices stay text.
  const figures=read.locator('.md-mermaid-figure svg');await expect(figures).toHaveCount(2,{timeout:20000});
  await expect(read.locator('.md-mermaid-figure').first()).toContainText('접수');await expect(read.locator('.md-mermaid-figure').nth(1)).toContainText('위원장');
  await expect(read.locator('.md-mermaid-figure foreignObject,.md-mermaid-figure script,.md-mermaid-figure a,.md-mermaid-figure image')).toHaveCount(0);
  await expect(read.locator('.md-math-done .katex')).toHaveCount(2);await expect(read.locator('.md-math-block .katex-display')).toHaveCount(1);
  await expect(read).toContainText('가격 $5와 $10');
  expect(await page.evaluate(()=>window.__mdHacked)).toBeUndefined();
  expect(startedLibs(seen)).toEqual(['dompurify','katex','markdown-it','mermaid']);
  // The note never widens the page; wide parts scroll inside.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`markdown-read-${width}.png`),fullPage:true});

  // [원문 그대로 보기] shows the stored text exactly, and back again.
  // UI-바구니상세개편: the toggle is a small icon near the text (it left the note's [⋯] menu).
  const toggle=detail.locator('[data-basket-read-raw]');
  await press(page,toggle,width);await expect(toggle).toHaveAccessibleName('정리해서 보기');await expect(read).not.toHaveClass(/md-body/);
  expect(await read.innerText()).toBe(RICH);await expect(read.locator('*')).toHaveCount(0);
  await page.screenshot({path:info.outputPath(`markdown-raw-${width}.png`),fullPage:true});
  await press(page,toggle,width);await expect(toggle).toHaveAccessibleName('원문 그대로 보기');await expect(figures).toHaveCount(2,{timeout:20000});await expect(read.locator('.md-math-done .katex')).toHaveCount(2);
  // Editing still uses the plain text box with the stored text.
  await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});await expect(detail.locator('[data-basket-text]')).toHaveValue(RICH);await expect(read).toBeHidden();

  expect(seen.external).toEqual([]);
  expect(seen.errors).toEqual([]);
 });
}

test('a broken diagram keeps its source readable and other screens never load the markdown tools',async({page})=>{
 await page.setViewportSize({width:1280,height:900});const seen=await fixture(page);
 // Home, calendar and tasks do not fetch any markdown library.
 for(const view of ['calendar','tasks'])await page.locator(`.app-nav [data-view="${view}"]`).first().click();
 await page.waitForTimeout(300);expect(seen.libs).toEqual([]);
 await page.goto(testOrigin+'/app/?view=basket');
 await page.route(SB+'/rest/v1/app_notes**',r=>r.fulfill({json:[{id:'bad',raw_text:FENCE+'mermaid\nflowchart TD\n  A -->\n'+FENCE,occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]}]}));
 await page.reload();
 await (await showBasketRow(page,'bad')).click();
 const read=page.locator('[data-basket-read-text]');
 await expect(read.locator('.md-mermaid-error')).toHaveText('도식을 그리지 못해 원문을 그대로 보여 줍니다.',{timeout:20000});
 await expect(read.locator('.md-mermaid-source code')).toContainText('A -->');
 await expect(read.locator('svg')).toHaveCount(0);
 expect(seen.external).toEqual([]);
});
