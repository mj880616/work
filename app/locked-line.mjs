// S71-19(명진 11/26 17:14 "통화 텔레그램 2줄 / 이게 구분감이 없어 위에거랑"): 목록 맨 아래 '통화·텔레그램 n줄 · 잠김 [풀기]' 한 줄.
// 이 줄은 바로 위 줄(업데이트 등)의 일부가 아니라 따로 잠가 둔 묶음이다 — 위와 사이 얇은 선(목록 줄 구분선과 같은 선)과
// 맨 앞 작은 아이콘(메뉴의 통화·텔레그램 아이콘 그대로)으로 구분한다. 잊지 말기·조직 주요 인물·밑줄 세 곳이 이 함수 하나를 쓴다.
import {itemOf} from './menu-model.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
const iconOf = feature => itemOf(feature)?.icon || '';

// features: 잠긴 기능 이름들(잠금 창이 읽는 data-lock-here, 예: ['calls','telegram']). label: 줄 앞 이름. attrs: 부르는 곳 표시(시험·눌림 길).
export function lockedLineHtml({features = [], label = '', count = 0, cls = '', attrs = ''} = {}) {
  const icons = features.map(iconOf).filter(Boolean).map(d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`).join('');
  const klass = ['locked-line', cls].filter(Boolean).join(' ');
  return `<p class="${esc(klass)}"${attrs ? ` ${attrs}` : ''} data-locked-line data-lock-here="${esc(features.join(' '))}">`
    + (icons ? `<span class="locked-line-ic">${icons}</span>` : '')
    + `<span class="locked-line-text">${esc(label)} ${Number(count) || 0}줄 · 잠김</span> <button type="button" class="row-act lk-open">풀기</button></p>`;
}
