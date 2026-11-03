import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// UI-버튼크기전수(S49-16, 요청함 11/03 10:38)의 재발 방지. 기준은 docs/design-decisions.md 'UI-버튼기준'과 'UI-버튼크기전수'.
// 실제 화면 크기 검사는 tests/app-e2e/button-census.spec.mjs가 맡고, 여기서는 CSS 원문에서 다시 어긋나는 것을 막는다.
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', 'app');
const read = f => readFileSync(join(app, f), 'utf8');
const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssFiles = readdirSync(app).filter(f => f.endsWith('.css'));

test('공용 버튼(.primary·.mini 기본)은 13px/500이다 — 굵은 12px/700 기본으로 돌아가지 않는다', () => {
  const css = noComments(read('base-ui.css'));
  const rule = css.split('\n').find(l => l.startsWith('.primary,.secondary,.ghost,.danger,.mini{'));
  assert.ok(rule, 'base-ui.css 공용 버튼 기본 규칙');
  assert.doesNotMatch(rule, /font-weight:\s*(6|7|8|9)00/);
  assert.match(rule, /font-size:var\(--ds-text-button/);
  assert.match(rule, /font-weight:var\(--ds-weight-medium/);
});

test('공용 버튼 줄 .btn-row는 ui-standard.css 한 곳에 있고 작은 버튼 높이·13px/500을 쓴다', () => {
  const css = noComments(read('ui-standard.css'));
  const m = css.match(/:root \.btn-row > button:not\(\.icon-btn\)\{([^}]*)\}/);
  assert.ok(m, '.btn-row 규칙');
  assert.match(m[1], /height:var\(--ds-compact-height\)/);
  assert.match(m[1], /font-size:var\(--ds-text-button\)/);
  assert.match(m[1], /font-weight:var\(--ds-weight-medium\)/);
  for (const f of cssFiles) if (f !== 'ui-standard.css') assert.doesNotMatch(noComments(read(f)), /\.btn-row\s*[>{ ,]/, f + '에서 .btn-row를 따로 정하지 않는다');
});

test('주 버튼과 보조 버튼이 한 줄에 놓이는 공유 페이지 머리줄은 .btn-row를 쓴다', () => {
  assert.match(read('share-pages.js'), /class:'sp-head-actions btn-row'/);
});

// 버튼 클래스(.primary·.secondary·.ghost·.danger·.mini)에 굵기 600 이상이나 14px 초과 글자를 새로 정하지 않는다.
// 이 작업 전부터 있던 예외는 아래에 이유와 함께 적고, 새로 늘리지 않는다.
const GRANDFATHERED = new Set([]);
test('버튼 클래스 규칙에 굵은 글자(600↑)·큰 글자(14px↑)를 새로 두지 않는다', () => {
  const bad = [];
  for (const f of cssFiles) {
    const css = noComments(read(f));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(), decl = m[2];
      if (sel.startsWith('@')) continue;
      if (!sel.split(',').some(s => /\.(primary|secondary|ghost|danger|mini)(?![\w-])[^\s]*$/.test(s.trim().replace(/:[a-z-]+(\([^)]*\))?/g, '')))) continue;
      const w = decl.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/), z = decl.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px/);
      if ((w && /^(6|7|8|9)\d\d$|bold/.test(w[1].trim())) || (z && parseFloat(z[1]) > 14)) {
        const key = f + ' ' + sel.replace(/\s+/g, ' ');
        if (!GRANDFATHERED.has(key)) bad.push(key);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('버튼 전수 수집 시험은 보고용이 아니라 기준을 검사한다', () => {
  const spec = readFileSync(join(here, 'app-e2e', 'button-census.spec.mjs'), 'utf8');
  assert.match(spec, /const REPORT_ONLY = false;/);
});
