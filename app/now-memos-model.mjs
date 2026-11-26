// S69-70(사용자 11/24 20:43 "읽을 거리 글에 남긴 메모를 저장하지 않았어도 모아 보기"): 읽을 거리 [메모] 탭(메모 있는 글)의 순수 계산.
// 글 메모 = 노트 한 개(metadata.news_item_id | metadata.outside_post_id, app/basket-data.js createNoteDoc). DOM·네트워크 없음 — now-memos.js가 이 결과대로 그린다.

// 한 번에 읽는 메모 노트 수(종류마다). 넘으면 [더 보기]로 이어 읽는다.
export const MEMO_PAGE = 1000;
// 메모 노트 칸(종류 → metadata 열쇠).
export const MEMO_KEY = Object.freeze({news: 'news_item_id', outside: 'outside_post_id'});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 노트 → 그 노트가 메모한 글 {type, id}(없으면 null). 뉴스 열쇠가 먼저(createNoteDoc도 둘 중 뉴스를 먼저 적는다).
export function memoTarget(note) {
  const m = plain(note?.metadata) ? note.metadata : null;
  if (!m) return null;
  for (const type of ['news', 'outside']) {
    const id = m[MEMO_KEY[type]];
    if (typeof id === 'string' && UUID.test(id)) return {type, id};
  }
  return null;
}

// 메모 첫 줄(빈 줄 건너뜀, 앞뒤 빈칸 정리, 80자까지). 글자가 없으면 노트 제목, 그것도 없으면 ''.
export function memoLine(note, max = 80) {
  const text = typeof note?.raw_text === 'string' ? note.raw_text : '';
  const line = text.split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).find(Boolean) || (typeof note?.title === 'string' ? note.title.replace(/\s+/g, ' ').trim() : '');
  const chars = [...line];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line;
}

// 한 쪽(종류 하나) 읽은 줄 → {rows: 이번 쪽 노트, end: 더 없음}. size+1줄을 물어 하나 더 오면 다음 쪽이 있다.
export function memoPage(rows, size = MEMO_PAGE) {
  const list = Array.isArray(rows) ? rows.filter(n => n && typeof n.id === 'string' && memoTarget(n)) : [];
  const more = Array.isArray(rows) && rows.length > size;
  return {rows: list.slice(0, size), end: !more};
}

// 메모 노트들 + 글 지도 → 그릴 줄. 같은 글에 메모가 여럿이면 최근 고친 것 하나(상세 [메모]가 여는 것과 같음 — feed-shared.js readMemoNote).
// idOf(type, id) = 공용 글 id(옛 id → 새 id), articleOf(type, publicId) = 글 줄(없으면 null — 그 글은 '메모만' 줄).
// 돌려줌 [{key, note, type, id(공용 id), row|null, at}] — 최근 고친 메모 먼저.
export function memoEntries(notes, {idOf = (t, id) => id, articleOf = () => null} = {}) {
  const seen = new Set(), out = [];
  const list = [...(notes || [])].filter(n => n && memoTarget(n)).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || String(a.id).localeCompare(String(b.id)));
  for (const note of list) {
    const t = memoTarget(note), id = idOf(t.type, t.id) || t.id, key = `${t.type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({key, note, type: t.type, id, row: articleOf(t.type, id) || null, at: note.updated_at || null});
  }
  return out;
}

// 위 찾기 칸 거르기: 글 제목·한국어 제목·메모 글자·노트 제목에서(띄어쓰기·대소문자 무시). 찾는 말이 없으면 모두.
const squash = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
export function memoHit(entry, query) {
  const needle = squash(query);
  if (!needle) return true;
  const r = entry?.row || {}, n = entry?.note || {}, m = entry?.memo || {};
  return [r.title, r.title_ko, n.raw_text, n.title, m.body, m.target_title].some(t => squash(t).includes(needle));
}

// S69-94 NOTE-메모통일: 새 메모 표(app_memos)의 글 메모(news·outside) → 같은 줄 모양. 같은 글에 메모가 여럿이면 가장 최근 것이 그 줄을 대표한다.
// articleOf(type, id) = 글 줄(없으면 null — 그 글은 '메모만' 줄). 돌려줌 [{key, memo, type, id, row|null, at}].
export function tableEntries(memos, {articleOf = () => null} = {}) {
  const by = new Map();
  for (const m of memos || []) {
    if (!m || !MEMO_KEY[m.target_type] || typeof m.target_id !== 'string') continue;
    const key = `${m.target_type}:${m.target_id}`, was = by.get(key);
    if (!was || String(m.created_at || '') > String(was.created_at || '')) by.set(key, m);
  }
  return [...by.entries()].map(([key, m]) => ({key, memo: m, type: m.target_type, id: m.target_id, row: articleOf(m.target_type, m.target_id) || null, at: m.created_at || null}));
}
// 옛 노트 메모 줄 + 새 메모 줄 → 글마다 한 줄(더 최근 것), 최근 먼저. 옛 노트 메모는 지우지 않으므로 같은 글이면 둘 중 최근 것이 보인다.
export function mergeEntries(oldEntries, newEntries) {
  const by = new Map();
  for (const e of [...(oldEntries || []), ...(newEntries || [])]) {
    const was = by.get(e.key);
    if (!was || String(e.at || '') > String(was.at || '')) by.set(e.key, was && !e.row && was.row ? {...e, row: was.row} : e);
  }
  return [...by.values()].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || String(a.key).localeCompare(String(b.key)));
}
// 줄 아래 메모 첫 줄: 새 메모면 그 글, 옛 노트 메모면 노트 글.
export const entryLine = e => (e?.memo ? memoLine({raw_text: e.memo.body}) : memoLine(e?.note));
