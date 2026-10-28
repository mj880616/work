// IMG-빈칸(PHOTO-못받은사진, 2026-10-29 명진 결정): 앱 안 그림 칸 하나의 표시 규칙. 그림을 띄우는 곳은 모두 이 파일을 쓴다.
// - 받는 중: 글자 없는 연한 회색 칸(data-img-state="loading").
// - 받음: 그림(data-img-state="shown"). <img>는 다 받은 뒤에만 보인다(그 전에는 visibility:hidden → 깨진 그림 표시·대체 글자가 화면에 나오지 않음).
// - 못 받음: 같은 회색 칸 가운데 작은 ↻ 하나(data-img-state="failed"). ↻를 누르면 그 그림만 다시 받는다. 화면을 다시 열면 칸이 새로 만들어져 저절로 다시 받는다.
// - 모양은 base-ui.css의 .img-slot 규칙 하나. 회색 칸 색은 '불러오는 중' 공용 부품(wait-state.js, UI-기다림표시통일)의 회색 빈 줄과 같다.
// - 안전망: 이 파일을 불러오면 문서 전체에서 그림 받기 실패(error)를 잡아 그 <img>를 감춘다(data-img-broken). 칸 규칙을 아직 안 쓴 곳도 깨진 그림이 보이지 않는다.
// 기기 저장 없음(메모리의 WeakMap뿐).
export const SLOT_CLASS = 'img-slot';
const retries = new WeakMap();

function addClass(el, name) {
  if (el.classList) el.classList.add(name);
  else if (!String(el.className || '').split(/\s+/).includes(name)) el.className = `${el.className || ''} ${name}`.trim();
}
function dropRetry(box) {
  const old = box.querySelector?.('[data-img-retry]') || (box.children || []).find?.(c => c?.dataset && 'imgRetry' in c.dataset);
  if (old) old.remove();
}
const inControl = box => !!box.closest?.('button,a,[role="button"]');

// 칸으로 만든다(처음 상태: 받는 중).
export function slotBox(box) {
  addClass(box, SLOT_CLASS);
  if (!box.dataset.imgState) box.dataset.imgState = 'loading';
  return box;
}
export function slotLoading(box) {
  slotBox(box); dropRetry(box);
  box.dataset.imgState = 'loading'; delete box.dataset.imgWhy;
}
export function slotShown(box) {
  slotBox(box); dropRetry(box);
  box.dataset.imgState = 'shown'; delete box.dataset.imgWhy;
  retries.delete(box);
}
// 못 받음: ↻ 하나. retry가 없으면 ↻ 없이 회색 칸만(다시 받을 길이 없는 곳). why는 진단용 짧은 이름(화면에 보이지 않음).
// passive: 그림이 더 큰 누르기 칸의 바탕일 때(달력 날짜 칸·목록 줄 등). ↻는 표시만 하고 누르기는 바깥 칸(그날 열기 등)이 그대로 받는다.
// 이런 칸은 화면을 다시 열면 저절로 다시 받는다.
export function slotFailed(box, retry = null, why = '', {passive = false} = {}) {
  slotBox(box); dropRetry(box);
  box.dataset.imgState = 'failed';
  if (why) box.dataset.imgWhy = String(why).slice(0, 40); else delete box.dataset.imgWhy;
  if (typeof retry !== 'function' && !passive) { retries.delete(box); return; }
  const mark = document.createElement('span');
  mark.className = 'img-slot-retry'; mark.dataset.imgRetry = ''; mark.textContent = '↻';
  if (passive || typeof retry !== 'function') {
    retries.delete(box);
    mark.className += ' is-passive'; mark.setAttribute('aria-hidden', 'true');
    box.append(mark);
    return;
  }
  retries.set(box, retry);
  // 버튼 안(사진 칸)에서는 버튼 안 버튼을 만들지 않는다: 누르기는 아래 문서 전체 처리기가 받는다(바깥 버튼의 키보드 누르기도 다시 받기).
  if (!inControl(box)) { mark.setAttribute('role', 'button'); mark.setAttribute('tabindex', '0'); }
  mark.setAttribute('aria-label', '다시 받기'); mark.setAttribute('title', '다시 받기');
  box.append(mark);
}
// 그 칸만 다시 받는다. 다시 받을 길이 있었으면 true.
export function slotRetry(box) {
  const retry = retries.get(box);
  if (!retry || box.dataset.imgState !== 'failed') return false;
  retries.delete(box);
  slotLoading(box);
  try { retry(); } catch { /* 다시 받기 실패는 그 칸이 스스로 다시 failed로 */ }
  return true;
}
// 단순한 그림 하나: src를 넣고, 다 받으면 shown, 못 받으면 failed(↻는 retry가 있을 때). 같은 <img>를 다시 써도 된다.
export function slotImg(box, img, src, {retry = null, onShown = null, onFailed = null, passive = false} = {}) {
  slotBox(box);
  if (img.parentNode !== box && !(box.children || []).includes?.(img)) box.append(img);
  img.onload = () => { img.onload = img.onerror = null; slotShown(box); onShown?.(); };
  img.onerror = () => { img.onload = img.onerror = null; img.removeAttribute('src'); slotFailed(box, retry, 'img', {passive}); onFailed?.(); };
  slotLoading(box);
  img.src = src;
  return img;
}

// 문서 전체 처리기(한 번만): ↻ 누르기, 바깥 버튼의 키보드 누르기(못 받은 칸 하나뿐일 때), 그림 받기 실패 안전망.
function slotOf(target) {
  const mark = target?.closest?.('[data-img-retry]');
  if (mark) return mark.closest(`.${SLOT_CLASS}`);
  return null;
}
function install(doc) {
  if (!doc?.addEventListener || doc.__imgSlotInstalled) return;
  doc.__imgSlotInstalled = true;
  doc.addEventListener('click', event => {
    let box = slotOf(event.target);
    // 키보드로 바깥 버튼을 눌렀을 때(detail 0): 그 버튼 안의 칸이 하나이고 못 받은 상태면 다시 받기.
    if (!box && event.detail === 0 && event.target?.matches?.('button')) {
      const inner = event.target.querySelectorAll(`.${SLOT_CLASS}`);
      if (inner.length === 1 && inner[0].dataset.imgState === 'failed' && retries.has(inner[0])) box = inner[0];
    }
    if (!box || !retries.has(box)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    slotRetry(box);
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const box = slotOf(event.target);
    if (!box || !retries.has(box)) return;
    event.preventDefault(); event.stopPropagation();
    slotRetry(box);
  }, true);
  // 안전망: 어떤 <img>든 받기에 실패하면 감춘다(깨진 그림 표시·대체 글자 없음). 다시 받아 성공하면 되돌린다.
  doc.addEventListener('error', event => {
    const t = event.target;
    if (t?.tagName === 'IMG') t.dataset.imgBroken = '';
  }, true);
  doc.addEventListener('load', event => {
    const t = event.target;
    if (t?.tagName === 'IMG' && t.dataset && 'imgBroken' in t.dataset) delete t.dataset.imgBroken;
  }, true);
}
if (typeof document !== 'undefined') install(document);
