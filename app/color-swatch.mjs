// UI-색고르기통일(2026-10-29): 색을 고르는 칸은 모두 이 부품 하나로 그린다(일정 색·프로젝트 색).
// 칸 = 그 색으로 채운 작은 네모(.ui-swatch-fill). 고르면 그 위에 ✓와 얇은 테두리만 더한다(ui-standard.css 'UI-색고르기통일').
// 색은 안쪽 네모의 inline style에만 둔다. 선택 표시나 화면 공통 규칙이 단추 바탕·테두리를 바꿔도 고른 색은 덮이지 않는다.
// 새 색 고르기 칸이 이 부품을 쓰지 않으면 tests/color-swatch.test.mjs가 실패한다.
const SAFE_COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|var\(--[a-z0-9-]+\))$/i;
const SAFE_ATTR = /^(data-[a-z0-9-]+|title|tabindex)$/;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** 받아들이는 색: #rgb·#rrggbb(투명도 포함) 또는 var(--토큰). 그 밖은 빈 문자열(칸은 빈 네모 + 글자). */
export const swatchColor = value => { const s = String(value ?? '').trim(); return SAFE_COLOR.test(s) ? s : ''; };

/**
 * 색 칸 단추 하나의 HTML.
 * role 'radio'(하나 고르기, aria-checked) 또는 'toggle'(여러 개 켜고 끄기, aria-pressed).
 * text는 색을 모를 때만 네모 안에 보이는 짧은 글자(예: 번호).
 */
export function swatchHtml({color, ink = '', label, on = false, role = 'toggle', attrs = {}, disabled = false, text = ''} = {}) {
  const fill = swatchColor(color), fg = swatchColor(ink);
  const state = role === 'radio' ? `role="radio" aria-checked="${on ? 'true' : 'false'}"` : `aria-pressed="${on ? 'true' : 'false'}"`;
  const extra = Object.entries(attrs).filter(([k, v]) => SAFE_ATTR.test(k) && v != null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const style = [fill ? `background:${fill}` : '', fg ? `--ui-swatch-ink:${fg}` : ''].filter(Boolean).join(';');
  const fillAttrs = `${style ? ` style="${style}"` : ''}${!fill && text ? ` data-text="${esc(text)}"` : ''}`;
  return `<button type="button" class="ui-swatch" ${state} aria-label="${esc(label)}"${extra}${disabled ? ' disabled' : ''}><span class="ui-swatch-fill" aria-hidden="true"${fillAttrs}></span></button>`;
}

/** 같은 단추를 DOM으로. 화면 코드가 직접 단추를 만들지 않도록 이것을 쓴다. */
export function createSwatch(options) {
  const box = document.createElement('template');
  box.innerHTML = swatchHtml(options);
  return box.content.firstElementChild;
}

/** 고름 표시만 바꾼다. 색(inline style)은 건드리지 않는다. */
export function setSwatchOn(button, on) {
  if (!button) return;
  button.setAttribute(button.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed', on ? 'true' : 'false');
}
