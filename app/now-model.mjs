// OUTSIDE-글상세·관심환류 ③④(설계 docs/design/outside-statements.md 12절, news-clipping.md 13절): Now 화면의 순수 계산.
// DOM·네트워크 없음. 화면 쪽(outside-statements.js = Now 껍데기, now-detail.js, now-saved.js, now-interests.js)이 이 결과대로 그리기만 한다.

// 탭 넷(23:16 결정 ①). 저장 값은 view_prefs.now_tab(DB 20261102141000) — 이름이 그대로 DB 검사 값이다.
export const NOW_TABS = Object.freeze([
  {id: 'outside', label: '사회운동'},
  {id: 'news', label: '뉴스'},
  {id: 'saved', label: '보관'},
  {id: 'search', label: '문장 찾기'},
]);
export const NOW_TAB_IDS = Object.freeze(NOW_TABS.map(t => t.id));
export const DEFAULT_NOW_TAB = 'outside';
export const keepNowTab = tab => (NOW_TAB_IDS.includes(tab) ? tab : DEFAULT_NOW_TAB);
// 좌우 밀기·←→: 끝에서 멈춘다(돌지 않음). 못 가면 null.
export function nowTabAt(tab, step) {
  const i = NOW_TAB_IDS.indexOf(keepNowTab(tab)) + step;
  return i >= 0 && i < NOW_TAB_IDS.length ? NOW_TAB_IDS[i] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
// 글 하나 = {type:'outside'|'news', id}. 서버 요청 몸통(ai-assist now_detail)·환류 기록 칸 이름도 여기서 정한다.
export const itemKey = item => `${item?.type}:${item?.id}`;
export const detailBody = item => (item?.type === 'news' ? {kind: 'now_detail', news_item_id: item.id} : {kind: 'now_detail', outside_post_id: item.id});
export const signalBody = (workspaceId, item, action) => ({workspace_id: workspaceId, [item.type === 'news' ? 'news_item_id' : 'outside_post_id']: item.id, action});
export const SIGNAL_ACTIONS = Object.freeze(['star', 'unstar', 'archive', 'unarchive', 'memo', 'dismiss', 'undismiss', 'open']);

// ---- 관심 주제(12.6) ----
export const TOPIC_MAX = 30;
// 화면이 넣거나 고치는 주제 이름: 앞뒤 공백 빼고 1~30자, 줄바꿈·제어 문자 없음(DB 검사와 같은 규칙).
export function cleanTopic(raw, have = []) {
  const topic = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!topic) return {ok: false, reason: '주제를 써 주세요'};
  if ([...topic].length > TOPIC_MAX) return {ok: false, reason: `주제는 ${TOPIC_MAX}자까지`};
  if (/[\p{Cc}]/u.test(topic)) return {ok: false, reason: '쓸 수 없는 글자가 있어요'};
  const key = topic.replace(/\s+/g, '').toLowerCase();
  if (have.some(t => String(t).replace(/\s+/g, '').toLowerCase() === key)) return {ok: false, reason: '이미 있음'};
  return {ok: true, topic};
}
export const confirmedTopics = rows => (rows || []).filter(r => r && r.state === 'confirmed' && typeof r.topic === 'string').map(r => r.topic);
export const candidateRows = rows => (rows || []).filter(r => r && r.state === 'candidate' && typeof r.topic === 'string');
// 목록 줄 끝 작은 표시(12.2 결정 ②): 확정 관심 주제 중 제목·요약에 그 낱말이 든 첫 주제 하나. 띄어쓰기·대소문자는 무시.
export function interestHit(texts, topics) {
  const hay = (Array.isArray(texts) ? texts : [texts]).filter(t => typeof t === 'string').join(' ').replace(/\s+/g, '').toLowerCase();
  if (!hay) return '';
  for (const topic of topics || []) {
    const needle = String(topic || '').replace(/\s+/g, '').toLowerCase();
    if (needle.length >= 2 && hay.includes(needle)) return topic;
  }
  return '';
}

