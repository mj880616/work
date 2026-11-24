// NOTE-게시 ②(docs/design/note-publish.md): 노트 게시 상태 계산(그리기·보내기 없음). note-publish.js가 서버에서 읽은 줄로 쓴다.
// 게시 = 짝 표(app_note_share_pages) 한 줄 + 그 공유 페이지 status 'published'. 링크 값(token)은 여기 들어오지 않는다.
import {linkState} from './share-pages-model.mjs';

export const PUB_ON = 'on';     // 게시 중
export const PUB_OFF = 'off';   // 짝은 있고 게시 멈춤(draft·archived) — 다시 게시하면 같은 링크가 살아난다
export const PUB_NONE = 'none'; // 짝 없음, 또는 페이지가 휴지통에 있어 안 보임(다시 게시하면 새 페이지·새 링크)

// 짝 줄([{page_id, note_id}])과 보이는 페이지 줄([{id, status}]) → Map(note_id → {pageId, state}).
export function pubStates(pairs, pages) {
  const status = new Map((Array.isArray(pages) ? pages : []).filter(p => p && typeof p.id === 'string').map(p => [p.id, p.status]));
  const out = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (!pair || typeof pair.note_id !== 'string' || typeof pair.page_id !== 'string') continue;
    const s = status.get(pair.page_id);
    out.set(pair.note_id, {pageId:pair.page_id, state:s === undefined ? PUB_NONE : s === 'published' ? PUB_ON : PUB_OFF});
  }
  return out;
}
// 공유 페이지 제목 칸(1~200자, 제어 글자 없음 — DB 검사 app_share_pages_title_check)에 넣을 노트 제목 사본.
// 받는 화면은 노트의 지금 제목을 쓰고(share-page-read), 이 사본은 노트 제목이 빌 때만 보인다.
export function pageTitleFor(note) {
  const t = String(note && note.title != null ? note.title : '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return t ? [...t].slice(0, 200).join('') : '노트';
}
// 열려 있는 링크 하나(꺼지지 않고 기한이 지나지 않은 것 중 가장 먼저 만든 것). 없으면 null.
export function liveLink(links, now = Date.now()) {
  const list = (Array.isArray(links) ? links : []).filter(l => l && linkState(l, now) === 'on');
  list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return list[0] || null;
}
// 노트 메뉴 칸: 잠근 폴더의 노트는 게시를 새로 시작하지 않는다(이미 게시 중이면 멈추기만 둔다).
export function pubMenu(state, {locked = false} = {}) {
  if (state === PUB_ON) return locked ? ['stop'] : ['copy', 'stop'];
  return locked ? [] : ['make'];
}
export const PUB_LABELS = {make:'공유 링크 만들기', copy:'링크 복사', stop:'게시 멈춤'};
