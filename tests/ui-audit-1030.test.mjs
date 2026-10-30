import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {paintScrollEdges} from '../app/scroll-edge.js';

// UI-점검1030손질(2026-10-30 사이트 점검 실측 C2·C4~C7·C9)의 재발 방지. 화면 수치는 tests/app-e2e/ui-audit-1030.spec.mjs 등(412·1440)이 본다.
const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const read = f => readFileSync(join(app, f), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

const box = ({scrollWidth, clientWidth, scrollLeft = 0}) => ({isConnected: true, scrollWidth, clientWidth, scrollLeft, dataset: {}});

test('C2 칩 줄 끝: 넘치지 않으면 표시 없음, 넘치면 가려진 쪽(끝·앞·양쪽)만', () => {
  const fit = box({scrollWidth: 300, clientWidth: 300}); paintScrollEdges(fit); assert.equal(fit.dataset.scrollMore, undefined);
  const start = box({scrollWidth: 600, clientWidth: 300}); paintScrollEdges(start); assert.equal(start.dataset.scrollMore, 'end');
  const mid = box({scrollWidth: 600, clientWidth: 300, scrollLeft: 120}); paintScrollEdges(mid); assert.equal(mid.dataset.scrollMore, 'start end');
  const end = box({scrollWidth: 600, clientWidth: 300, scrollLeft: 300}); paintScrollEdges(end); assert.equal(end.dataset.scrollMore, 'start');
  // 다시 맞으면 표시를 지운다.
  end.scrollWidth = 300; paintScrollEdges(end); assert.equal(end.dataset.scrollMore, undefined);
});

test('C2 공용 칩 부품 둘이 모두 끝 처리를 부르고, 흐림 모양은 ui-standard.css 한 곳', () => {
  for (const f of ['filter-chips.js', 'category-chips.js']) {
    const src = read(f);
    assert.match(src, /import \{watchScrollEdges\} from '\.\/scroll-edge\.js'/, f);
    assert.match(src, /watchScrollEdges\(host\);\n\}/, f);
  }
  const css = noComments(read('ui-standard.css'));
  for (const v of ['end', 'start', 'start end']) assert.ok(css.includes(`.filter-chips[data-scroll-more="${v}"]{`), v);
  assert.match(noComments(read('meeting-ui.css')), /#meetingsView \.report-kind-bar>#reportKindFilter\{flex:1 1 0;/);
});

test('C7 담당조직·프로젝트 [자료] 종류 칩은 PC(1024px~)에서 줄바꿈', () => {
  const css = noComments(read('ui-standard.css'));
  assert.match(css, /@media\(min-width:761px\)\{\s*html \.doc-kind-chips:not\(\[hidden\]\)\{ flex-wrap:wrap; row-gap:4px; overflow:visible; \}/);
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
