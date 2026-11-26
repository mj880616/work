// S71-54 NOTE-주제재료잇기 반대 방향(자료실): 자료 ⋯ 메뉴 아래쪽에 '이어진 생각지도 주제' 작은 줄 — 이 자료를 재료로 둔 노트 보드 주제들.
// 누르면 노트 › 보드의 그 주제로 간다(S71-52 찾기 이동 goToText — 노트 화면이 받음). 읽기는 owner RLS(note-board-links-data.js readMaterialTopics),
// 재료 칸이 없는 서버(적용 전)·이은 주제가 없으면 아무것도 그리지 않는다. 메뉴의 다른 줄·순서는 그대로(이 줄만 [삭제] 위에 더함).
import {readMaterialTopics} from './note-board-links-data.js';
import {requestBasketKind, requestBoardTopic} from './basket-note-tasks.js';
import {openOnScreen} from './source-open.js';

const cache = new Map(); // 자료 id → Promise(이번 접속 · 1분)
const AGE = 60000;
function topicsOf(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < AGE) return hit.ask;
  const ask = readMaterialTopics('doc', id).catch(() => []);
  cache.set(id, {at:Date.now(), ask}); return ask;
}
globalThis.window?.addEventListener?.('kptu:session-changed', () => cache.clear());
/** panel: 열린 자료 메뉴. isCurrent(): 아직 그 자료의 메뉴가 열려 있나. close(then): 메뉴 닫기(닫힌 뒤 then). */
export async function paintDocTopics(panel, id, {isCurrent = () => true, close = then => then?.()} = {}) {
  if (!panel || !id) return;
  const list = await topicsOf(id);
  if (!list.length || !isCurrent() || panel.querySelector('[data-lu-topics]')) return;
  const box = document.createElement('div'); box.className = 'lu-topics'; box.dataset.luTopics = '';
  const head = document.createElement('p'); head.className = 'lu-menu-head'; head.textContent = '이어진 생각지도 주제'; box.append(head);
  for (const t of list.slice(0, 8)) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.luBoardTopic = t.text;
    b.textContent = [...String(t.body || '').replace(/\s+/g, ' ').trim()].slice(0, 24).join('') || '주제';
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); close(() => { requestBasketKind('note'); requestBoardTopic({board:t.board, text:t.text}); void openOnScreen('basket'); }); });
    box.append(b);
  }
  const sep = panel.querySelector('hr.lu-menu-sep');
  if (sep) sep.before(box); else panel.append(box);
}
