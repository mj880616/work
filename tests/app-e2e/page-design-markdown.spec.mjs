import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';

test('post markdown preserves links and images while rejecting unsafe HTML and URLs',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/page-management-fixture.html`);
  await page.addScriptTag({url:`${BASE}/app/page-design-core.js`});
  const html=await page.evaluate(()=>window.KPTUPageDesign.renderMarkdown([
    '## 주요 내용',
    '[원본 자료](https://example.org/file.pdf?a=1&b=2)',
    '*기울임*과 **강조**',
    '![현장 사진](https://example.org/photo.png)',
    '[실행](javascript:alert(1))',
    '![위험](data:image/svg+xml,<svg onload=alert(1)>)',
    '<img src=x onerror=alert(1)>'
  ].join('\n')));
  const content=await page.evaluate(markup=>{
    const box=document.createElement('div');box.innerHTML=markup;return {
      heading:box.querySelector('h2')?.textContent,
      link:box.querySelector('a')?.getAttribute('href'),
      image:box.querySelector('img')?.getAttribute('src'),
      anchorCount:box.querySelectorAll('a').length,
      imageCount:box.querySelectorAll('img').length,
      emphasis:box.querySelector('em')?.textContent,
      strong:box.querySelector('strong')?.textContent,
      unsafe:box.querySelectorAll('script,[onerror],[onload],iframe').length,
      text:box.textContent
    };
  },html);
  expect(content.heading).toBe('주요 내용');
  expect(content.link).toBe('https://example.org/file.pdf?a=1&b=2');
  expect(content.image).toBe('https://example.org/photo.png');
  expect(content.anchorCount).toBe(1);
  expect(content.imageCount).toBe(1);
  expect(content.emphasis).toBe('기울임');
  expect(content.strong).toBe('강조');
  expect(content.unsafe).toBe(0);
  expect(content.text).toContain('javascript:alert(1)');
});
