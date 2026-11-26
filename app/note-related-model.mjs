// S69-98 NOTE-에버노트 ⑦ 관련 노트(사용자 11/25 "좋아 모두 다 넣어!"): 열린 노트 아래 비슷한 노트·자료 3~4개를 고르는 순수 계산.
// DOM·네트워크 없음(node --test). AI를 부르지 않는다: 제목·태그·폴더·글자 겹침만 센다. 자료는 화면(note-related.js)이 기존 전체 검색
// RPC(app_search_records, owner RLS)에 이 노트의 대표 낱말 하나로 묻는다(docQuery).
export const REL_MAX = 4, DOC_MAX = 2, MIN_SCORE = 4;
const STOP = new Set(['그리고', '그래서', '하지만', '그러나', '또는', '이것', '저것', '그것', '여기', '거기', '오늘', '내일', '어제', '이번', '다음', '지난',
  '있다', '없다', '했다', '한다', '하는', '하고', '해서', '했고', '위해', '대한', '관련', '통해', '정도', '부분', '경우', '때문', '노트', '메모', '사진',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'https', 'http', 'www', 'com']);
const TAIL = /(으로|에서|에게|까지|부터|처럼|보다|이랑|하고|이나|은|는|이|가|을|를|에|의|로|와|과|도|만|나)$/u;
// 낱말 목록(소문자, 2자 이상, 숫자만인 것·주소 조각 제외, 한글 뒤 조사 한 번 떼기).
export function words(text) {
  const out = [];
  for (const m of String(text ?? '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').matchAll(/[\p{L}\p{N}]{2,}/gu)) {
    let w = m[0];
    if (/^\d+$/.test(w)) continue;
    if (/[가-힣]$/.test(w) && w.length > 2) w = w.replace(TAIL, '');
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}
// 노트의 대표 낱말: 제목 낱말은 3점, 본문은 나온 횟수(최대 3). 많은 순 12개 → Map(낱말 → 무게).
export function keywords(note, {limit = 12} = {}) {
  const score = new Map();
  for (const w of words(String(note?.raw_text ?? '').slice(0, 20000))) score.set(w, Math.min(3, (score.get(w) || 0) + 1));
  for (const w of words(note?.title)) score.set(w, (score.get(w) || 0) + 3);
  return new Map([...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}
const tagKeys = (tags) => new Set((Array.isArray(tags) ? tags : []).map(t => String(t?.key ?? t ?? '').toLowerCase()).filter(Boolean));
// 두 노트의 점수와 까닭 한 줄. 같은 폴더만으로는 관련이 아니다(태그·낱말이 하나는 겹쳐야 함).
export function relation(a, b, {tagsOf = () => [], folderOf = () => null, kwA = keywords(a)} = {}) {
  const ta = tagKeys(tagsOf(a)), tb = tagKeys(tagsOf(b)), shared = [...ta].filter(t => tb.has(t));
  const kwB = keywords(b), both = [...kwA.keys()].filter(w => kwB.has(w));
  if (!shared.length && !both.length) return {score: 0, why: ''};
  const fa = folderOf(a), fb = folderOf(b), same = !!fa && fa === fb;
  const score = shared.length * 4 + both.reduce((s, w) => s + Math.min(kwA.get(w), kwB.get(w)), 0) + (same ? 2 : 0);
  const why = shared.length ? '#' + shared[0] : both.length ? both.slice(0, 2).join(' · ') : '';
  return {score, why: same && !shared.length && both.length < 2 ? (why ? why + ' · 같은 폴더' : '같은 폴더') : why};
}
// 관련 노트: 자기 자신·숨긴(잠긴) 노트·가족 노트를 빼고 점수 높은 순 limit개 → [{id, title, why, score}].
export function relatedNotes(note, notes, {tagsOf, folderOf, hidden = () => false, limit = REL_MAX, titleOf = n => n?.title || ''} = {}) {
  if (!note?.id || !Array.isArray(notes) || hidden(note)) return [];
  const kwA = keywords(note);
  const family = n => n?.metadata?.family_list === true || n?.metadata?.family_past === true;
  return notes
    .filter(n => n && n.id !== note.id && !hidden(n) && !family(n))
    .map(n => ({n, r: relation(note, n, {tagsOf, folderOf, kwA})}))
    .filter(x => x.r.score >= MIN_SCORE)
    .sort((x, y) => y.r.score - x.r.score || String(y.n.updated_at || '').localeCompare(String(x.n.updated_at || '')))
    .slice(0, limit)
    .map(x => ({id: x.n.id, title: titleOf(x.n) || '제목 없음', why: x.r.why, score: x.r.score}));
}
// 자료를 찾을 낱말 하나(대표 낱말 중 가장 무거운 것, 2~30자). 없으면 ''.
export function docQuery(note) {
  for (const [w] of keywords(note)) if (w.length >= 2 && w.length <= 30) return w;
  return '';
}
// 검색 답(cleanServer 모양) → 자료 줄 [{id, title, why}] DOC_MAX개.
export function docRows(groups, word, max = DOC_MAX) {
  const g = groups instanceof Map ? groups.get('document') : (Array.isArray(groups) ? groups : []).find(x => x?.kind === 'document');
  return (g?.items || []).filter(it => it?.id && it.source === 'document').slice(0, max).map(it => ({id: it.id, title: String(it.title || '자료'), why: word}));
}
