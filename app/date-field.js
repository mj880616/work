// UI-날짜칸(2026-10-28 화면정리 A4): 사이트 공용 날짜 칸 하나.
// 기기·브라우저마다 다른 type=date 기본 표기('10/06/2026', 'mm/dd/yyyy', '2026. 10. 06.') 대신 앱이 '10. 6. (화)' 한 가지로 그린다
// (올해가 아니면 '2025. 10. 6. (월)'). 기기 달력(input type=date)·칸 모양은 그대로 두고, 기기 글자만 감춘 뒤 앱 글자를 칸 안쪽에 겹쳐 그린다.
// 값은 input 하나에만 있다(YYYY-MM-DD 그대로). 화면 코드는 지금처럼 input.value를 읽고 쓰며, 쓰면 보이는 글자도 따라 바뀐다.
// 붙이는 곳은 이 파일 하나(loader-v2.js가 모든 화면 전에 불러옴)이고 화면마다 부르지 않는다. 새로 그려진 날짜 칸은 아래 관찰자 하나가
// 추가된 마디 안의 input[type=date]만 찾아 붙인다(다른 그리기를 덮어쓰지 않고, 값·동작은 건드리지 않는 표시 칸만 씌움).
// 빼는 칸: 다른 버튼이 showPicker로 여는 숨은 달력(tabindex=-1·hidden·a11y-only), 제 글자가 따로 있는 칩(.due-chip)·일시 칸(.dt-date),
// data-native-date를 단 칸. 기기에 아무것도 저장하지 않는다.
import {seoulDateKey} from './meeting-time.js';

export const WEEKDAYS = '일월화수목금토';
const NATIVE_VALUE = typeof HTMLInputElement === 'undefined' ? null : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

// 'YYYY-MM-DD' → '10. 6. (화)'. 올해(서울 기준)가 아니거나 year:true면 연도를 앞에 붙인다. 읽을 수 없는 값은 ''.
export function dateLabel(value, {year = false, today = ''} = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return '';
  let thisYear = 0;
  try { thisYear = +String(today || seoulDateKey(new Date())).slice(0, 4); } catch { thisYear = 0; }
  return `${year || (thisYear && thisYear !== y) ? `${y}. ` : ''}${mo}. ${d}. (${WEEKDAYS[day.getUTCDay()]})`;
}

// 공용 칸에 붙이지 않는 날짜 input.
export function skipDateInput(input) {
  if (!input || input.type !== 'date') return true;
  if (input.dataset?.dateField || input.hasAttribute('data-native-date')) return true;
  if (input.hidden || input.getAttribute('tabindex') === '-1' || input.classList.contains('a11y-only') || input.classList.contains('due-chip-input')) return true;
  return !!input.closest?.('.dt-date,.due-chip,.date-field');
}

function paint(box, input, empty) {
  const text = box.querySelector('.date-field-text'), value = NATIVE_VALUE ? NATIVE_VALUE.get.call(input) : input.value;
  const label = dateLabel(value);
  text.textContent = label || empty;
  box.classList.toggle('is-empty', !label);
  // 글자는 input 자기 칸(테두리·높이·여백은 화면 규칙 그대로) 안쪽 왼쪽에 겹친다. 글자 크기·색도 input을 따른다.
  try {
    const cs = getComputedStyle(input);
    text.style.left = `${(parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0)}px`;
    text.style.fontSize = cs.fontSize;
  } catch { /* 처음 그릴 때 아직 화면에 없으면 CSS 기본 자리 */ }
}

// input 하나를 공용 날짜 칸으로. 이미 붙었거나 뺄 칸이면 그대로 둔다. 붙인 칸(span.date-field)을 돌려준다.
// 칸의 크기·테두리는 input 자기 것을 그대로 쓰고(화면마다 정한 높이·폭이 바뀌지 않게), 기기 글자만 감추고 앱 글자를 그 위에 그린다.
export function enhanceDateInput(input, {empty = '날짜'} = {}) {
  if (skipDateInput(input) || !input.parentNode) return null;
  input.dataset.dateField = '1';
  const owner = input.parentElement;
  // 감싸면 label 글자에 날짜 글자가 섞이므로, 이름이 없던 칸은 감싸기 전 label 글자를 이름으로 둔다.
  if (!input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby') && owner?.tagName === 'LABEL') {
    const own = [...owner.childNodes].filter(n => n !== input).map(n => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    if (own) input.setAttribute('aria-label', own);
  }
  const box = document.createElement('span');
  box.className = 'date-field' + (owner && (owner.tagName === 'LABEL' || getComputedStyle(input).display === 'block') ? ' is-block' : '');
  const text = document.createElement('span'); text.className = 'date-field-text'; text.setAttribute('aria-hidden', 'true');
  const focused = document.activeElement === input;
  input.before(box); box.append(input, text);
  if (focused) input.focus({preventScroll: true});
  const blank = input.dataset.dateEmpty || empty;
  const redraw = () => paint(box, input, blank);
  if (NATIVE_VALUE) {
    // 화면 코드가 value를 바꿔도(초기화·불러오기) 보이는 글자가 따라온다. 값 저장 자리는 원래 input 그대로다.
    Object.defineProperty(input, 'value', {configurable: true, get() { return NATIVE_VALUE.get.call(input); }, set(v) { NATIVE_VALUE.set.call(input, v); redraw(); }});
  }
  input.addEventListener('input', redraw); input.addEventListener('change', redraw); input.addEventListener('focus', redraw);
  redraw();
  return box;
}

export function enhanceDateInputs(root = document) {
  if (root?.matches?.('input[type="date"]')) enhanceDateInput(root);
  root?.querySelectorAll?.('input[type="date"]').forEach(input => enhanceDateInput(input));
}

function install() {
  if (typeof document === 'undefined' || window.__KPTU_DATE_FIELD__) return;
  window.__KPTU_DATE_FIELD__ = true;
  const start = () => {
    enhanceDateInputs(document.body);
    new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.tagName === 'INPUT' || n.firstElementChild)) enhanceDateInputs(n);
    }).observe(document.body, {childList: true, subtree: true});
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, {once: true});
}
install();
