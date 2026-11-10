// UI-위쪽줄흰띠·여백(S55-19, 명진 11/10): 화면 위·아래에 고정(position:sticky)한 줄을 흰색(--kptu-surface)으로 칠하면
// 화면 바탕(--kptu-bg) 위에서 흰 띠로 떠 보인다. 화면 바탕 위에 놓인 고정 줄은 --kptu-bg를 쓰고,
// 흰 카드·창·칸 안에 있어 흰색이 맞는 고정 줄만 아래 표에 이유와 함께 둔다.
// 새 고정 줄을 흰색으로 칠하려면 놓이는 자리(흰 상자 안인지)를 확인하고 이 표에 한 줄을 더한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const APP = new URL('../app/', import.meta.url);

// 파일 → 고른이(끝부분) → 흰색이 맞는 까닭. 고른이는 규칙 앞부분의 마지막 줄(공백 정리)과 같아야 한다.
const WHITE_OK = {
  'base-ui.css': {
    '.topbar': 'Web2 안에서는 안 보이는 옛 머리 줄(team.css가 숨김). 흰 머리 줄 자체가 상자',
    '.modal-foot': '창(.modal-card) 안 아래 버튼 줄',
    ':where(.modal-card)>.modal-head': '창 안 제목 줄',
    '.modal-action-footer': '창 안 아래 버튼 줄',
  },
  'basket.css': { '.nx-select-bar:not([hidden])': '테두리·둥근 모서리가 있는 상자 모양 막대(띠가 아님)' },
  'calendar-ui.css': {
    '.cwv-header': '흰 바탕 주간 표(#calendarWeek) 안 날짜 줄',
    '.cwv-cap': '흰 바탕 주간 표 안 종일 줄',
    '.cwv-axis::before': '흰 바탕 주간 표 안 시간 칸 모서리',
  },
  'desktop-ui.css': {
    '#appView>.app-nav': 'PC 왼쪽 메뉴 카드(테두리·둥근 모서리) 자체',
    '.quick-links-panel .ql-foot': '흰 자주 가는 링크 판 안 아래 줄',
  },
  'ed-doc.css': {
    '.ed-bar': '흰 편집 칸(테두리 상자) 안 서식 버튼 줄',
    '.ed-tools .ed-more': '흰 서식 버튼 줄 안 [⋯]',
  },
  'google-tasks.css': { '#gtDetailPane #gtTaskModal.gt-docked .modal-head': '흰 상세 칸 안 제목 줄' },
  'meeting-ui.css': {
    '#meetingList .mrd-docked .modal-head': '흰 상세 칸 안 제목 줄',
    '#reportAreaTagSheet .area-tag-foot': '아래 시트(흰 판) 안 버튼 줄',
  },
  'photos.css': { '#appView #photosView .photos-act': '아래 하단바 위에 붙는 고르기 버튼 줄(공용 .kptu-actbar, 하단바와 이어지는 흰 판)' },
  'project-system-v3.css': {
    '.ps3-modal-head': '프로젝트 상세 창 안 제목 줄',
    '#appView #projectsView #projectGrid>.ps3-plist>.add-list-head': '흰 목록 카드(.ps3-plist) 안 머리 줄',
  },
  'share-pages.css': { '#appView #pagesView .sp-topline': '흰 편집 판(.sp-editor.is-full) 안 맨 위 줄' },
  'ui-standard.css': {
    '#appView .mobile-menu-panel .mobile-menu-head': '폰 메뉴 판 안 손잡이 줄',
    '.save-row-sticky': '아래 저장 버튼 줄(공용, 하단바 위 흰 판 — 카드 안에서도 같이 씀)',
  },
};

function stickyWhiteRules(file) {
  const css = readFileSync(new URL(file, APP), 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const found = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const body = m[2];
    if (!/position\s*:\s*sticky/.test(body)) continue;
    if (!/background(?:-color)?\s*:\s*var\(--kptu-surface\)/.test(body)) continue;
    const sel = m[1].trim().split('\n').pop().trim().replace(/\s+/g, ' ');
    found.push(sel);
  }
  return found;
}

test('화면 바탕 위 고정 줄은 흰 띠가 아니다: 흰색 고정 줄은 흰 상자 안에 있는 것(표)만', () => {
  const files = readdirSync(APP).filter(f => f.endsWith('.css'));
  const unexpected = [], seen = new Set();
  for (const f of files) {
    for (const sel of stickyWhiteRules(f)) {
      if (WHITE_OK[f]?.[sel]) seen.add(`${f} ${sel}`);
      else unexpected.push(`${f}: ${sel}`);
    }
  }
  assert.deepEqual(unexpected, [], '흰색(--kptu-surface) 고정 줄이 새로 생겼다 — 화면 바탕 위면 --kptu-bg, 흰 상자 안이면 이 표에 이유를 더한다');
  const stale = Object.entries(WHITE_OK).flatMap(([f, m]) => Object.keys(m).map(s => `${f} ${s}`)).filter(k => !seen.has(k));
  assert.deepEqual(stale, [], '표에 남은 줄이 CSS에서 사라졌다 — 표에서도 지운다');
});

test('[파일] PC·폴드 펼침 맨 위 줄·고르기 막대는 화면 바탕(--kptu-bg)이고 아래 칸과 6px 띄운다', () => {
  const css = readFileSync(new URL('files.css', APP), 'utf8');
  const rule = sel => {
    const i = css.indexOf(sel + ' {');
    assert.ok(i >= 0, `${sel} 규칙이 있다`);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(rule('.fx.fx-split-scroll > .fx-top'), /background:var\(--kptu-bg\)/);
  assert.match(rule('.fx.fx-split-scroll > .fx-bar:not([hidden])'), /background:var\(--kptu-bg\)/);
  assert.match(rule('.fx.fx-split-scroll > .fx-cols'), /margin-top:6px/);
  // 띄움 값은 아스날 위쪽 줄(.ars의 gap)과 같다 — 새 값을 만들지 않는다.
  assert.match(readFileSync(new URL('arsenal.css', APP), 'utf8'), /\.ars\{[^}]*gap:6px/);
});
