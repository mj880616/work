import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
// MD-표시: 버전은 scripts/markdown/md-pin.json 한 곳에서 정하고, 반입 파일은 SHA256SUMS와 같아야 하며(직접 수정 없음),
// 순수 표시 함수는 글 속 HTML·스크립트·이벤트 속성·javascript: 링크·외부 이미지를 막고 표·체크박스·코드·수식을 그린다.
const pin=JSON.parse(readFileSync('scripts/markdown/md-pin.json','utf8'));
const dir=pin.folder;
const {default:MarkdownIt}=await import(`../${dir}/markdown-it-${pin.packages['markdown-it'].version}/markdown-it.esm.min.mjs`);
const {createMarkdown,renderMarkdown,renderMath,safeHref,MERMAID_CONFIG,KATEX_OPTIONS}=await import('../app/markdown-render.mjs');
const katex=createRequire(import.meta.url)(`../${dir}/katex-${pin.packages.katex.version}/katex.min.js`);
const md=createMarkdown(MarkdownIt);
const render=text=>renderMarkdown(md,text);

test('one pinned version per library is used by the vendored folder and the view module',()=>{
  const expected=Object.entries(pin.packages).map(([name,spec])=>`${name}-${spec.version}`).sort();
  assert.deepEqual(readdirSync(dir,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort(),expected);
  const view=readFileSync('app/markdown-view.js','utf8');
  const named=[...view.matchAll(/'((?:markdown-it|dompurify|mermaid|katex)-[\d.]+)\//g)].map(match=>match[1]);
  assert.ok(named.length>=5);
  assert.deepEqual([...new Set(named)].sort(),expected);
  const source=readFileSync(`${dir}/SOURCE.md`,'utf8');
  for(const spec of Object.values(pin.packages)){assert.match(spec.integrity,/^sha512-/);assert.ok(source.includes(spec.integrity));}
  for(const name of expected)assert.ok(readFileSync(`${dir}/${name}/LICENSE`,'utf8').length>500,name);
});

test('vendored files match the recorded hashes and stay small',()=>{
  const rows=readFileSync(`${dir}/SHA256SUMS`,'utf8').trim().split('\n').map(line=>line.split(/  /));
  let total=0;
  for(const [hash,path] of rows){const data=readFileSync(`${dir}/${path}`);total+=data.length;assert.equal(createHash('sha256').update(data).digest('hex'),hash,path);}
  assert.ok(total<10*1048576,`${total} bytes`);
});

test('the view module loads only same-origin vendored files',()=>{
  const view=readFileSync('app/markdown-view.js','utf8').replace(/^\s*\/\/.*$/gm,'');
  assert.doesNotMatch(view,/https?:\/\//);
  assert.match(view,/new URL\('\.\/markdown-lib\/', import\.meta\.url\)/);
  // Mermaid and KaTeX are loaded only from their enhancement steps.
  assert.match(view,/if \(math && el\.querySelector\('\.md-math'\)\)/);
  assert.match(view,/if \(mermaid && el\.querySelector\('\.md-mermaid'\)\)/);
});

test('raw HTML, scripts and event attributes are shown as text, never as markup',()=>{
  const {html}=render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<div onclick="x()">a</div>\n\n<iframe src="https://evil.example"></iframe>');
  assert.doesNotMatch(html,/<(?:script|img|div|iframe)\b/i);
  assert.doesNotMatch(html,/<[a-z][^>]*\son\w+=/i);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('links allow only http, https and mailto, and open in a new window without opener',()=>{
  const {html}=render('[a](https://example.com/x) [b](mailto:me@example.com) [c](javascript:alert(1)) [d](JaVaScRiPt:alert(1)) [e](&#106;avascript:alert(1)) [f](data:text/html,x) [g](vbscript:x) [h](/relative) [i](//evil.example) <javascript:alert(1)> https://www.example.org');
  const hrefs=[...html.matchAll(/<a href="([^"]*)"/g)].map(match=>match[1]);
  assert.deepEqual(hrefs,['https://example.com/x','mailto:me@example.com','https://www.example.org/']);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g)||[]).length,3);
  assert.doesNotMatch(html,/href="(?:javascript|data|vbscript)/i);
  for(const bad of ['javascript:x',' JAVASCRIPT:x','data:text/html,x','file:///etc','//evil.example','/x','http://'])assert.equal(safeHref(bad),null,bad);
});

test('images are never loaded: a safe address becomes a link, anything else plain text',()=>{
  const {html}=render('![현장](https://images.example/a.png) ![나쁜](javascript:alert(1)) [![겹친](https://images.example/b.png)](https://example.com)');
  assert.doesNotMatch(html,/<img/i);
  assert.ok(html.includes('<a href="https://images.example/a.png" class="md-image-link" target="_blank" rel="noopener noreferrer">이미지: 현장</a>'));
  assert.ok(html.includes('[이미지: 겹친]'));
  assert.doesNotMatch(html,/(?:href|src)="javascript/i);
});

test('tables, task checkboxes, code blocks, quotes and rules render',()=>{
  const {html}=render('| 항목 | 기한 |\n| :-- | --: |\n| 성명 | 10/20 |\n\n- [ ] 할 일\n- [x] 끝냄\n- [링크](https://e.x) 아님\n\n```js\nconst a = 1 < 2;\n```\n\n> 인용\n\n---\n\n# 제목\n**굵게** *기울임*');
  assert.match(html,/<table>[\s\S]*<th style="text-align:left">항목<\/th>[\s\S]*<td style="text-align:right">10\/20<\/td>/);
  assert.ok(html.includes('<li class="md-task-item"><input class="md-task" type="checkbox" disabled> 할 일</li>'));
  assert.ok(html.includes('<li class="md-task-item"><input class="md-task" type="checkbox" disabled checked> 끝냄</li>'));
  assert.equal((html.match(/md-task-item/g)||[]).length,2);
  assert.ok(html.includes('<pre><code class="language-js">const a = 1 &lt; 2;\n</code></pre>'));
  assert.match(html,/<blockquote>\s*<p>인용<\/p>\s*<\/blockquote>/);
  assert.match(html,/<hr>/);assert.match(html,/<h1>제목<\/h1>/);assert.match(html,/<strong>굵게<\/strong> <em>기울임<\/em>/);
});

test('mermaid fences become placeholders with escaped source and flag the diagram tool',()=>{
  const plain=render('그냥 글');
  assert.deepEqual([plain.math,plain.mermaid],[false,false]);
  const {html,mermaid,math}=render('```mermaid\nflowchart TD\n  A["<img src=x onerror=alert(1)>"] --> B\n```');
  assert.equal(mermaid,true);assert.equal(math,false);
  assert.ok(html.includes('<div class="md-mermaid"><pre class="md-mermaid-source"><code>flowchart TD\n  A[&quot;&lt;img src=x onerror=alert(1)&gt;&quot;] --&gt; B\n</code></pre></div>'));
  assert.equal(MERMAID_CONFIG.securityLevel,'strict');assert.equal(MERMAID_CONFIG.htmlLabels,false);assert.equal(MERMAID_CONFIG.startOnLoad,false);
  for(const key of ['securityLevel','htmlLabels','themeCSS','themeVariables','dompurifyConfig'])assert.ok(MERMAID_CONFIG.secure.includes(key),key);
});

test('math: $…$, $$…$$, \\(…\\), \\[…\\] and ```math render with KaTeX; prices stay text',()=>{
  const {html,math}=render('식 $E=mc^2$ 와 \\(a+b\\), 가격 $5와 $10\n\n$$\n\\frac{1}{2}\n$$\n\n\\[\nx^2\n\\]\n\n```math\n\\sqrt{2}\n```');
  assert.equal(math,true);
  const spans=[...html.matchAll(/<(span|div) class="md-math md-math-(inline|display|block)">([^<]*)<\/\1>/g)].map(match=>[match[2],match[3]]);
  assert.deepEqual(spans,[['inline','E=mc^2'],['inline','a+b'],['block','\\frac{1}{2}'],['block','x^2'],['block','\\sqrt{2}']]);
  assert.ok(html.includes('가격 $5와 $10'));
  const out=renderMath(katex,'\\frac{1}{2}',true);
  assert.match(out,/class="katex-display"/);assert.match(out,/<math[\s>]/);assert.match(out,/<mfrac>/);
  // External-reaching commands are not trusted.
  const href=renderMath(katex,'\\href{https://evil.example}{x}\\includegraphics{https://evil.example/a.png}',false);
  assert.doesNotMatch(href,/<a\s|<img|href="https/);
  assert.equal(KATEX_OPTIONS.trust,false);
  // Broken TeX does not throw.
  assert.doesNotThrow(()=>renderMath(katex,'\\frac{',false));
});
