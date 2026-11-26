// S69-98 NOTE-에버노트 ⑦ 관련 노트(명진 11/25 "좋아 모두 다 넣어!"): 노트 읽기 화면 아래 한 칸 — 비슷한 노트(이미 읽은 노트 목록에서, 기기 밖으로
// 나가지 않음)와 자료(기존 전체 검색 RPC app_search_records, owner RLS, 대표 낱말 하나로 한 번 — 같은 노트는 이 로그인 동안 다시 묻지 않음).
// AI를 부르지 않는다. 접을 수 있는 <details>(기본 펼침, 펼침 여부는 이 화면 메모리에만). 줄을 누르면 그 노트·자료를 연다.
// 이 칸의 그리기 주인은 이 모듈 하나(paintRelated)다. 계산은 note-related-model.mjs.
import {relatedNotes, docQuery, docRows} from './note-related-model.mjs';
import {backlinks} from './note-link-model.mjs'; // S69-98 ⑧ '이 노트를 가리키는 노트' 한 줄도 이 칸이 그린다
import {searchRecords} from './global-search-data.js';
import {iconNode} from './tree-icons.js';
import {chevHtml} from './fold-chevron.mjs'; // 사이트 공용 접기 꺾쇠(열린 details면 저절로 뒤집힘)

const docCache = new Map(); // `${scope}|${noteId}` → Promise<rows>
let folded = false;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
function docsFor(note, scope) {
  const word = docQuery(note);
  if (!word) return Promise.resolve([]);
  const key = `${scope}|${note.id}|${word}`;
  if (!docCache.has(key)) docCache.set(key, searchRecords(word, {kind: 'document', per: 2}).then(r => docRows(r.groups, word)).catch(() => { docCache.delete(key); return []; }));
  return docCache.get(key);
}
export function resetRelated() { docCache.clear(); folded = false; }
globalThis.window?.addEventListener?.('kptu:session-changed', resetRelated);

/**
 * host: 노트 읽기 화면의 [data-note-related] 칸. note: 열린 노트. notes: 노트 목록(이미 읽은 것).
 * opts: {tagsOf, folderOf, hidden(note)=잠긴 노트, titleOf, scope, isCurrent(), openNote(id), openDocument(id)}
 */
// S71-54 topics: 이 노트를 재료로 둔 생각지도 주제(Promise<[{board, text, body}]>, 없으면 null) — '이어진 생각지도 주제' 한 줄(누르면 openTopic).
export function paintRelated(host, note, notes, {tagsOf, folderOf, hidden = () => false, titleOf, scope = '', isCurrent = () => true, openNote, openDocument, topics = null, openTopic} = {}) {
  if (!host) return;
  const rows = hidden(note) ? [] : relatedNotes(note, notes, {tagsOf, folderOf, hidden, titleOf});
  const back = hidden(note) ? [] : backlinks(note.id, notes, {hidden, titleOf});
  let tops = [], lastDocs = [];
  const draw = docs => {
    if (!isCurrent()) return;
    lastDocs = docs;
    const all = [...rows.map(r => ({...r, kind: 'note'})), ...docs.map(d => ({...d, kind: 'document'}))];
    if (!all.length && !back.length && !tops.length) { host.hidden = true; host.replaceChildren(); return; }
    // ⑧ 이 노트를 가리키는 노트: 한 줄(제목 단추들), 접지 않는다.
    const parts = [];
    if (tops.length) { // S71-54 이어진 생각지도 주제: 한 줄(주제 글 단추들), 누르면 그 보드의 그 주제로
      const line = el('p', 'note-linkedby note-topics'); line.dataset.noteTopics = '';
      line.append(el('span', 'note-linkedby-label', '이어진 생각지도 주제'));
      for (const t of tops) {
        const name = [...String(t.body || '').replace(/\s+/g, ' ').trim()].slice(0, 24).join('') || '주제';
        const btn = el('button', 'note-linkedby-link', name); btn.type = 'button'; btn.dataset.noteTopic = t.text; btn.dataset.noteTopicBoard = t.board;
        btn.addEventListener('click', () => openTopic?.(t));
        line.append(btn);
      }
      parts.push(line);
    }
    if (back.length) {
      const line = el('p', 'note-linkedby'); line.dataset.noteLinkedby = '';
      line.append(el('span', 'note-linkedby-label', '가리키는 노트'));
      for (const b of back) {
        const btn = el('button', 'note-linkedby-link', b.title); btn.type = 'button'; btn.dataset.noteLinkedbyId = b.id;
        btn.addEventListener('click', () => openNote?.(b.id));
        line.append(btn);
      }
      parts.push(line);
    }
    if (!all.length) { host.replaceChildren(...parts); host.hidden = false; return; }
    const box = el('details', 'note-rel'); box.open = !folded;
    box.addEventListener('toggle', () => { folded = !box.open; });
    const sum = el('summary', 'note-rel-sum'); sum.append(el('span', 'note-rel-title', '관련'), el('span', 'note-rel-count', String(all.length))); sum.insertAdjacentHTML('beforeend', chevHtml(false));
    const list = el('ul', 'note-rel-list');
    for (const r of all) {
      const li = el('li'), b = el('button', 'note-rel-row'); b.type = 'button';
      b.dataset.noteRel = r.kind; b.dataset.noteRelId = r.id;
      b.append(iconNode(r.kind === 'note' ? 'doc' : 'clip', {className: 'note-rel-ico'}), el('span', 'note-rel-name', r.title));
      if (r.why) b.append(el('small', 'note-rel-why', r.why));
      b.addEventListener('click', () => (r.kind === 'note' ? openNote : openDocument)?.(r.id));
      li.append(b); list.append(li);
    }
    box.append(sum, list);
    host.replaceChildren(...parts, box); host.hidden = false;
  };
  draw([]);
  if (hidden(note)) return;
  void docsFor(note, scope).then(docs => { if (docs.length) draw(docs); });
  if (topics) void Promise.resolve(topics).then(list => { if (Array.isArray(list) && list.length) { tops = list.slice(0, 20); draw(lastDocs); } }, () => {});
}
