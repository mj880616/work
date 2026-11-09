import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// UI-점검1030손질(2026-10-30 사이트 점검 실측 C2·C4~C7·C9)의 재발 방지. 화면 수치는 tests/app-e2e/ui-audit-1030.spec.mjs 등(412·1440)이 본다.
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const read = f => readFileSync(join(app, f), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// C2(옆으로 미는 칩 줄 끝 흐림)·C7(PC만 종류 칩 줄바꿈)은 UI-칩줄두줄(10/31)로 바뀌었다: tests/chip-rows.test.mjs.
// BIZ-위쪽정돈PC(명진 11/09 10:52 A): PC 종류 칩 줄은 없앴다 — 모든 폭에서 [회의 ▾] 상자 하나이고, PC는 위쪽 세 줄을 한 줄(.report-top)로 놓는다.
test('C2 사업 보고 위쪽: 종류 칩 줄 없음, PC(761px~)는 위쪽 한 줄(BIZ-위쪽정돈PC)', () => {
  const html = read('index.html'), css = noComments(read('meeting-ui.css'));
  assert.doesNotMatch(html, /id="reportKindFilter"|id="reportNameSelect"/);
  assert.match(html, /<div class="report-top"><div class="toolbar report-top-line">/);
  assert.doesNotMatch(css, /#reportKindFilter|#reportNameSelect/);
  assert.match(css, /@media\(min-width:761px\)\{\s*#appView #meetingsView \.report-top\{display:flex;flex-wrap:wrap;/);
});

test('C4 체크칸 줄(내 프로필·원장)은 줄 전체 + 위아래 44px이 누르는 곳', () => {
  const css = noComments(read('ui-standard.css'));
  assert.ok(css.includes('#profileView :is(.ps-org-pick,.ps-calref-check)::after,#appView #ledgerView .lb-check::after{ content:""; position:absolute;'));
  assert.match(css, /top:calc\(50% - var\(--kptu-touch-target,44px\) \/ 2\); height:var\(--kptu-touch-target,44px\); \}/);
});

test('C5 정리함 [다시 찾기]는 거르기 칩과 다른 글자 버튼(테두리·바탕 없음)', () => {
  const css = noComments(read('basket.css'));
  const find = css.match(/#appView #basketView \.inbox-find \{([^}]*)\}/)?.[1] || '';
  assert.match(find, /border:0;/); assert.match(find, /background:transparent;/); assert.match(find, /color:var\(--kptu-primary-ink\)/);
  assert.doesNotMatch(css, /\.inbox-find,#appView #basketView \.inbox-chip \{/);
});

test('C6 홈 ⋯는 AI 사용량 제목 줄 끝 자리로(폰·중간 폭), 그 줄은 자리만 둔다', () => {
  assert.match(read('ai-usage-line.js'), /<div class="aiu-top" data-aiu-top>\$\{head\}<\/div>/);
  // HOME-업무일지홈: 홈 ⋯(홈 편집)는 옛 홈 칸 화면과 함께 없앴고, AI 사용량 줄은 내 프로필 '수집·사용량' 칸에 있다.
  assert.match(read('profile-status.js'), /mountAiUsageLine\(panel\.querySelector\('\[data-ps-ai-usage\]'\)\)/);
});

test('C9 → HOME-업무일지홈: 홈·업무일지 챙길 것 상자(✎ 고치기 칸)는 화면째 없앴다 — 후보 줄은 정리함 하나', () => {
  const src = read('todo-radar.js');
  assert.doesNotMatch(src, /export function mountRadar|data-radar-date/);
  assert.match(src, /export async function autoFindToday\(\)/);
  assert.match(read('home-summary.js'), /autoFindToday\(\)/);
});
