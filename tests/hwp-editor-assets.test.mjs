import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// LIB-편집열기느림: 칸막이 편집기 frame(고유 origin)의 내려받기는 HTTP 캐시에 남지 않으므로, 큰 엔진 파일만 Web2 창이 받아 넘긴다.
// 통로가 넓어지지 않는지(정해진 이름 모양만, 그 iframe이 보낸 첫 통로만, 칸막이는 그대로) 확인한다.
const code=path=>readFileSync(path,'utf8').replace(/^\s*\/\/.*$/gm,'');
const frame=code('app/hwp-frame.js'),assets=code('app/hwp-lab/studio-assets.js');
const html=readFileSync('app/hwp-lab/rhwp-0.8.7/studio/index.html','utf8');

test('the editor frame asks the Web2 page only for engine files, before the editor bundle runs',()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match=>match[1]);
  const at=scripts.indexOf('../../studio-assets.js'),bundle=scripts.findIndex(src=>/assets\/index-.*\.js$/.test(src));
  assert.ok(at>0&&bundle>at,'studio-assets.js runs after the guard and before the bundle');
  assert.match(readFileSync('scripts/hwp-lab/finalize-rhwp-studio.mjs','utf8'),/studio-fit\.js"><\/script>\\n\s+<script src="\.\.\/\.\.\/studio-assets\.js">/);
  assert.match(assets,/const ASSET=\/\^assets\\\/\[A-Za-z0-9_-\]\+\\\.wasm\$\/;/);
  assert.match(assets,/if\(method!=='GET'\)return null;/);
  // 통로로는 port만 보내고, 실패하면 원래 fetch로 받는다.
  assert.match(assets,/window\.parent\.postMessage\(\{type:'kptu-hwp-assets'\},'\*',\[channel\.port2\]\)/);
  assert.match(assets,/\.catch\(\(\)=>realFetch\(input,init\)\)/);
  assert.doesNotMatch(assets,/localStorage|sessionStorage|indexedDB|caches\.|cookie|eval\(|new Function/);
});

test('the Web2 page serves only matching public engine files to its own editor frame',()=>{
  assert.match(frame,/const ASSET=\/\^assets\\\/\[A-Za-z0-9_-\]\+\\\.wasm\$\/;/);
  assert.match(frame,/event\.source!==iframe\.contentWindow\|\|event\.data\?\.type!=='kptu-hwp-assets'/);
  assert.match(frame,/window\.removeEventListener\('message',onMessage\);\s*const port=event\.ports\[0\];/);
  assert.match(frame,/if\(typeof path!=='string'\|\|!ASSET\.test\(path\)\)\{port\.postMessage\(\{id,ok:false\}\);return\}/);
  assert.match(frame,/fetch\(new URL\(RHWP\+'studio\/'\+path,import\.meta\.url\),\{credentials:'omit'\}\)/);
  // 칸막이는 그대로다.
  assert.match(frame,/setAttribute\('sandbox','allow-scripts'\)/);
  assert.doesNotMatch(frame,/allow-same-origin/);
});
