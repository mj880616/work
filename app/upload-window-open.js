// BRIEF-추가빠르게(사용자 신고 11/28 "[+] → 파일 업로드 누르고 나서 창 뜨는 반응이 너무 늦음 5초 이상"): 다른 화면(브리핑 룸·담당조직·사업 보고)에서
// 자료 등록 창(#documentModal — 그리는 주인은 자료실 library-upload.js)을 여는 한 길.
// - 누르자마자 그 창의 자리(머리 '자료 등록'·× + 회색 기다림 줄)를 최종 창과 같은 틀·폭·높이로 보인다(높이는 지난번 최종 창 높이, 처음이면 CSS 기본값).
// - 창을 열 수 있게 되면(view-loader uploadWindow — 자료실 화면 전체가 아니라 폴더·분류·받는 폴더까지만) 같은 틀 안에서 최종 창을 채운 뒤 기다림 줄을 뺀다
//   (채우는 동안 내용은 가려 두고 한 번에 보임 — 기본 모양을 먼저 그렸다가 덮어쓰지 않는다).
// - 기다리는 동안 ×·Esc로 닫으면 열지 않는다. 같은 길을 다시 누르면 앞의 것은 버린다. 화면 상태는 이 탭 메모리만(기기 저장 없음).
import {waitHtml} from './wait-state.js';

const WAIT = 'doc-wait';
let ticket = 0, lastHeight = 0;
const modalEl = () => document.getElementById('documentModal');
const waiting = m => !!m && m.classList.contains(WAIT) && !m.classList.contains('hidden');

function closeShell(m) {
  m.classList.remove(WAIT); m.removeAttribute('aria-busy'); m.style.removeProperty('--doc-wait-h');
  m.querySelector('[data-doc-wait]')?.remove();
}
function stopShell(m) { closeShell(m); m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
function showShell(m, mine) {
  const card = m.querySelector('.modal-card'); if (!card) return false;
  if (!card.querySelector('[data-doc-wait]')) card.querySelector('.modal-head')?.insertAdjacentHTML('afterend', `<div class="doc-wait-box" data-doc-wait>${waitHtml({rows: 6, h: 28})}</div>`);
  if (lastHeight) m.style.setProperty('--doc-wait-h', `${lastHeight}px`);
  m.classList.add(WAIT); m.setAttribute('aria-busy', 'true');
  m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false');
  // 기다리는 동안의 닫기: ×(data-close)·Esc. 최종 창이 열리면 공용 창 도구(team.js openModal)가 맡는다.
  const close = e => {
    if (mine !== ticket || !waiting(m)) { off(); return; }
    if (e.type === 'keydown' ? e.key !== 'Escape' : !e.target.closest?.('[data-close="documentModal"]')) return;
    e.preventDefault(); e.stopPropagation(); ticket++; stopShell(m); off();
  };
  const off = () => { m.removeEventListener('click', close, true); document.removeEventListener('keydown', close, true); };
  m.addEventListener('click', close, true); document.addEventListener('keydown', close, true);
  return off;
}

// start(library) → 창을 열었으면 true(KPTULibrary.startUploadInFolder 등). 열었으면 true, 닫았거나 못 열면 false(못 열면 onFail).
export async function openUploadWindow(start, {onFail = () => {}} = {}) {
  const mine = ++ticket, m = modalEl(), loader = window.KPTUViewLoader;
  if (!m || typeof loader?.uploadWindow !== 'function') { onFail(); return false; }
  const ready = loader.uploadWindow();
  // 창 폭(넓은 화면 640) 규칙은 자료실 모양 파일에 있다 — 그 파일이 아직 없는 화면(사업 보고 등)도 틀이 최종 폭으로 뜨게 먼저 붙인다(받아 둔 작은 파일).
  await loader.style?.('./library-upload.css');
  if (mine !== ticket) return false;
  const off = showShell(m, mine);
  let ok = false;
  try { ok = await ready; } catch { ok = false; }
  if (typeof off === 'function') off();
  if (mine !== ticket) return false; // 기다리는 동안 닫았거나 다시 눌렀다
  const shown = waiting(m);
  if (!ok) { if (shown) stopShell(m); onFail(); return false; }
  if (!shown) return false;
  // 최종 창은 기다림 틀 안에서 채운다(내용은 틀이 벗겨질 때 한 번에 보임). 여는 함수가 끝나면 같은 작업 안에서 틀을 벗긴다.
  let opened = false;
  try { opened = !!(await start(window.KPTULibrary)); } catch { opened = false; }
  if (mine !== ticket) return false;
  if (!opened) { if (!m.classList.contains('hidden')) stopShell(m); onFail(); return false; }
  closeShell(m);
  requestAnimationFrame(() => { const h = m.querySelector('.modal-card')?.offsetHeight; if (h) lastHeight = h; });
  return true;
}