// ---- 상세(12.4) ----
const str = v => (typeof v === 'string' ? v.trim() : '');
// 서버 답(ai-assist now_detail의 detail) → 그릴 모양. 모양이 틀린 칸은 버린다(바깥 글자는 화면이 esc로만 그린다).
export function detailView(detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const sentences = (Array.isArray(d.key_sentences) ? d.key_sentences : [])
    .map(s => ({orig: str(s?.orig), ko: str(s?.ko)})).filter(s => s.orig).slice(0, 3);
  const rel = d.relevance && typeof d.relevance === 'object' ? d.relevance : null;
  const topics = rel && Array.isArray(rel.topics) ? rel.topics.map(str).filter(Boolean).slice(0, 5) : [];
  const imp = d.implications && typeof d.implications === 'object' ? d.implications : null;
  const related = (Array.isArray(d.related) ? d.related : [])
    .filter(r => r && ['outside', 'news', 'update', 'ledger', 'library'].includes(r.kind) && str(r.id) && str(r.title))
    .slice(0, 8).map(r => ({kind: r.kind, id: str(r.id), title: str(r.title)}));
  return {
    level: d.level === 'basic' ? 'basic' : 'full',
    summary: str(d.summary),
    sentences,
    relevance: topics.length || str(rel?.reason) ? {topics, reason: str(rel?.reason)} : null,
    implications: imp && (str(imp.kptu) || str(imp.labor)) ? {kptu: str(imp.kptu), labor: str(imp.labor)} : null,
    related,
  };
}
export const RELATED_LABEL = Object.freeze({outside: '사회운동', news: '뉴스', update: '업데이트', ledger: '원장', library: '자료실'});
// '함께 볼 것'을 누르면 갈 곳: 같은 Now 안의 글은 상세로, 내 기록은 그 화면으로(라우터 이름).
export const relatedTarget = r => (r.kind === 'outside' || r.kind === 'news' ? {detail: {type: r.kind, id: r.id}} : {view: {update: 'home', ledger: 'ledger', library: 'library'}[r.kind]});
// 뉴스 기사 읽기(S48-66): 본문·요약이 없는 줄은 상세 전에 먼저 읽는다. 읽고도 재료가 없으면 AI를 부르지 않는다.
const REASONS = {robots: '이 사이트가 읽기를 막아 둠', paywall: '유료 기사', bot_check: '사이트가 자동 읽기를 막음', original_only: '원문에서 보는 기사', daily_limit: '오늘 읽기 한도를 다 씀', error: '잠시 뒤 다시', unavailable: '기사를 열 수 없음'};
export const hasMaterial = row => !!(row?.summary || row?.body_kind);
export const needsRead = row => !hasMaterial(row) && row?.state !== 'paywall';
export const unreadReason = (status, state) => REASONS[status] || REASONS[state] || '본문을 찾지 못함';
// 상세가 실패했을 때 한 줄.
export function detailError(e) {
  const code = String(e?.message || '');
  if (code.includes('monthly_limit')) return '이번 달 AI 한도를 다 씀';
  if (e?.status === 429 || code.includes('daily_limit')) return '오늘 상세 만들기를 다 씀 · 내일 다시';
  if (e?.status === 404) return '글을 찾지 못함';
  return e?.status ? `상세를 만들지 못함 · HTTP ${e.status}` : '상세를 만들지 못함 · 잠시 뒤 다시';
}

// ---- [보관] 탭(12.1): 사회운동 글 표시(app_outside_marks) + 뉴스 별표(app_news_items.starred_at)를 한 목록으로 ----
export const SAVED_CHIPS = Object.freeze([
  {id: 'all', label: '전체'},
  {id: 'star', label: '별표'},
  {id: 'archive', label: '보관'},
  {id: 'outside', label: '사회운동'},
  {id: 'news', label: '뉴스'},
]);
export const keepSavedChip = chip => (SAVED_CHIPS.some(c => c.id === chip) ? chip : 'all');
// marks: [{post_id, starred_at, archived_at, app_outside_posts:{...}}], news: [{id, starred_at, folder_id, ...}]
// → [{type, id, at, star, archive, row}] 최근 표시 순. 뉴스 '보관'은 별표 폴더에 넣은 것.
export function savedRows(marks, news) {
  const out = [];
  for (const m of marks || []) {
    const post = m?.app_outside_posts;
    if (!post || !isUuid(m.post_id) || (!m.starred_at && !m.archived_at)) continue;
    out.push({type: 'outside', id: m.post_id, at: m.starred_at && m.archived_at ? (m.starred_at > m.archived_at ? m.starred_at : m.archived_at) : m.starred_at || m.archived_at, star: !!m.starred_at, archive: !!m.archived_at, row: post});
  }
  for (const it of news || []) {
    if (!it || !isUuid(it.id) || !it.starred_at) continue;
    out.push({type: 'news', id: it.id, at: it.starred_at, star: true, archive: isUuid(it.folder_id), row: it});
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id));
}
export function filterSaved(rows, chip) {
  switch (keepSavedChip(chip)) {
    case 'star': return rows.filter(r => r.star);
    case 'archive': return rows.filter(r => r.archive);
    case 'outside': return rows.filter(r => r.type === 'outside');
    case 'news': return rows.filter(r => r.type === 'news');
    default: return rows;
  }
}

// 상세 꼬리 줄 날짜: 서울 'YYYY. M. D. HH:MM'(시각 00:00이면 날짜만). 모르면 ''.
export function dateText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600000);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.${hm === '00:00' ? '' : ` ${hm}`}`;
}
