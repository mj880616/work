// UI-날짜칸(2026-10-28 화면정리 A4): 사이트 공용 날짜 칸 하나.
// 기기·브라우저마다 다른 type=date 기본 표기('10/06/2026', 'mm/dd/yyyy', '2026. 10. 06.') 대신 앱이 '10. 6. (화)' 한 가지로 그린다
// (올해가 아니면 '2025. 10. 6. (월)'). 기기 달력(input type=date)은 그대로 두고 글자 칸 위에 투명하게 겹쳐 눌러서 고른다.
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
  box.classList.toggle('is-disabled', !!input.disabled);
}

// input 하나를 공용 날짜 칸으로. 이미 붙었거나 뺄 칸이면 그대로 둔다. 붙인 칸(span.date-field)을 돌려준다.
export function enhanceDateInput(input, {empty = '날짜'} = {}) {
  if (skipDateInput(input) || !input.parentNode) return null;
  input.dataset.dateField = '1';
  const box = document.createElement('span');
  box.className = 'date-field' + (input.parentElement?.tagName === 'LABEL' || input.parentElement?.classList.contains('date-field-row') ? ' is-block' : '');
  const text = document.createElement('span'); text.className = 'date-field-text'; text.setAttribute('aria-hidden', 'true');
  input.before(box); box.append(text, input);
  const blank = input.dataset.dateEmpty || empty;
  const redraw = () => paint(box, input, blank);
  if (NATIVE_VALUE) {
    // 화면 코드가 value를 바꿔도(초기화·불러오기) 보이는 글자가 따라온다. 값 저장 자리는 원래 input 그대로다.
    Object.defineProperty(input, 'value', {configurable: true, get() { return NATIVE_VALUE.get.call(input); }, set(v) { NATIVE_VALUE.set.call(input, v); redraw(); }});
  }
  input.addEventListener('input', redraw); input.addEventListener('change', redraw);
  // 칸 어디를 눌러도 달력이 열린다(지원하는 브라우저). 못 열면 기기 기본 동작 그대로.
  input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* 기본 동작 */ } });
  // disabled 바뀜은 다음 그리기 때 반영하고, 지금 상태로 한 번 그린다.
  redraw();
  return box;
}

export function enhanceDateInputs(root = document) {
  if (root?.matches?.('input[type="date"]')) enhanceDateInput(root);
  root?.querySelectorAll?.('input[type="date"]').forEach(input => enhanceDateInput(input));
}
// 막힘 상태(disabled)를 바꾼 화면이 부르면 흐린 모양이 맞춰진다.
export function refreshDateField(input) {
  const box = input?.closest?.('.date-field');
  if (box) paint(box, input, input.dataset.dateEmpty || '날짜');
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
