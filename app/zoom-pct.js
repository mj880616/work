// UI-확대비율(S69-33, 사용자 11/24 "+ - 누르면 현재 몇 %로 보는지 표시" · "그 숫자를 누르면 80% 90% 100% 110% 120% 이렇게 드롭다운이 떠"):
// [−] [100% ▾] [+] 묶음의 가운데 비율 글자를 누르면 그 자리에 작은 목록이 뜨고, 지금 값에 체크, 고르면 그 비율.
// - 목록 상자는 공용 줄 메뉴(row-menu.js → anchored-menu.js) 그대로 — 모양·뒤로가기·Esc·바깥 누름·아래 바 피하기가 다른 메뉴와 같다.
// - 이 부품은 비율 글자 단추와 목록 항목만 맡는다. 값의 주인(지금 비율·바꾸기)은 부르는 화면이고, 열 때마다 levels·now()·choose(v)를 받는다.
// - 쓰는 곳: 노트 보드 확대(note-board.js, 80~120%), 노트 내용 크기(note-zoom.js, 그 화면의 단계). 지금 값이 목록에 없는 값(예 73%)이면 체크 없이 표시만.
// - 저장 없음(값 저장은 부르는 화면 몫).
import {openRowMenu} from './row-menu.js';

export const pctOf = v => Math.round(Number(v) || 0);
const CHECK = 'M3.5 8.5l3 3 6-7';
// 비율 글자 옆 작은 세모(그림 — 글자는 비율만 남긴다).
const CARET = '<svg class="zoom-pct-caret" viewBox="0 0 8 8" width="7" height="7" aria-hidden="true" focusable="false" style="display:inline-block;flex:none;margin-left:3px;vertical-align:middle;opacity:.65"><path d="M1 2.5h6L4 6z" fill="currentColor"/></svg>';

// trigger: 비율 글자 단추. levels: 고를 비율들(정수 %), now(): 지금 비율(%), choose(v): 그 비율로.
export function openZoomPct(trigger, {levels, now, choose, label = '보기 비율'}) {
  if (!trigger) return false;
  const at = pctOf(now());
  return openRowMenu(trigger, {key: trigger.dataset.zoomPctKey || 'zoom', label,
    items: levels.map(v => ({id: String(v), label: `${v}%`, icon: v === at ? CHECK : ''})),
    run: id => { const v = Number(id); if (Number.isFinite(v)) choose(v); }});
}

// 비율 글자 단추를 그 자리 목록 단추로 만든다(aria 표시 + 누르면 목록). 글자는 paint()로 부르는 쪽이 갱신한다.
export function bindZoomPct(button, {levels, now, choose, label = '보기 비율'}) {
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.dataset.zoomPct = '';
  const paint = () => {
    const v = pctOf(now());
    button.innerHTML = `<span class="zoom-pct-now">${v}%</span>${CARET}`;
    button.setAttribute('aria-label', `${label} ${v}% · 누르면 비율 선택`);
    button.title = `${label} ${v}%`;
  };
  button.addEventListener('click', e => { e.preventDefault(); openZoomPct(button, {levels, now, choose, label}); });
  paint();
  return {paint};
}
