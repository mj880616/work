// OUTSIDE-글상세·관심환류 ③④(설계 docs/design/outside-statements.md 12절, news-clipping.md 13절): Now 화면의 순수 계산.
// DOM·네트워크 없음. 화면 쪽(outside-statements.js = Now 껍데기, now-detail.js, now-saved.js, now-interests.js)이 이 결과대로 그리기만 한다.

// 탭 넷(S51-8 NEWS-전면개편 P4b, 시안 news-overhaul.html): [전체][사회운동][언론][보관]. 저장 값은 view_prefs.news_tab(DB 20261106080000) — 이름이 그대로 DB 검사 값이다.
// 옛 [뉴스] 탭은 [언론]으로(메뉴 이름과 겹치지 않게), [문장 찾기] 탭은 위 찾기 칸으로 합쳐 없어졌다.
export const NOW_TABS = Object.freeze([
  {id: 'all', label: '전체'},
  {id: 'movement', label: '사회운동'},
  {id: 'media', label: '언론'},
  {id: 'archive', label: '보관'},
]);
export const NOW_TAB_IDS = Object.freeze(NOW_TABS.map(t => t.id));
export const DEFAULT_NOW_TAB = 'all';
export const keepNowTab = tab => (NOW_TAB_IDS.includes(tab) ? tab : DEFAULT_NOW_TAB);
// 옛 now_tab(outside·news·saved·search) → 새 news_tab. news_tab이 없을 때 한 번만 쓴다(설계 7.3, 옛 값은 지우지 않음).
const OLD_TAB = Object.freeze({outside: 'movement', news: 'media', saved: 'archive', search: 'all'});
export function startTab(newsTab, oldTab) {
  if (NOW_TAB_IDS.includes(newsTab)) return {tab: newsTab, migrate: false};
  if (Object.hasOwn(OLD_TAB, oldTab)) return {tab: OLD_TAB[oldTab], migrate: true};
  return {tab: DEFAULT_NOW_TAB, migrate: false};
}
// 좌우 밀기·←→: 끝에서 멈춘다(돌지 않음). 못 가면 null.
export function nowTabAt(tab, step) {
  const i = NOW_TAB_IDS.indexOf(keepNowTab(tab)) + step;
  return i >= 0 && i < NOW_TAB_IDS.length ? NOW_TAB_IDS[i] : null;
}
// 위 찾기 칸의 제목 거르기(화면 목록에서): 띄어쓰기·대소문자 무시, 찾는 말이 없으면 모두 통과.
const squash = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
export function titleHit(texts, query) {
  const needle = squash(query);
  if (!needle) return true;
  return (Array.isArray(texts) ? texts : [texts]).some(t => squash(t).includes(needle));
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
export const RELATED_LABEL = Object.freeze({outside: '사회운동', news: '언론', update: '업데이트', ledger: '원장', library: '자료실'});
// '함께 볼 것'을 누르면 갈 곳: 같은 Now 안의 글은 상세로, 내 기록은 그 화면으로(라우터 이름).
export const relatedTarget = r => (r.kind === 'outside' || r.kind === 'news' ? {detail: {type: r.kind, id: r.id}} : {view: {update: 'home', ledger: 'ledger', library: 'library'}[r.kind]});
// 뉴스 기사 읽기(S48-66): 본문·요약이 없는 줄은 상세 전에 먼저 읽는다. 읽고도 재료가 없으면 AI를 부르지 않는다.
const REASONS = {robots: '이 사이트가 읽기를 막아 둠', paywall: '유료 기사', bot_check: '사이트가 자동 읽기를 막음', original_only: '원문에서 보는 기사', daily_limit: '오늘 읽기 한도를 다 씀', error: '잠시 뒤 다시', unavailable: '기사를 열 수 없음'};
export const hasMaterial = row => !!(row?.summary || row?.body_kind);
export const needsRead = row => !hasMaterial(row) && row?.state !== 'paywall';
export const unreadReason = (status, state) => REASONS[status] || REASONS[state] || '본문을 찾지 못함';
// ---- 상세 원문 전체(S51-14 NEWS-전면개편 P4c, 설계 docs/design/news-overhaul.md 4.1·4.3·6.2절) ----
// 저장 원문(app_feed_bodies 한 줄) → 그릴 모양. 블록은 글자·주소로만 그린다(HTML 없음). 사진 주소는 https만, 모양이 틀린 블록은 버린다.
export const BODY_REASONS = Object.freeze({
  robots: '사이트가 자동 읽기를 막아 둠', bot_check: '사이트가 자동 읽기를 막아 둠', paywall: '유료 기사라 앞부분만',
  too_big: '글이 너무 커서 다 읽지 못함', timeout: '사이트가 늦게 답해 읽지 못함', http_4xx: '사이트에서 글을 찾지 못함',
  http_5xx: '사이트 오류로 읽지 못함', no_body: '본문 칸을 찾지 못함', off_host: '다른 사이트로 이어지는 글', relay: '검색 중계 주소라 원문을 받지 못함',
});
const BODY_STATES = new Set(['ok', 'lead', 'image_only', 'failed']);
const BLOCK_MAX = 400, IMG_MAX = 20;
export function httpsUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return '';
  try { const u = new URL(v); return u.protocol === 'https:' && u.hostname ? u.href : ''; } catch { return ''; }
}
export function cleanBlocks(blocks) {
  const out = [];
  let imgs = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (out.length >= BLOCK_MAX) break;
    if (!b || typeof b !== 'object') continue;
    if (b.t === 'img') {
      const src = httpsUrl(b.src);
      if (!src || imgs >= IMG_MAX) continue;
      imgs++;
      out.push({t: 'img', src, cap: str(b.cap).slice(0, 300), alt: str(b.alt).slice(0, 300)});
    } else if (b.t === 'p' || b.t === 'h' || b.t === 'quote') {
      const text = str(b.text);
      if (text) out.push({t: b.t, text});
    }
  }
  return out;
}
// row: {blocks, state, reason} | null. 답: {state, blocks, reason(한 줄 글자, 없으면 '')}.
export function bodyView(row) {
  if (!row || !BODY_STATES.has(row.state)) return null;
  const blocks = row.state === 'failed' ? [] : cleanBlocks(row.blocks);
  const why = BODY_REASONS[row.reason] || '';
  if (row.state === 'ok') return blocks.length ? {state: 'ok', blocks, reason: ''} : {state: 'failed', blocks, reason: BODY_REASONS.no_body};
  if (row.state === 'lead') return {state: 'lead', blocks, reason: why || '공개된 앞부분만'};
  if (row.state === 'image_only') return {state: 'image_only', blocks, reason: '그림·첨부만 있는 글'};
  return {state: 'failed', blocks: [], reason: why || '본문을 읽지 못함'};
}
// 저장 원문 줄이 잠깐의 오류(늦은 답·사이트 오류)로 실패한 뉴스 기사만 누를 때 한 번 다시 읽는다(S51-17 P5, 설계 7.1). 막힘·없는 글·유료는 다시 읽지 않는다.
const REOPEN_REASONS = new Set(['timeout', 'http_5xx']);
export const reopenBody = row => row?.state === 'failed' && REOPEN_REASONS.has(row?.reason);
// 저장 원문이 아예 없는 옛 글: 예전 저장 글자(사회운동 문장·뉴스 body)를 문단 블록으로.
export function legacyBody(text, {lead = false} = {}) {
  const blocks = String(text ?? '').split(/\n+/).map(t => t.trim()).filter(Boolean).slice(0, BLOCK_MAX).map(text => ({t: 'p', text}));
  if (!blocks.length) return {state: 'failed', blocks: [], reason: '본문을 읽지 못함'};
  return lead ? {state: 'lead', blocks, reason: '공개된 앞부분만'} : {state: 'ok', blocks, reason: ''};
}
// 글자 크기 세 단계(서버 view_prefs.news_font, 없으면 보통).
export const NEWS_FONT_STEPS = Object.freeze([{id: 's', label: '글자 작게'}, {id: 'm', label: '글자 보통'}, {id: 'l', label: '글자 크게'}]);
export const keepNewsFont = v => (NEWS_FONT_STEPS.some(f => f.id === v) ? v : 'm');
// S52-12 NEWS-원문먼저번역(시안 docs/design/mockups/news-detail-translate.html): 원문 칸 [번역].
// 번역은 뉴스 기사(app_news_items)만 서버에 저장 길이 있다(news-feed translate → body_ko). 외국어 글에만 단추를 둔다.
export const canTranslate = (item, head) => item?.type === 'news' && !!head?.lang && head.lang !== 'ko';
// 서버 본문 번역 body_ko는 기사 body(글자 블록 p·h·quote를 한 줄씩 이은 것)를 줄 순서대로 옮긴 것이다.
// 그 줄을 같은 순서의 글자 블록에 하나씩 넣어 문단·소제목·인용·사진·캡션 자리는 그대로 두고 글만 바꾼다.
// 줄 수가 맞지 않으면(옛 번역이 문단을 합침 등) 번역 문단만 차례로 보이고 사진은 아래에 모은다(aligned:false).
export const TRANSLATE_REST_MARK = '(이후 부분은 원문만 있음)';
const lines = v => String(v ?? '').split(/\n+/).map(t => t.trim()).filter(Boolean);
export function translatedBlocks(blocks, body, bodyKo) {
  const ko = lines(bodyKo);
  const partial = ko.length > 0 && ko[ko.length - 1] === TRANSLATE_REST_MARK;
  if (partial) ko.pop();
  if (!ko.length) return null;
  const list = Array.isArray(blocks) ? blocks : [];
  const textAt = list.map((b, i) => (b && (b.t === 'p' || b.t === 'h' || b.t === 'quote') ? i : -1)).filter(i => i >= 0);
  const src = lines(body);
  const fits = textAt.length > 0 && ko.length <= textAt.length && (partial || ko.length === src.length || ko.length === textAt.length);
  if (fits) {
    const out = list.map(b => ({...b}));
    ko.forEach((text, n) => { out[textAt[n]].text = text; });
    return {blocks: out, aligned: true, partial: partial || ko.length < textAt.length};
  }
  return {blocks: [...ko.map(text => ({t: 'p', text})), ...list.filter(b => b?.t === 'img').map(b => ({...b}))], aligned: false, partial};
}
// [번역] 실패 한 줄(서버 오류 코드 → 일상어).
export function translateError(e) {
  const code = String(e?.message || '').toUpperCase();
  if (code.includes('MONTHLY_LIMIT')) return '이번 달 번역 한도를 다 씀';
  if (e?.status === 429 || code.includes('DAILY_LIMIT')) return '오늘 번역을 다 씀 · 내일 다시';
  if (code.includes('NOT_FOREIGN')) return '한글 글이라 번역하지 않아요';
  if (code.includes('NOTHING_TO_TRANSLATE')) return '번역할 본문이 없어요';
  if (e?.status === 404) return '글을 찾지 못함';
  return e?.status ? `번역하지 못함 · HTTP ${e.status}` : '번역하지 못함 · 잠시 뒤 다시';
}
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
  {id: 'news', label: '언론'},
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

