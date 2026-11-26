// UI-고르기막대(S69-85): 공용 고르기 막대를 한 줄에 맞추는 부품. 모양은 base-ui.css '.kptu-selbar' 한 곳, 단추 HTML·접는 차례는 select-bar-model.mjs.
// 막대를 그리는 화면(파일·자료실·노트·줄 고르기)이 그린 직후 fitSelectBar(막대)를 부른다(막대의 주인은 그 화면 하나, 이 부품은 맞추기만).
// 맞추기: ① 다 들어가면 그대로 ② 넘치면 글자를 빼고 아이콘만(아이콘이 있는 단추) ③ 그래도 넘치면 덜 쓰는 동작부터 ⋯ 하나로 접는다.
// 폭이 바뀌면(폴드 펼침·창 크기) 다시 맞춘다. 접힌 단추는 막대 안에 보이지 않게 남아 있고, ⋯ 메뉴 항목을 누르면 그 단추를 누른 것과 같다
// (화면의 누르기 처리·흐린 단추 안내·펼침 메뉴가 그대로 — 새 처리 길을 만들지 않음). 글자는 화면 읽기에는 늘 남는다.
import {openRowMenu} from './row-menu.js';
import {SB_ICON, sbIconHtml, foldOrder, sbAllIcon} from './select-bar-model.mjs';

const seen = new WeakSet(), widths = new WeakMap();
let watcher = null;
const watch = bar => {
  if (seen.has(bar)) return;
  seen.add(bar);
  bar.addEventListener('click', onMore);
  if (typeof ResizeObserver !== 'function') return;
  watcher ||= new ResizeObserver(entries => {
    for (const e of entries) {
      const b = e.target;
      if (!b.isConnected || b.hidden || widths.get(b) === b.clientWidth) continue;
      requestAnimationFrame(() => fitSelectBar(b));
    }
  });
  watcher.observe(bar);
};
const isAct = b => b.matches('button.kptu-sb-act') && !b.classList.contains('kptu-sb-more');
function over(bar) {
  bar.classList.add('kptu-sb-measure');
  const o = bar.scrollWidth > bar.clientWidth + 1;
  bar.classList.remove('kptu-sb-measure');
  return o;
}
function moreButton(bar) {
  let m = bar.querySelector(':scope .kptu-sb-more');
  if (!m) {
    m = document.createElement('button');
    m.type = 'button'; m.className = 'ghost kptu-sb-act kptu-sb-more';
    m.setAttribute('aria-label', '더 보기'); m.title = '더 보기';
    m.setAttribute('aria-haspopup', 'true'); m.setAttribute('aria-expanded', 'false');
    m.innerHTML = sbIconHtml('more');
  }
  return m;
}

// 막대 맞추기. 숨긴 막대는 ⋯만 정리한다.
export function fitSelectBar(bar) {
  if (!bar) return;
  watch(bar);
  bar.classList.add('kptu-selbar');
  const acts = [...bar.querySelectorAll('button.kptu-sb-act')].filter(isAct);
  for (const b of acts) b.classList.remove('kptu-sb-folded');
  bar.classList.remove('kptu-sb-icons');
  // ⋯는 막대에 하나만. 단추가 모두 떼어져 있으면(자료실·노트 끄는 동안) ⋯도 두지 않는다.
  const olds = [...bar.querySelectorAll('.kptu-sb-more')];
  for (const m of olds.slice(1)) m.remove();
  const shown = acts.filter(b => !b.hidden);
  if (!shown.some(b => !b.classList.contains('kptu-sb-close'))) { olds[0]?.remove(); return; }
  const more = moreButton(bar);
  more.hidden = true;
  if (bar.hidden || !bar.isConnected) return;
  // ⋯ 자리: 휴지통 바로 앞(휴지통은 늘 맨 끝), 없으면 마지막 단추 뒤.
  const danger = shown.find(b => b.classList.contains('kptu-sb-danger'));
  const last = [...shown].reverse().find(b => !b.classList.contains('kptu-sb-close'));
  if (danger) { if (more.nextElementSibling !== danger) danger.before(more); }
  else if (last) { if (last.nextElementSibling !== more) last.after(more); }
  else if (more.parentElement !== bar) bar.append(more);
  widths.set(bar, bar.clientWidth);
  const fold = b => b.classList.add('kptu-sb-folded');
  const always = shown.filter(b => b.hasAttribute('data-sb-more'));
  always.forEach(fold);
  if (always.length) more.hidden = false;
  if (!over(bar)) return;
  bar.classList.add('kptu-sb-icons');
  if (!over(bar)) return;
  more.hidden = false;
  const order = foldOrder(shown.map((b, i) => ({i, rank: Number(b.dataset.sbRank) || 0, keep: b.classList.contains('kptu-sb-close'),
    danger: b.classList.contains('kptu-sb-danger'), more: b.hasAttribute('data-sb-more')})));
  for (const i of order) { fold(shown[i]); if (!over(bar)) break; }
}

const labelOf = b => (b.querySelector('.kptu-act-tx')?.textContent || b.getAttribute('aria-label') || b.textContent || '').trim();
// ⋯ 메뉴: 접힌 단추들(막대 차례 그대로). 휴지통이 접혔으면 맨 아래 빨간 줄.
function onMore(e) {
  const m = e.target.closest?.('.kptu-sb-more'), bar = e.currentTarget;
  if (!m || !bar.contains(m)) return;
  e.preventDefault(); e.stopPropagation();
  const folded = [...bar.querySelectorAll('button.kptu-sb-act.kptu-sb-folded')].filter(b => !b.hidden);
  if (!folded.length) return;
  const items = folded.map((b, i) => ({id: String(i), label: labelOf(b), icon: SB_ICON[b.dataset.sbIcon] || '',
    last: b.classList.contains('kptu-sb-danger'), sep: b.classList.contains('kptu-sb-danger'), disabled: b.disabled,
    off: b.getAttribute('aria-disabled') === 'true', popup: b.hasAttribute('aria-haspopup')}));
  openRowMenu(m, {key: 'sb-more', label: bar.getAttribute('aria-label') || '선택한 것', items, row: m,
    run: id => {
      let b = folded[Number(id)];
      // 메뉴가 열린 사이 막대를 다시 그렸으면 같은 이름의 새 단추를 누른다.
      if (!b?.isConnected) { const name = items[Number(id)]?.label; b = [...bar.querySelectorAll('button.kptu-sb-act')].find(x => labelOf(x) === name); }
      if (b && !b.disabled) b.click();
    }});
}

// UI-오른쪽밀기고르기(S70-64): [전체 선택] 칸의 켜짐(체크 표시)만 바꾼다 — 화면 목록이 모두 골라졌으면 켜짐(네모 안 체크), 아니면 빈 네모.
export function paintSelectAll(btn, on) {
  if (!btn) return;
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  const icon = sbAllIcon(on);
  if (btn.dataset.sbIcon === icon) return;
  btn.dataset.sbIcon = icon;
  const ic = btn.querySelector('.kptu-act-ic');
  if (ic) ic.innerHTML = sbIconHtml(icon);
}
