// S69-98 NOTE-에버노트 ⑧ 노트 연결 [[ ]](사용자 11/25 "좋아 모두 다 넣어!", S69-96 제안 '@ 노트 연결'과 하나로): 순수 계산. DOM 없음(node --test).
// 데이터: 새 칸·새 표 없음. 연결은 노트 글(저장 모양 doc)의 보통 링크 하나다 — 글자 = 고른 노트 제목, 주소 = 이 앱의 그 노트 주소
// (`…/app/?view=basket&note=<id>`, 편집기 링크 규칙 safeHref(http·https)를 그대로 통과). 그래서 다른 화면·내보내기에서도 평범한 링크로 남고,
// 노트 화면은 그 주소를 알아보아 앱 안에서 그 노트를 연다. '이 노트를 가리키는 노트'는 읽어 둔 노트들의 doc 안 링크를 세어 얻는다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LINK_QUERY_MAX = 30, PICK_MAX = 8;

// 노트 주소: 앱 주소(예: https://work.bokdoong.com/app/)를 바탕으로. 바탕이 http·https가 아니면 ''.
export function noteLinkHref(id, base) {
  if (!UUID.test(String(id || ''))) return '';
  let url;
  try { url = new URL('./', base); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  url.search = ''; url.hash = '';
  url.searchParams.set('view', 'basket'); url.searchParams.set('note', String(id).toLowerCase());
  return url.href;
}
// 링크 주소가 노트 연결이면 그 노트 id, 아니면 ''. 앱 경로(/app/)·view=basket·note=uuid 셋이 다 맞아야 한다(다른 주소는 보통 링크).
export function noteLinkId(href) {
  let url;
  try { url = new URL(String(href || '')); } catch { return ''; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/\/app\/$/.test(url.pathname)) return '';
  const id = url.searchParams.get('note') || '';
  return url.searchParams.get('view') === 'basket' && UUID.test(id) ? id.toLowerCase() : '';
}
// 커서 앞 글자에서 '[[찾는말'(줄바꿈·괄호 없이 30자까지)을 찾는다 → {query, length} | null. length = '[[' 포함 지울 글자 수.
export function linkTyping(before) {
  const m = /\[\[([^\[\]\n]{0,30})$/u.exec(String(before ?? ''));
  return m ? {query: m[1], length: m[0].length} : null;
}
const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
// 고를 노트: 찾는말이 제목에 든 것(비면 최근 순), 자기 자신·숨긴 노트 제외, 최대 PICK_MAX. 제목으로 시작하는 것이 앞.
export function pickNotes(notes, query, {self = '', hidden = () => false, titleOf = n => n?.title || '', max = PICK_MAX} = {}) {
  const q = norm(query);
  return (Array.isArray(notes) ? notes : [])
    .filter(n => n?.id && n.id !== self && !hidden(n))
    .map(n => ({id: n.id, title: String(titleOf(n) || '제목 없음'), at: String(n.updated_at || ''), hit: norm(titleOf(n)).indexOf(q)}))
    .filter(x => !q || x.hit >= 0)
    .sort((a, b) => (q ? (a.hit === 0) === (b.hit === 0) ? 0 : a.hit === 0 ? -1 : 1 : 0) || b.at.localeCompare(a.at))
    .slice(0, max)
    .map(({id, title}) => ({id, title}));
}
// 저장 모양(doc)의 링크 주소들.
export function docHrefs(doc) {
  const out = [], root = doc && typeof doc === 'object' ? (doc.doc && typeof doc.doc === 'object' ? doc.doc : doc) : null;
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    for (const m of Array.isArray(node.marks) ? node.marks : []) if (m?.type === 'link' && typeof m.attrs?.href === 'string') out.push(m.attrs.href);
    for (const c of Array.isArray(node.content) ? node.content : []) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}
// 한 노트가 가리키는 노트 id들(겹침 없이).
export const linkedIds = note => [...new Set(docHrefs(note?.doc).map(noteLinkId).filter(Boolean))];
// 이 노트를 가리키는 노트: [{id, title}] — 자기 자신·숨긴 노트 제외, 최근 순.
export function backlinks(id, notes, {hidden = () => false, titleOf = n => n?.title || ''} = {}) {
  const key = String(id || '').toLowerCase();
  if (!key) return [];
  return (Array.isArray(notes) ? notes : [])
    .filter(n => n?.id && n.id !== id && !hidden(n) && linkedIds(n).includes(key))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .map(n => ({id: n.id, title: String(titleOf(n) || '제목 없음')}));
}