// ---- [매체: 전체 ▾](S51-8 NEWS-전면개편 P4b, 설계 6.1): 자료실 분류 창과 같은 부품(library-move-picker.js)에 넣을 줄과 거르기 ----
// 고른 값: 'all' | 'g:<사회운동 묶음>' | 's:<단체 키>' | 'r:<언론 지역 domestic|foreign>' | 'n:<news- 매체 키>'. 화면 메모리만(저장하지 않음).
// 입력: oc = 사회운동 카탈로그 [{key,name,group}], on = 켠 단체 키, nc = 뉴스 카탈로그 [{key,name,region}], non = 켠 news- 키.
export const MEDIA_ALL = 'all';
export const OUTSIDE_GROUP_LABEL = Object.freeze({labor: '노동', party: '정당', movement: '사회운동', foreign: '외국'});
export const PRESS_REGION_LABEL = Object.freeze({domestic: '언론 국내', foreign: '언론 외국'});
const OUTSIDE_GROUPS = Object.freeze(['labor', 'party', 'movement', 'foreign']);
const PRESS_REGIONS = Object.freeze(['domestic', 'foreign']);
const side = pick => (pick === MEDIA_ALL ? 'all' : /^[gs]:/.test(pick || '') ? 'outside' : /^[rn]:/.test(pick || '') ? 'news' : '');
// 이 탭에서 쓸 수 있는 고른 값인가. [보관]은 거르지 않는다.
export function mediaFits(tab, pick) {
  const s = side(pick);
  if (!s) return false;
  if (s === 'all') return true;
  if (tab === 'movement') return s === 'outside';
  if (tab === 'media') return s === 'news';
  return tab === 'all';
}
export const keepMedia = (tab, pick) => (mediaFits(tab, pick) ? pick : MEDIA_ALL);
// 창에 넣을 줄: 전체 → 묶음(깊이 0) → 매체(깊이 1). 켠 매체만. 찾는 말이 있으면 이름에 든 것만 납작하게.
export function mediaRows({tab, oc = [], on = [], nc = [], non = [], pick = MEDIA_ALL, query = '', dot = () => ''}) {
  const onSet = new Set(on || []), nonSet = new Set(non || []);
  const rows = [{id: MEDIA_ALL, name: '전체', label: '전체', depth: 0}];
  if (tab !== 'media') {
    for (const g of OUTSIDE_GROUPS) {
      const members = (oc || []).filter(s => s?.group === g && onSet.has(s.key));
      if (!members.length) continue;
      rows.push({id: 'g:' + g, name: OUTSIDE_GROUP_LABEL[g], label: OUTSIDE_GROUP_LABEL[g], depth: 0, dot: dot('g', g)});
      for (const s of members) rows.push({id: 's:' + s.key, name: s.name, label: `${OUTSIDE_GROUP_LABEL[g]} › ${s.name}`, depth: 1, dot: dot('s', s.key)});
    }
  }
  if (tab !== 'movement') {
    for (const r of PRESS_REGIONS) {
      const members = (nc || []).filter(s => s?.region === r && nonSet.has(s.key));
      if (!members.length) continue;
      rows.push({id: 'r:' + r, name: PRESS_REGION_LABEL[r], label: PRESS_REGION_LABEL[r], depth: 0, dot: dot('r', r)});
      for (const s of members) rows.push({id: 'n:' + s.key, name: s.name, label: `${PRESS_REGION_LABEL[r]} › ${s.name}`, depth: 1, dot: dot('n', s.key)});
    }
  }
  const q = String(query || '').replace(/\s+/g, '').toLowerCase();
  const out = rows.map(r => ({...r, enabled: true, current: r.id === pick}));
  if (!q) return {recent: [], all: out, total: out.length};
  return {recent: [], all: out.filter(r => r.label.replace(/\s+/g, '').toLowerCase().includes(q)).map(r => ({...r, depth: 0})), total: out.length};
}
// 단추 글자 '매체: 전체 ▾'의 이름 부분.
export function mediaName(pick, {oc = [], nc = []} = {}) {
  if (!pick || pick === MEDIA_ALL) return '전체';
  const id = pick.slice(2);
  if (pick.startsWith('g:')) return OUTSIDE_GROUP_LABEL[id] || '전체';
  if (pick.startsWith('r:')) return PRESS_REGION_LABEL[id] || '전체';
  if (pick.startsWith('s:')) return (oc || []).find(s => s?.key === id)?.name || id;
  if (pick.startsWith('n:')) return (nc || []).find(s => s?.key === id)?.name || id;
  return '전체';
}
// 사회운동 글 거르기: null = 거르지 않음, [] = 하나도 없음(언론 매체를 고름), [키…] = 그 단체만.
export function outsideKeysOf(pick, oc = [], on = []) {
  if (!pick || pick === MEDIA_ALL) return null;
  const onSet = new Set(on || []);
  if (pick.startsWith('s:')) return [pick.slice(2)];
  if (pick.startsWith('g:')) return (oc || []).filter(s => s?.group === pick.slice(2) && onSet.has(s.key)).map(s => s.key);
  return [];
}
// 언론 기사 거르기: null = 거르지 않음, [] = 하나도 없음(사회운동 단체를 고름), [news- 키…] = 그 매체만.
export function newsKeysOf(pick, nc = []) {
  if (!pick || pick === MEDIA_ALL) return null;
  if (pick.startsWith('n:')) return [pick.slice(2)];
  if (pick.startsWith('r:')) return (nc || []).filter(s => s?.region === pick.slice(2)).map(s => s.key);
  return [];
}
// [전체] 탭: 사회운동 글 + 언론 기사를 시각 최신 순으로 한 줄에. 시각 모르는 글은 맨 뒤. at = ISO 글자.
export function mergeFeed(posts = [], news = []) {
  const list = [...(posts || []).map(row => ({type: 'outside', id: row.id, at: row.at, row: row.row})), ...(news || []).map(row => ({type: 'news', id: row.id, at: row.at, row: row.row}))];
  return list.sort((a, b) => (a.at && b.at ? String(b.at).localeCompare(String(a.at)) : a.at ? -1 : b.at ? 1 : 0) || String(a.id).localeCompare(String(b.id)));
}
