// UI-고르기막대(S69-85, 사용자 11/25 00:37~00:42 "복사 옮기기 자료실로 별표 휴지통 / 이거를 좀더 세련되게 바꾸고 두줄로 삐져나오지 않게"):
// 파일·자료실·노트·줄 고르기·사진이 같은 고르기 막대 하나를 쓴다. 왼쪽 [✕] + 'N개', 오른쪽 아이콘 중심의 가벼운 단추(테두리 상자 없음),
// 휴지통은 맨 끝 — 꽉 찬 빨간 바탕 없이 아이콘·글자색만 경고색. 폭이 모자라면 ① 글자를 빼고 아이콘만 → ② 덜 쓰는 동작부터 ⋯ 하나로 접는다.
// 이 파일은 화면 없이 시험하는 순수 부분(단추 HTML·접는 차례). 재고 접는 일은 select-bar.js.
import {ROW_MENU_ICON} from './row-menu.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 16px 선 아이콘 경로. 줄 ⋯ 메뉴(row-menu.js)와 같은 그림을 쓰고, 막대에만 있는 것(닫기·모두 고르기·더 보기 등)을 더한다.
export const SB_ICON = Object.freeze({
  ...ROW_MENU_ICON,
  close: 'M4 4l8 8M12 4l-8 8',
  all: 'M3 3h10v10H3zM5.5 8l2 2 3-4',
  // [전체 선택]이 꺼졌을 때: 빈 네모(켜지면 all — 네모 안 체크 표시).
  box: 'M3 3h10v10H3z',
  paste: 'M5 3H3.5v10.5h9V3H11M6 2h4v2H6zM8 6.5v5M5.8 9.3L8 11.5l2.2-2.2',
  send: 'M2 8h10M9 5l3 3-3 3',
  folder: 'M2 4.5h4l1.3 1.5H14v6.5H2z',
  more: '',
});
const DOTS = '<circle cx="3.4" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.6" cy="8" r="1" fill="currentColor"/>';

export function sbIconHtml(key) {
  const body = key === 'more' ? DOTS : (SB_ICON[key] ? `<path d="${esc(SB_ICON[key])}"/>` : '');
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// 막대 단추 한 개. attrs = 그 화면이 쓰던 data-* 등(그대로 — 누르기 처리는 화면 것 그대로), icon = SB_ICON 열쇠(없으면 글자만),
// rank = 접는 차례(클수록 먼저 ⋯로), more = 늘 ⋯ 안에, danger = 휴지통·삭제(맨 끝, 글자·아이콘만 경고색), title = 마우스를 올리면 보이는 글.
export function sbActHtml({attrs = '', icon = '', label = '', danger = false, rank = 0, more = false, title = ''} = {}) {
  const tip = title || label;
  return `<button type="button" class="ghost kptu-sb-act${danger ? ' kptu-sb-danger' : ''}"${attrs ? ' ' + attrs : ''}${icon ? ` data-sb-icon="${esc(icon)}"` : ''}${rank ? ` data-sb-rank="${Number(rank) || 0}"` : ''}${more ? ' data-sb-more' : ''}${tip ? ` title="${esc(tip)}"` : ''}>`
    + (icon ? `<span class="kptu-act-ic" aria-hidden="true">${sbIconHtml(icon)}</span> ` : '') + `<span class="kptu-act-tx">${esc(label)}</span></button>`;
}
// 왼쪽 [✕](고르기 풀기). 이름은 화면 읽기·마우스 글로만(아이콘 하나).
export function sbCloseHtml(attrs = '', label = '선택 풀기') {
  return `<button type="button" class="ghost kptu-sb-act kptu-sb-close"${attrs ? ' ' + attrs : ''} aria-label="${esc(label)}" title="${esc(label)}">${sbIconHtml('close')}</button>`;
}

// 폭이 모자랄 때 접는 차례. items: [{i, rank, keep, danger, more}] (i = 막대 안 차례).
// 닫기(keep)·이미 ⋯ 안(more)은 빼고, rank가 큰 것부터, 같으면 뒤에 있는 것부터. 휴지통(danger)은 맨 마지막(그래도 모자랄 때만).
export function foldOrder(items) {
  const list = (items || []).filter(x => x && !x.keep && !x.more);
  const by = (a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0) || b.i - a.i;
  return [...list.filter(x => !x.danger).sort(by), ...list.filter(x => x.danger).sort(by)].map(x => x.i);
}

// UI-오른쪽밀기고르기(S70-64, 2026-11-26 07:44 사용자 "전체선택은 누르면 체크표시되고 다시 누르면 전체 선택 해제"):
// 고르기 막대의 [전체 선택] 한 칸. 켜고 끄는 단추(role=checkbox, aria-checked) — 켜지면 네모 안 체크(all), 꺼지면 빈 네모(box).
// 노트·자료실·줄 고르기(row-swipe.js)가 같은 칸을 쓴다. 다시 그리지 않는 막대는 select-bar.js paintSelectAll로 켜짐만 바꾼다.
export const SB_ALL_LABEL = '전체 선택';
export const sbAllIcon = on => (on ? 'all' : 'box');
export function sbAllHtml({attrs = '', on = false, disabled = false, label = SB_ALL_LABEL} = {}) {
  return sbActHtml({attrs: `role="checkbox" aria-checked="${on ? 'true' : 'false'}"${disabled ? ' disabled' : ''}${attrs ? ' ' + attrs : ''}`, icon: sbAllIcon(on), label, rank: 30});
}
