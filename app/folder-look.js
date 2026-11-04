// FOLDER-순서·색 ② (S49-38, 설계 5절): 폴더 아이콘·색 고르기 줄을 그리는 공용 부품(순서·색 계산은 folder-look-model.mjs).
// 색 번호 1~8만 data-fc에 달고, 실제 색 값은 theme-tokens.css(--ds-folder-N-*)와 folder-look.css([data-fc]) 한 곳이 정한다.
// 안 고른 폴더(color null)는 지금 모양 그대로 노란 폴더 그림(📁/📂)을 쓴다. 이번 단계는 노트가, 다음 단계는 자료실·[파일]·사진이 같은 부품을 부른다.
import {FOLDER_COLORS, colorOf, colorName, folderShapeHtml} from './folder-look-model.mjs';
import {swatchHtml} from './color-swatch.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 줄 앞 폴더 그림. row.color(1~8)이 있으면 칠한 그림, 없으면 지금의 노란 폴더. open: 열린 폴더·지금 폴더.
export function folderIconHtml(row, {open = false, className = 'nx-ico'} = {}) {
  const color = colorOf(row);
  if (!color) return `<span class="${className}" aria-hidden="true">${open ? '\u{1F4C2}' : '\u{1F4C1}'}</span>`;
  return `<span class="${className} fl-ico" data-fc="${color}" aria-hidden="true">${folderShapeHtml(open ? 'open' : 'closed')}</span>`;
}
// 폴더 고르기 창 줄 앞의 작은 그림(색 고른 폴더만 보인다. 안 고른 폴더는 지금 모양 그대로 그림 없음).
export const pickIconHtml = row => (colorOf(row) ? folderIconHtml(row, {className: 'lu-move-ico'}) : '');
// data-fc 속성(꼬리표·포스트잇 칸에 다는 값). 안 고른 폴더는 빈 글자.
export const fcAttr = row => { const c = colorOf(row); return c ? ` data-fc="${c}"` : ''; };

// 색 고르기 줄: 동그라미 8개 + [기본]. 단추는 모두 공용 색 칸 부품(color-swatch.mjs)으로 그린다. 고른 색은 aria-checked.
// 이름은 툴팁·aria-label(색만으로 뜻을 전하지 않음). 색 값은 토큰(--ds-folder-N-ico)이라 이 파일에 색 글자가 없다.
export function colorChoiceHtml(current) {
  const now = colorOf({color: current});
  return `<div class="fl-choice" role="radiogroup" aria-label="폴더 색">${FOLDER_COLORS.map(c => swatchHtml({color: `var(--ds-folder-${c.n}-ico)`, label: c.name, role: 'radio', on: now === c.n, attrs: {'data-fl-color': c.n, title: c.name}})).join('')}${swatchHtml({color: '', label: '기본', text: '기본', role: 'radio', on: !now, attrs: {'data-fl-color': 0, title: '기본 (색 없음)'}})}</div>`;
}
// 눌린 단추 → 색 번호(0 = 기본 = null). 색 단추가 아니면 undefined.
export function colorFromButton(button) {
  const el = button?.closest?.('[data-fl-color]');
  if (!el) return undefined;
  const n = Number(el.dataset.flColor);
  return n === 0 ? null : (Number.isInteger(n) && n >= 1 && n <= 8 ? n : undefined);
}
export {colorName};
