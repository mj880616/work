// WEEKLY-조직이름한줄 덧붙임(요청함 11/08 00:19 "칸 크기 드래그조절 가능하게"): [주간 정리] 표 칸 폭을 머리 칸 경계를 끌어 바꾼다.
// 부품은 UI-칸너비끌기 공용 col-resize.js(mountColResize·gripHtml) 그대로, 저장도 그대로(서버 view_prefs.col_widths.weekly.<칸>[_f|_p], 화면 종류별 따로).
// 이 파일은 '어느 표의 어느 칸을 끄는지'와 '두 번 누르면 맞출 글 길이'만 정한다. 모양(손잡이 금·안내선)은 col-resize.js, 칸 기본 너비는 화면 CSS 변수 기본값.
// 폰(~760px)은 표가 줄마다 쌓여 머리줄이 없으므로 끌기가 없다(폴드 펼침·PC만).
import {gripHtml, mountColResize} from './col-resize.js';

export const WEEKLY_COL_SCREEN = 'weekly';
// 표 종류 → 끄는 칸들. col = 머리줄 몇째 칸(1부터), dir = 1 그 칸 오른쪽 금 · -1 왼쪽 금(오른쪽 끝 칸), cells = 그 칸 글(두 번 누르면 이 길이에 맞춤).
// 넓게 늘어나는 칸(내용·설명·조직현황)은 끌지 않는다 — 옆 칸을 끌면 남은 폭을 가져간다.
export const WEEKLY_COLS = Object.freeze({
  exec: [{key:'exec_day', col:1, label:'일', cells:'tbody tr[data-journal-exec-row] > th'},
    {key:'exec_who', col:3, label:'참석 요청', dir:-1, cells:'tbody tr[data-journal-exec-row] > td.journal-exec-who'}],
  hq: [{key:'hq_day', col:2, label:'일', cells:'tbody tr[data-journal-hq-row] > th'}],
  discuss: [{key:'disc_title', col:2, label:'안건', cells:'tbody tr[data-journal-discuss-row] > th'},
    {key:'disc_org', col:4, label:'관련 조직', dir:-1, cells:'tbody tr[data-journal-discuss-row] > td.journal-discuss-org'}],
  cal: [{key:'cal_day', col:1, label:'일', cells:'tbody th.journal-weekly-area'}],
  org: [{key:'org', col:1, label:'조직', cells:'tbody .wl-org-line'}],
});
// 칸 이름 → CSS 변수(화면 CSS가 var(--wk-w-…, 기본값)으로 받는다).
export const colVar = key => `--wk-w-${key.replace(/_/g, '-')}`;
// 머리 칸 n째의 손잡이 글(없으면 빈 글). 표를 그리는 곳이 머리 칸 안 끝에 붙인다.
export function colGripHtml(kind, col) {
  const c = WEEKLY_COLS[kind]?.find(x => x.col === col);
  return c ? gripHtml(c.key, c.label, c.dir ?? 1) : '';
}
// 글 하나의 실제 글 폭(줄바꿈·말줄임 없이 늘어놓은 길이).
const textWidth = el => { const r = el.ownerDocument.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
// 조직 이름 줄('이름 · 빈 칸 ⋯')은 한 줄로 늘어놓은 길이 = 이름 글 폭 + 나머지 조각 폭 + 사이 간격.
function lineWidth(line) {
  const kids = [...line.children].filter(k => k.getClientRects().length);
  const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
  return kids.reduce((n, k) => n + (k.classList.contains('wl-org') ? textWidth(k) : k.getBoundingClientRect().width), 0) + gap * Math.max(0, kids.length - 1);
}
const fitOf = (table, c) => Math.ceil(Math.max(0, ...[...table.querySelectorAll(c.cells)].map(el => (c.key === 'org' ? lineWidth(el) : textWidth(el)))));
// 표 하나에 끌기를 붙인다(같은 자리를 다시 그려도 한 번만 붙고, 저장된 너비를 다시 맞춘다). host = 표를 담은 자리(변수는 여기에 둔다).
export function mountWeeklyCols(table, kind) {
  const cols = WEEKLY_COLS[kind], host = table?.parentElement;
  if (!cols || !host) return;
  mountColResize({host, name:WEEKLY_COL_SCREEN, vars:Object.fromEntries(cols.map(c => [c.key, colVar(c.key)])), labels:Object.fromEntries(cols.map(c => [c.key, c.label])),
    fit:key => fitOf(table.isConnected ? table : host.querySelector('table') ?? table, cols.find(c => c.key === key))});
}
// WEEKLY-조직이름한줄: 4. 산하 조직 현황 [조직] 칸 기본 폭 = 가장 긴 이름 줄에 맞춤(끌어 정한 너비가 있으면 그것). 표 폭의 45%까지 — 넘치는 이름은 끝이 …(올리면 전체 이름).
export function fitOrgColumn(table) {
  const host = table?.parentElement;
  if (!host || !table.isConnected) return;
  const head = table.querySelector('thead th');
  if (!head || !head.getClientRects().length) { host.style.removeProperty('--wk-w-org-fit'); return; } // 폰: 머리줄 없음 — 칸 폭 없음
  const pad = parseFloat(getComputedStyle(head).paddingLeft) + parseFloat(getComputedStyle(head).paddingRight) || 0;
  const want = fitOf(table, WEEKLY_COLS.org[0]) + pad + 2;
  const cap = table.getBoundingClientRect().width * 0.45;
  if (want > 0) host.style.setProperty('--wk-w-org-fit', `${Math.round(Math.min(want, cap))}px`);
}
