// HWP-화면가득: 폰·폴드는 편집기가 화면 가득, PC는 편집기가 창 높이 가득 + [전체 화면]으로 같은 모양.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync('app/index.html','utf8');
const view=html.slice(html.indexOf('<section id="hwpView"'),html.indexOf('<section id="calendarView"'));
const lab=readFileSync('app/hwp-lab.js','utf8');
const css=readFileSync('app/hwp-lab.css','utf8');
const fit=readFileSync('app/hwp-lab/studio-fit.js','utf8');
const code=text=>text.replace(/^\s*\/\/.*$/gm,'');

test('the screen has one thin top line and no repeated title or notice',()=>{
  assert.match(view,/<div id="hwpLabBar" class="hwp-lab-bar"><button id="hwpLabClose"[^>]*aria-label="닫기">✕<\/button><span id="hwpLabName"[^>]*>HWP 편집<\/span><button id="hwpMenuFile"[^>]*data-hwp-menu="file">파일 ▾<\/button><button id="hwpMenuSave"[^>]*data-hwp-menu="save">저장 ▾<\/button><\/div>/);
  assert.doesNotMatch(view,/<h2|hwp-lab-note|hwp-lab-tools/);
  assert.match(view,/aria-label="HWP 편집"/);
  // [전체 화면] stays on the PC button row; it is no longer hidden where the keyboard lock is missing.
  assert.match(view,/<button id="hwpLabFull" class="secondary hwp-lab-full" type="button" title="[^"]+">전체 화면<\/button><\/div><\/div>/);
  assert.doesNotMatch(lab,/full\.hidden=/);
  assert.doesNotMatch(lab,/hwp-lab-note/);
});

test('the two menus reuse the shared anchored menu and press the existing buttons',()=>{
  assert.match(lab,/import \{createAnchoredMenu\} from '\.\/anchored-menu\.js';/);
  assert.match(lab,/file:\(\)=>\['hwpLabPick','hwpLabTemplate','hwpLabConvert'\]/);
  assert.match(lab,/save:\(\)=>drive\?\['hwpDriveNew','hwpDriveOverwrite','hwpDriveView'\]:current\?\.converted\?\['hwpConvDownload','hwpConvLibrary'\]:\['hwpLabSave','hwpLabUpload'\]/);
  assert.match(lab,/onAction:button=>\{const source=\$\(button\.dataset\.hwpAct\);if\(source&&!source\.disabled&&!source\.hidden\)source\.click\(\)\}/);
  // The menu panel lives inside the card so it still shows while the card is the fullscreen element.
  assert.match(lab,/parent:\(\)=>card/);
});

test('phone width and PC fullscreen share one fill-the-screen layout',()=>{
  assert.match(lab,/window\.matchMedia\('\(max-width: 1023px\)'\)/);
  assert.match(lab,/const focus=NARROW\.matches\|\|card\.hasAttribute\('data-full'\);/);
  assert.match(lab,/NARROW\.addEventListener\?\.\('change',layout\)/);
  assert.match(css,/#appView #hwpView \.hwp-lab\[data-focus\]\{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;/);
  assert.match(css,/\.hwp-lab\[data-focus\] :is\(\.hwp-lab-head,\.hwp-conv-bar\)\{display:none\}/);
  assert.match(css,/\.hwp-lab\[data-focus\] \.hwp-lab-editor\{flex:1 1 auto;height:auto;min-height:0;/);
  assert.match(css,/html:has\(#hwpView:not\(\.hidden\) \.hwp-lab\[data-focus\]\) :is\(\.mobile-tabs,\.mobile-shell-header\)\{display:none\}/);
});

test('fullscreen keeps the digit-key lock and falls back to filling the window',()=>{
  const body=code(lab);
  assert.match(body,/await card\.requestFullscreen\(\);\s*fullNative=true;/);
  assert.match(body,/await navigator\.keyboard\.lock\(DIGIT_KEYS\);/);
  assert.match(body,/const DIGIT_KEYS=\['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'\];/);
  assert.match(body,/navigator\.keyboard\?\.unlock\?\.\(\)/);
  // setFull(true) runs before the browser fullscreen is asked, so a refusal still fills the window.
  assert.ok(body.indexOf('setFull(true);')<body.indexOf('await card.requestFullscreen();'));
  // [✕]: fullscreen → back to the normal screen; Drive → [돌아가기]; otherwise the previous screen.
  assert.match(body,/function closeBar\(\)\{\s*if\(isFull\(\)\)\{void exitFull\(\);return\}\s*if\(drive\)\{void back\(\);return\}\s*window\.KPTURouter\?\.back\?\.\(\);\s*\}/);
});

test('the editor frame re-fits the page width only when a narrow frame changes width',()=>{
  const editor=readFileSync('app/hwp-lab/rhwp-0.8.7/studio/index.html','utf8');
  const scripts=[...editor.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(scripts.slice(0,4),['../../studio-guard.js','../../studio-styles.js','../../studio-convert.js','../../studio-fit.js']);
  assert.match(readFileSync('scripts/hwp-lab/finalize-rhwp-studio.mjs','utf8'),/studio-convert\.js"><\/script>\\n\s+<script src="\.\.\/\.\.\/studio-fit\.js">/);
  const body=code(fit);
  assert.match(body,/const NARROW=1024/);
  assert.match(body,/if\(width===lastWidth\)return;/);
  assert.match(body,/querySelector\('\.md-item\[data-cmd="view:zoom-fit-width"\]'\)/);
  assert.doesNotMatch(body,/\bfetch\(|XMLHttpRequest|WebSocket|postMessage|eval\(|new Function|cookie/);
});
