// UI-폴드PC틀(2026-10-30 명진 시안 A): 화면 기준은 둘(≤760 폰 / ≥761 PC 틀). 옛 761~1023px 셸(위쪽 한 줄 메뉴 + ☰)이 다시 생기지 않게 본다.
// 761~1023px만 따로 보는 곳은 왼쪽 메뉴를 그림만 보이는 좁은 칸으로 그리는 두 곳(desktop-tight-nav.css, topbar-actions.js)뿐이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const SKIP = /(^|\/)(rhwp-[\d.]+|mermaid-[\d.]+|markdown-it-[\d.]+|pdfjs-dist-[\d.]+|hwp-lab|markdown-lib|pdf-lib)(\/|$)/;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|js|mjs|html)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk('app');
const read = p => readFileSync(p, 'utf8');

test('PC 기준선은 761px 하나: 1024px·1023px 기준선은 좁은 메뉴 두 곳 말고는 없다', () => {
  const allowed = new Set(['app/desktop-tight-nav.css', 'app/topbar-actions.js']);
  const bad = [];
  for (const f of files) {
    const s = read(f);
    if (/\((?:min-width:\s*1024px|max-width:\s*1023px)\)/.test(s) && !allowed.has(f)) bad.push(f);
    if (/innerWidth\s*>=\s*1024/.test(s)) bad.push(f + ' (innerWidth)');
  }
  assert.deepEqual(bad, []);
  for (const f of allowed) {
    const hits = read(f).match(/\(min-width:\s*1024px\)|\(max-width:\s*1023px\)/g) || [];
    assert.ok(hits.every(h => h === '(max-width:1023px)'), f);
  }
  assert.match(read('app/desktop-tight-nav.css'), /@media \(min-width:761px\) and \(max-width:1023px\)\{/);
  assert.match(read('app/topbar-actions.js'), /const railQuery=window\.matchMedia\('\(min-width:761px\) and \(max-width:1023px\)'\);/);
});

test('옛 761~1023px 한 줄 메뉴·☰는 코드째 없다', () => {
  const html = read('app/index.html'), top = read('app/topbar-actions.js'), css = read('app/topbar-actions.css');
  assert.doesNotMatch(html, /id="mobileMenuOpen"/);
  for (const word of ['midQuery', 'midItems', 'syncMidNavigation', 'mid-menu-trigger', 'syncMenuLocation', 'mobileTrigger']) assert.ok(!top.includes(word), word);
  assert.doesNotMatch(css, /mid-menu-trigger|#mobileMenuOpen/);
  assert.doesNotMatch(read('app/menu-model.mjs'), /export function midKeys/);
  assert.doesNotMatch(read('app/ed-window.js'), /'top'/);
});

test('좁은 메뉴: 그림은 메뉴 목록 한 곳(menu-model.mjs)에서, 펼침은 탭 메모리만(저장 없음)', () => {
  const top = read('app/topbar-actions.js');
  assert.match(top, /\[button,itemOf\(key\)\?\.icon\]/);
  assert.match(top, /function setNavOpen\(open\)\{[^}]*appView\.classList\.toggle\('nav-open',open\);paintNavToggle\(\);/);
  const open = top.slice(top.indexOf('function setNavOpen'), top.indexOf('railQuery.addEventListener'));
  // 펼침 줄에는 서버 저장(viewPrefs)도, 기기 저장소 이름(Storage)도 없다.
  assert.doesNotMatch(open, /viewPrefs|Storage\b/);
  const css = read('app/desktop-tight-nav.css');
  assert.match(css, /#appView>\.app-nav \.nav-ico\{display:none\}/);
  assert.match(css, /html body #appView\.nav-open>\.app-nav\{width:208px;/);
});
