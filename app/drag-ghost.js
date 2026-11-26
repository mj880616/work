// S69-27 끄는 모습 보이기(사용자 11/24 "드래그하면 드래그하는 게 보여야해. 투명하게 따라오는"): 끄는 동안 마우스·손가락을 따라오는
// 반투명 조각(제목 한 줄, 여러 개면 '노트 3개') 공용 부품 한 곳. 모양은 꾹 눌러 끌기 부품(touch-drag.js)과 같은 .td-ghost(base-ui.css).
// 조각은 pointer-events:none이라 놓을 곳 판정(elementFromPoint)을 가리지 않는다. 화면 메모리만(기기 저장 없음).

// 글자 한 줄로 자른다(조각이 길어지지 않게).
export const ghostText = (text, max = 40) => [...String(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');

// 여러 개를 끌 때의 글자. notes·folders = 끄는 노트·폴더 수. 하나면 null(부르는 쪽이 제목을 쓴다).
export function ghostCountText(notes = 0, folders = 0) {
  const n = Math.max(0, Number(notes) || 0), f = Math.max(0, Number(folders) || 0);
  if (n + f < 2) return null;
  if (!f) return `노트 ${n}개`;
  if (!n) return `폴더 ${f}개`;
  return `노트 ${n}개 · 폴더 ${f}개`;
}

// 포인터로 끄는 곳(reorder-drag.js 등): show(글자, x, y) → move(x, y) → hide().
export function createDragGhost(doc = globalThis.document) {
  let el = null;
  const place = (x, y) => { if (el && Number.isFinite(x) && Number.isFinite(y)) el.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y - 28)}px)`; };
  return {
    show(label, x, y) {
      const text = ghostText(label);
      if (!text || !doc?.body) return;
      if (!el) { el = doc.createElement('div'); el.className = 'td-ghost dg-ghost'; el.setAttribute('aria-hidden', 'true'); el.dataset.dragGhost = ''; doc.body.append(el); }
      el.textContent = text; place(x, y);
    },
    move: place,
    hide() { el?.remove(); el = null; },
    get shown() { return !!el; },
  };
}

// 브라우저 끌기(HTML5 끌어 놓기, PC 마우스): 같은 모양 조각을 끌기 그림으로 준다(브라우저가 반투명하게 그려 따라오게 한다).
// S70-79 STD-끌기모양(명진 11/26 "노란 네모"): 조각을 화면 밖(top:-1000px)에 두면 PC 크롬이 그림을 제대로 찍지 못해 테두리만 남은
// 작은 네모(노란 바탕 판에서 노란 네모)가 따라왔다. 이제 조각을 마우스 자리(화면 안, 끌기 그림이 그려질 바로 그 자리)에 두고 찍은 뒤
// 한 박자 뒤에 뗀다. 끌기를 시작하며 생긴 글자 선택(파란 칠)도 지운다. point = 끌기 시작 event(clientX·clientY) — 없으면 왼쪽 위.
// 그림을 줄 수 없는 브라우저는 기본 그림 그대로(false).
export const DRAG_IMAGE_X = 12, DRAG_IMAGE_Y = 14;
export function setDragGhostImage(dataTransfer, label, doc = globalThis.document, point = null) {
  const text = ghostText(label);
  if (!text || typeof dataTransfer?.setDragImage !== 'function' || !doc?.body) return false;
  try { doc.getSelection?.()?.removeAllRanges(); } catch { /* 선택이 없는 문서 */ }
  const x = Number(point?.clientX), y = Number(point?.clientY);
  const el = doc.createElement('div');
  el.className = 'td-ghost dg-ghost dg-image'; el.setAttribute('aria-hidden', 'true'); el.textContent = text;
  el.style.transform = Number.isFinite(x) && Number.isFinite(y) ? `translate(${Math.max(0, Math.round(x - DRAG_IMAGE_X))}px, ${Math.max(0, Math.round(y - DRAG_IMAGE_Y))}px)` : 'none';
  doc.body.append(el);
  try { dataTransfer.setDragImage(el, DRAG_IMAGE_X, DRAG_IMAGE_Y); } catch { el.remove(); return false; }
  setTimeout(() => el.remove(), 0);
  return true;
}
