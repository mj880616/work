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

// NOTE-게시 ③ 사진 거울(docs/design/note-publish.md 5절): 받는 사람이 노트 사진을 보게, 주인이 로그인한 상태(게시할 때·게시 중 노트를 저장할 때)에
// 주인 화면이 그 노트 사진을 짝 공유 페이지 사진(share-page-media, 비공개 버킷·share:<id>)으로 올리고, 짝 페이지 블록에 '노트 사진 → 페이지 사진' 줄만 적는다.
// 받는 사람 요청 때 서버가 주인 Drive를 읽지 않는다. Drive 파일 번호는 적지 않고 지문(key)만: sha256("<페이지 id>:<노트 사진 src>")
// (share-page-read handler.ts photoKey와 같은 셈). 공유 페이지 블록 검사(app_share_pages_blocks_check)가 받는 글 블록 모양이다.
export const MIRROR_MAX = 20;
const KEY = /^[0-9a-f]{64}$/;
const SHARE_SRC = /^share:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const DRIVE_SRC = /^drive:[A-Za-z0-9_-]{1,200}$/;
export async function photoKey(pageId, src, subtle = globalThis.crypto.subtle) {
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(`${pageId}:${src}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// [{key, id}] → 짝 페이지 blocks(없으면 빈 줄 []).
export function mirrorBlocks(entries) {
  const content = (Array.isArray(entries) ? entries : []).filter(e => e && KEY.test(e.key) && SHARE_SRC.test('share:' + e.id))
    .slice(0, MIRROR_MAX).map(e => ({type:'image', attrs:{src:'share:' + e.id, key:e.key}}));
  return content.length ? [{type:'doc', doc:{v:'ed1', doc:{type:'doc', content}}}] : [];
}
// 짝 페이지 blocks → Map(key → 사진 id). 모양이 다르면 빈 Map(새로 올린다).
export function readMirror(blocks) {
  const out = new Map();
  const inner = Array.isArray(blocks) && blocks.length === 1 && blocks[0]?.type === 'doc' ? blocks[0].doc?.doc : null;
  for (const n of Array.isArray(inner?.content) ? inner.content : []) {
    const m = n?.type === 'image' && typeof n.attrs?.src === 'string' ? SHARE_SRC.exec(n.attrs.src) : null;
    if (m && typeof n.attrs.key === 'string' && KEY.test(n.attrs.key)) out.set(n.attrs.key, m[1]);
  }
  return out;
}
// 노트 글(doc) 안 사진 칸 중 이 노트 첨부에 있는 drive: 사진 src(차례대로, 중복 없이, MIRROR_MAX장까지). 파일 칸·다른 src는 넣지 않는다.
export function notePhotoSrcs(note) {
  const own = new Set((Array.isArray(note?.attachments) ? note.attachments : []).map(f => f?.drive_file_id).filter(Boolean));
  const doc = note?.doc && note.doc.v === 'ed1' ? note.doc.doc : null, out = [];
  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > 40) return;
    for (const n of list) {
      if (out.length >= MIRROR_MAX) return;
      const src = n?.type === 'image' ? n.attrs?.src : null;
      if (typeof src === 'string' && DRIVE_SRC.test(src) && own.has(src.slice(6)) && !out.includes(src)) out.push(src);
      walk(n?.content, depth + 1);
    }
  };
  walk(doc?.content, 0);
  return out;
}
