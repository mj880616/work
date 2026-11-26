// S68-33 READ-글자크기(사용자 11/23 02:30 "+ - 버튼 텍스트 크기"): 글 보기 본문 글자 크기 [−][+] 공용 부품 하나.
// 쓰는 곳: 읽을 거리 글 보기(reading.js, 머리 단추줄 끝)·News 글 상세(now-detail.js, 원문 칸 머리 줄 — 옛 [가 가 가] 자리).
// - 값은 서버 화면 기억 view_prefs.news_font 하나(모든 기기·두 화면 같음, 기기 저장 없음). 기본(m)은 '없음'으로 둔다. 단계의 뜻은 text-size-model.mjs.
//   DB가 새 단계(xl·xxl)를 아직 모르면(적용 전 쓰기 400) view-prefs가 서버 값으로 되돌리므로 이번 접속에서 고른 값을 메모리에만 든다(note-zoom.js와 같은 방식).
// - 단추 모양은 공용 ⑤(.ds-seg + .ds-seg-btn, 노트 [−] 100% [+]와 같은 부품). 끝 단계 단추는 꺼짐(흐리게). 누르기는 문서 한 곳에서 받는다(화면이 다시 그려도 새로 묶지 않음).
// - 글자 크기는 대상([data-text-size-target])의 CSS 값 --txs(배율)로만 바꾼다. 화면 CSS가 본문 글자에 곱한다 — 머리·단추·요약 칸은 그대로.
//   밑줄은 글자 안의 표시(text-highlights.js)라 크기가 바뀌어도 같은 글자에 붙어 있다.
import {viewPrefs} from './view-prefs.js';
import {TEXT_SIZES, keepTextSize, stepTextSize, canStep, textScale} from './text-size-model.mjs';

export {TEXT_SIZES};
export const TEXT_SIZE_EVENT = 'kptu:text-size';
const KEY = 'news_font';
let session = null, refused = false;

export function textSize() {
  return keepTextSize(refused && session != null ? session : viewPrefs.get(KEY));
}
// 문서(또는 root) 안의 모든 [−][+]와 대상에 지금 값을 칠한다. 화면이 새로 그린 뒤에도 부른다.
export function paintTextSize(root = document) {
  if (!root) return;
  const v = textSize(), scale = String(textScale(v));
  const all = sel => [...(root.matches?.(sel) ? [root] : []), ...(root.querySelectorAll?.(sel) || [])];
  for (const el of all('[data-text-size-target]')) { el.style.setProperty('--txs', scale); el.dataset.textSize = v; }
  for (const b of all('[data-text-size-step]')) b.disabled = !canStep(v, Number(b.dataset.textSizeStep));
}
function tell() {
  paintTextSize();
  try { globalThis.dispatchEvent?.(new CustomEvent(TEXT_SIZE_EVENT, {detail: {size: textSize()}})); } catch { /* 알림만 */ }
}
export function setTextSize(value) {
  const v = keepTextSize(value);
  if (v === textSize()) return v;
  session = v;
  viewPrefs.set(KEY, v === 'm' ? null : v, {rejectable: true});
  void viewPrefs.flush?.();
  tell();
  return v;
}
// [−][+] 묶음 HTML(화면이 머리 줄에 넣는다). 지금 값으로 꺼짐을 미리 칠해 둔다.
export function textSizeHtml() {
  const v = textSize();
  const b = (dir, text, label) => `<button type="button" class="ds-seg-btn" data-text-size-step="${dir}" aria-label="${label}" title="${label}"${canStep(v, dir) ? '' : ' disabled'}>${text}</button>`;
  return `<span class="txs ds-seg" role="group" aria-label="글자 크기" data-text-size-ctl>${b(-1, '−', '글자 작게')}${b(1, '+', '글자 크게')}</span>`;
}

if (typeof document !== 'undefined' && !globalThis.__kptuTextSizeBound) {
  globalThis.__kptuTextSizeBound = true;
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-text-size-step]');
    if (!b || b.disabled) return;
    setTextSize(stepTextSize(textSize(), Number(b.dataset.textSizeStep)));
    // 끝 단계에 닿아 누른 단추가 꺼지면 초점을 옆 단추로(키보드로 계속 고를 수 있게).
    if (b.disabled) b.closest('[data-text-size-ctl]')?.querySelector('[data-text-size-step]:not(:disabled)')?.focus({preventScroll: true});
  });
  globalThis.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes(KEY)) { refused = true; tell(); } });
  globalThis.addEventListener?.('kptu:view-prefs-ready', () => { if (!refused) tell(); });
}
