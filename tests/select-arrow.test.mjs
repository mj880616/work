import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// UI-화살표선명(S71, 사용자 2026-11-27 '드롭다운 화살표 해상도가 깨져보임'): 앱 공용 고르기 상자 ▾는 벡터 세모 한 장(--ds-select-arrow).
// 그라데이션 반쪽 두 장(계단·흐림·두 장 이음매가 소수 px에서 어긋남)으로 다시 그리지 않는다. 색은 테마마다 --kptu-muted와 같다.
const read = f => readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');

test('공용 고르기 상자·날짜 칸 ▾는 벡터 세모 토큰 하나로 그린다', () => {
  const ui = read('ui-standard.css');
  assert.doesNotMatch(ui, /linear-gradient\(45deg,\s*transparent 50%/, '그라데이션 반쪽 세모가 남아 있음');
  const rule = ui.match(/select:not\(\[multiple\],\[size\]\),#libraryView button\.lu-cat-pick,#reportTop button\.report-filter-chip\{([^}]*)\}/);
  assert.ok(rule, '공용 ▾ 규칙을 찾지 못함');
  assert.match(rule[1], /background-image:var\(--ds-select-arrow\)/);
  assert.match(rule[1], /background-size:8px 4px/);
  assert.match(rule[1], /background-position:right 9px center/);
  assert.match(ui, /\.date-field::before\{[^}]*background-image:var\(--ds-select-arrow\)/);
});

test('테마마다 ▾ 토큰이 있고 색은 그 테마의 --kptu-muted다', () => {
  for (const f of ['theme-tokens.css', 'base-ui.css']) {
    const css = read(f);
    const muted = [...css.matchAll(/--kptu-muted:#([0-9a-fA-F]{6});(--ds-select-arrow:url\("data:image\/svg\+xml,[^"]*"\);)?/g)];
    assert.ok(muted.length > 0, f);
    for (const m of muted) {
      assert.ok(m[2], `${f}: --kptu-muted:#${m[1]} 옆에 --ds-select-arrow 없음`);
      assert.ok(m[2].includes(`fill='%23${m[1]}'`), `${f}: 세모 색이 --kptu-muted(#${m[1]})와 다름`);
    }
  }
});

test('화면 CSS가 ▾ 그림 방식을 따로 만들지 않는다(그라데이션 세모 새로 쓰기 금지)', () => {
  const dir = new URL('../app/', import.meta.url);
  // 사업 관리 걸러보기 창 안 ▸(meeting-ui.css)는 이 PR 전부터 있던 다른 모양 — 범위 밖 발견사항으로 남겼다(docs/design/screen-open-once-audit.md).
  const known = new Set(['meeting-ui.css']);
  for (const f of readdirSync(dir).filter(n => n.endsWith('.css') && !known.has(n))) {
    assert.doesNotMatch(read(f), /linear-gradient\(45deg,\s*transparent 50%,\s*var\(--kptu-muted\)/, f);
  }
});
