import {AI_CAP_TEXT, aiCapText, isAiCap} from './ai-cap.mjs';
import {sortByName} from './name-order.mjs';
// OUTSIDE-글상세·관심환류 ③④(설계 docs/design/outside-statements.md 12절, news-clipping.md 13절): Now 화면의 순수 계산.
// DOM·네트워크 없음. 화면 쪽(outside-statements.js = Now 껍데기, now-detail.js, now-interests.js)이 이 결과대로 그리기만 한다.

// 탭(S51-8 NEWS-전면개편 P4b, 시안 news-overhaul.html): [전체][사회운동][언론][밑줄]. 저장 값은 view_prefs.news_tab(DB 20261106080000) — 이름이 그대로 DB 검사 값이다.
// 옛 [뉴스] 탭은 [언론]으로(메뉴 이름과 겹치지 않게), [문장 찾기] 탭은 위 찾기 칸으로 합쳐 없어졌다.
// S68-24(명진 11/22 "2. A"): [보관] 탭은 없앴다 — 보관한 글은 '읽을 거리' 한 목록에서 본다(reading.js [News] 칩). 탭 줄 끝 '보관 ↗'은 그리로 가는 길.
// DB 검사 값 'archive'는 그대로 두되(DB 바꾸지 않음) 그 값이 기억돼 있으면 [전체]로 연다(startTab).
export const NOW_TABS = Object.freeze([
  {id: 'all', label: '전체'},
  {id: 'movement', label: '사회운동'},
  {id: 'media', label: '언론'},
  // S53-5 NEWS-밑줄모으기: [밑줄](app_news_highlights 모아보기). 마지막 탭 기억(news_tab)의 DB 검사 값에는 아직 없어 이 탭은 기억하지 않는다(SAVED_TAB_IDS).
  {id: 'marks', label: '밑줄'},
]);
export const NOW_TAB_IDS = Object.freeze(NOW_TABS.map(t => t.id));
export const SAVED_TAB_IDS = Object.freeze(['all', 'movement', 'media']);
export const DEFAULT_NOW_TAB = 'all';
export const keepNowTab = tab => (NOW_TAB_IDS.includes(tab) ? tab : DEFAULT_NOW_TAB);
// 옛 now_tab(outside·news·saved·search) → 새 news_tab. news_tab이 없을 때 한 번만 쓴다(설계 7.3, 옛 값은 지우지 않음).
const OLD_TAB = Object.freeze({outside: 'movement', news: 'media', saved: 'all', search: 'all'});
export function startTab(newsTab, oldTab) {
  if (newsTab === 'archive') return {tab: DEFAULT_NOW_TAB, migrate: false}; // 없앤 [보관] 탭을 기억한 사람
  if (SAVED_TAB_IDS.includes(newsTab)) return {tab: newsTab, migrate: false};
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
// S63-11: 기사 줄이 아직 '읽기 전'(서버가 원문을 한 번도 읽지 않아 제목이 비었을 수 있음) — 본문이 따로 저장돼 있어도 열기를 한 번 부른다.
export const titlePending = row => row?.state === 'pending';
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
// 저장 원문 줄이 잠깐의 오류(늦은 답·사이트 오류)로 실패한 뉴스 기사만 누를 때 한 번 다시 읽는다(S51-17 P5, 설계 7.1). 봇 확인·없는 글·유료는 다시 읽지 않는다.
// S68-25(명진 결정 2026-11-22): 원문 읽기는 이제 robots.txt를 보지 않으므로, 예전에 robots 때문에 비어 있던 뉴스 기사도 열 때 한 번 읽어 온다.
const REOPEN_REASONS = new Set(['timeout', 'http_5xx', 'robots']);
export const reopenBody = row => row?.state === 'failed' && REOPEN_REASONS.has(row?.reason);
// 저장 원문이 아예 없는 옛 글: 예전 저장 글자(사회운동 문장·뉴스 body)를 문단 블록으로.
export function legacyBody(text, {lead = false} = {}) {
  const blocks = String(text ?? '').split(/\n+/).map(t => t.trim()).filter(Boolean).slice(0, BLOCK_MAX).map(text => ({t: 'p', text}));
  if (!blocks.length) return {state: 'failed', blocks: [], reason: '본문을 읽지 못함'};
  return lead ? {state: 'lead', blocks, reason: '공개된 앞부분만'} : {state: 'ok', blocks, reason: ''};
}
// S52-39 NEWS-원문복사선택(시안 docs/design/mockups/news-copy-select.html): 원문 칸 [복사]가 클립보드에 넣는 글.
// 제목 / 매체 · 날짜 / 본문 전체(글자 블록 p·h·quote, 문단 사이 빈 줄) / 원래 주소(https만). 사진·캡션은 넣지 않는다.
// blocks: 지금 화면에 보이는 블록(번역해서 보는 중이면 한국어 블록). 화면 안에서만 쓴다(서버 저장·전송 없음).
const oneLine = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
export function copyArticleText(head, blocks) {
  const title = oneLine(head?.title);
  const meta = [head?.meta?.[0], head?.meta?.[2]].map(oneLine).filter(Boolean).join(' · ');
  const body = (Array.isArray(blocks) ? blocks : []).filter(b => b && (b.t === 'p' || b.t === 'h' || b.t === 'quote') && typeof b.text === 'string')
    .map(b => b.text.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()).filter(Boolean).join('\n\n');
  const url = httpsUrl(head?.url);
  return [[title, meta].filter(Boolean).join('\n'), body, url].filter(Boolean).join('\n\n');
}
// ⋯ [공유]로 폰 공유 창에 넘길 것: 제목·주소만(본문은 넘기지 않는다). 주소가 없으면 제목만.
export function shareArticleData(head) {
  const title = oneLine(head?.title).slice(0, 300), url = httpsUrl(head?.url);
  return url ? {title, url} : title ? {title, text: title} : null;
}
// 글자 크기 세 단계(서버 view_prefs.news_font, 없으면 보통).
export const NEWS_FONT_STEPS = Object.freeze([{id: 's', label: '글자 작게'}, {id: 'm', label: '글자 보통'}, {id: 'l', label: '글자 크게'}]);
export const keepNewsFont = v => (NEWS_FONT_STEPS.some(f => f.id === v) ? v : 'm');
// S52-12 NEWS-원문먼저번역(시안 docs/design/mockups/news-detail-translate.html): 원문 칸 [번역].
// 번역 저장 길(S52-36 NEWS-바깥소식번역): 뉴스 기사는 news-feed translate → app_news_items.body_ko,
// 사회운동 영어 소식은 outside-feed translate → app_outside_posts.body_ko(엔진·규칙은 서버 _shared/feed-translate.ts 공용). 외국어 글에만 단추를 둔다.
export const TRANSLATE_FUNCTION = Object.freeze({news: 'news-feed', outside: 'outside-feed'});
export const canTranslate = (item, head) => Object.hasOwn(TRANSLATE_FUNCTION, item?.type || '') && !!head?.lang && head.lang !== 'ko';
// 사회운동 소식은 따로 저장한 body 글자가 없다: 저장 본문 블록의 글자 블록(p·h·quote)을 한 줄씩(서버가 번역에 보낸 것과 같은 줄).
export const blocksBody = blocks => (Array.isArray(blocks) ? blocks : []).filter(b => b && (b.t === 'p' || b.t === 'h' || b.t === 'quote') && typeof b.text === 'string').map(b => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
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
  if (code.includes('AI_MONTHLY_CAP')) return AI_CAP_TEXT;
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
  if (isAiCap(code)) return aiCapText(code);
  if (code.includes('monthly_limit')) return '이번 달 AI 한도를 다 씀';
  if (e?.status === 429 || code.includes('daily_limit')) return '오늘 상세 만들기를 다 씀 · 내일 다시';
  if (e?.status === 404) return '글을 찾지 못함';
  return e?.status ? `상세를 만들지 못함 · HTTP ${e.status}` : '상세를 만들지 못함 · 잠시 뒤 다시';
}

// ---- 보관한 글(12.1): 사회운동 글 별표(app_outside_article_marks.starred_at) + 뉴스 별표(app_news_marks.starred_at)를 한 목록으로 ----
// S67-09 NEWS-보관별표하나로(명진 11/19): 보관 = 별표 하나. S68-24: 이 목록은 읽을 거리 [News](reading.js)와 노트 '보관한 글'(note-news-marks.js)이 읽는다(now-saved.js readSavedRows).
// marks: [{post_id, starred_at, app_outside_posts:{...}}], news: [{id, starred_at, ...}]
// → [{type, id, at, star, row}] 최근 별표 순. 별표 없는 줄은 뺀다(옛 archived_at은 보지 않음 — DB 20261119120000이 별표로 채움).
export function savedRows(marks, news) {
  const out = [];
  for (const m of marks || []) {
    const post = m?.app_outside_posts;
    if (!post || !isUuid(m.post_id) || !m.starred_at) continue;
    out.push({type: 'outside', id: m.post_id, at: m.starred_at, star: true, row: post});
  }
  for (const it of news || []) {
    if (!it || !isUuid(it.id) || !it.starred_at) continue;
    out.push({type: 'news', id: it.id, at: it.starred_at, star: true, row: it});
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id));
}
// 다른 화면(읽을 거리·노트)에서 글 하나를 열 때의 탭: 밑줄이면 [밑줄], 언론 기사면 [언론], 사회운동 글이면 [사회운동], 그 밖은 [전체].
export const openTabFor = (type, highlight = false) => (highlight ? 'marks' : type === 'news' ? 'media' : type === 'outside' ? 'movement' : 'all');

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
export const OUTSIDE_GROUP_LABEL = Object.freeze({labor: '노동', party: '정당', movement: '사회운동', foreign: '국제'});
export const PRESS_REGION_LABEL = Object.freeze({domestic: '언론 국내', foreign: '언론 국제'}); // '외국' → '국제'(11/15 NEWS-출처목록가나다)
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
// 창에 넣을 줄: 전체 → 묶음(깊이 0, 정한 순서) → 매체(깊이 1, 가나다 — name-order.mjs). 켠 매체만. 찾는 말이 있으면 이름에 든 것만 납작하게.
export function mediaRows({tab, oc = [], on = [], nc = [], non = [], pick = MEDIA_ALL, query = '', dot = () => ''}) {
  const onSet = new Set(on || []), nonSet = new Set(non || []);
  const rows = [{id: MEDIA_ALL, name: '전체', label: '전체', depth: 0}];
  if (tab !== 'media') {
    for (const g of OUTSIDE_GROUPS) {
      const members = sortByName((oc || []).filter(s => s?.group === g && onSet.has(s.key)));
      if (!members.length) continue;
      rows.push({id: 'g:' + g, name: OUTSIDE_GROUP_LABEL[g], label: OUTSIDE_GROUP_LABEL[g], depth: 0, dot: dot('g', g)});
      for (const s of members) rows.push({id: 's:' + s.key, name: s.name, label: `${OUTSIDE_GROUP_LABEL[g]} › ${s.name}`, depth: 1, dot: dot('s', s.key)});
    }
  }
  if (tab !== 'movement') {
    for (const r of PRESS_REGIONS) {
      const members = sortByName((nc || []).filter(s => s?.region === r && nonSet.has(s.key)));
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
// S63-11(명진 11/16 '5 고쳐'): 주소 ?item= 로 다시 연 글은 그 글이 들어 있는 탭으로 맞춘다. [전체]·[보관]·[밑줄]은 두 종류 모두 담으므로 그대로,
// [사회운동]에서 뉴스 기사면 [언론], [언론]에서 사회운동 글이면 [사회운동].
export function tabForItem(type, tab) {
  const t = keepNowTab(tab);
  if (t === 'all' || t === 'marks') return t;
  if (type === 'news') return 'media';
  if (type === 'outside') return 'movement';
  return t;
}
// ---- 직접 넣기(S67-02 NEWS-직접넣기) ----
// 원문을 못 읽은 뉴스 기사(늦은 답·없는 글·막힘 등)에 사람이 제목·매체·기자·기사 시각·본문을 넣는다. 저장은 서버(news-feed hand_fill)뿐.
// 서버 상한과 같게(supabase/functions/news-feed/handler.ts HAND_LIMITS). 값은 글자로만 보내고 글자로만 그린다.
export const HAND_LIMITS = Object.freeze({title: 300, publisher: 60, author: 80, body: 50000});
// 못 읽은 기사인가(원문 칸에 [직접 넣기]). 뉴스 기사만 — 사회운동 글은 다른 서버 함수라 이번에 없음.
export const canHandFill = (item, b) => item?.type === 'news' && !!b && !b.failedLoad && b.state === 'failed';
const pad2 = n => String(n).padStart(2, '0');
// ISO 시각 → 달력+시각 칸 값(이 기기 시각, 'YYYY-MM-DDTHH:mm'). 모르면 ''.
export function localInputOf(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
// 달력+시각 칸 값 → ISO(Z). 비면 null(서버는 빈 값 = 넣은 시각으로 보임). 모양이 틀리면 undefined.
export function isoOfLocalInput(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}
const oneLineText = v => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
// 입력 칸 처음 값(기사 줄 + 지금 원문 블록). 이미 아는 값(주소에서 얻은 매체 등)은 미리 채운다.
export function handInitial(row, blocks) {
  const photos = [];
  const title = oneLineText(row?.title), host = hostOf(row?.url);
  // 주소·도메인뿐인 제목은 비운다(목록의 '제목 없음 · 도메인'과 같은 규칙).
  const ownTitle = title && !/^https?:\/\//i.test(title) && title.replace(/^www\./, '') !== host;
  return {
    title: ownTitle ? title : '',
    publisher: oneLineText(row?.publisher) || hostOf(row?.url),
    author: oneLineText(row?.author),
    at: localInputOf(row?.published_at),
    body: handBodyOf(blocks, photos),
    photos,
  };
}
// ---- 직접 넣기 사진(S67-05) ----
// 본문 칸 안 사진: 한 줄 전체가 https 주소 하나이고 끝이 그림 파일(.jpg 등)이거나 '#사진'으로 끝나면 서버가 그 자리에 사진 블록으로 저장한다.
// 바로 다음 줄이 '사진:'·'ⓒ'·'▲'로 시작하면 사진 설명. 서버 규칙(news-feed handPhotoSrc·handBlocks)과 같게 — 판정은 서버가 다시 한다.
export const HAND_PHOTO_MARK = '#사진';
export const HAND_PHOTOS_MAX = 20;
const HAND_IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const HAND_CAP_HEAD = /^(사진\s*[:：]|ⓒ|▲)/;
// 붙여 넣을 수 있는 사진 주소인가(https·사용자·비밀번호·포트 없음·2000자까지). 그림 파일 끝이면 'ext', 아니면 'plain', 못 쓰면 ''.
export function handPhotoKind(raw) {
  const s = String(raw ?? '').trim();
  if (!/^https:\/\/\S+$/i.test(s)) return '';
  const marked = s.endsWith(HAND_PHOTO_MARK);
  let u;
  try { u = new URL(marked ? s.slice(0, -HAND_PHOTO_MARK.length) : s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')) return '';
  u.hash = '';
  if (u.href.length > 2000) return '';
  return marked ? 'marked' : HAND_IMG_EXT.test(u.pathname) ? 'ext' : 'plain';
}
// 본문 칸에 넣을 사진 줄: 그림 파일 끝이 아니면 '#사진'을 붙여 사진임을 표시한다.
export function handPhotoLine(src) {
  const k = handPhotoKind(src), s = String(src ?? '').trim();
  if (!k) return '';
  return k === 'plain' ? s + HAND_PHOTO_MARK : s;
}
// 본문 칸 글자 안 사진 줄 수(서버 상한 20장과 같게 미리 막음).
export function handPhotoCount(body) {
  return String(body ?? '').split(/\r\n?|\n/).filter(l => { const k = handPhotoKind(l); return k === 'ext' || k === 'marked'; }).length;
}
// 원문 블록 → 본문 칸 글자. 글자 블록은 한 줄씩, 사진은 주소 줄(+ '사진:' 설명 줄) — [수정]으로 다시 열어도 사진이 빠지지 않는다.
// own: 받을 목록을 주면 내가 올린 사진(OWN_PHOTO_HOST)은 '[사진 n]' 줄로 쓰고 {n, src}를 own에 넣는다(주면 안 주면 주소 줄 그대로).
export function handBodyOf(blocks, own = null) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b) continue;
    if (b.t === 'img') {
      let line = handPhotoLine(b.src);
      if (own && ownPhotoOf(b.src)) { const n = own.length + 1; own.push({n, src: b.src}); line = photoToken(n); }
      if (!line) continue;
      out.push(line);
      const cap = oneLineText(b.cap);
      if (cap) out.push(HAND_CAP_HEAD.test(cap) ? cap : `사진: ${cap}`);
      continue;
    }
    if ((b.t === 'p' || b.t === 'h' || b.t === 'quote') && typeof b.text === 'string') {
      const t = b.text.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
  }
  return out.join('\n');
}
// ---- 내가 올린 사진(S67-06 NEWS-직접넣기 사진 붙여넣기) ----
// 복사한 사진·폰 사진·끌어다 놓은 사진은 저장 때 서버(news-feed hand_photo_put)가 내 Drive '뉴스 사진' 폴더에 올리고, 본문 블록에는
// 안쪽 표시 주소(https://photo.web2.invalid/<Drive 파일 id>.<확장자>)만 적는다(.invalid는 어디로도 이어지지 않는 예약 이름).
// 본문 칸에는 '[사진 n]' 한 줄로 보이고, 저장할 때 그 줄을 안쪽 표시 주소 줄로 바꿔 보낸다. 그림은 서버 hand_photo로만 받아 그린다.
export const OWN_PHOTO_HOST = 'photo.web2.invalid';
export const HAND_PHOTO_TYPES = Object.freeze({'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'});
export const HAND_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const OWN_SRC = /^https:\/\/photo\.web2\.invalid\/([A-Za-z0-9_-]{10,200})\.(jpg|png|webp|gif)$/;
export function ownPhotoOf(src) {
  const m = typeof src === 'string' ? OWN_SRC.exec(src) : null;
  return m ? {id: m[1], ext: m[2]} : null;
}
export const photoToken = n => `[사진 ${n}]`;
const TOKEN = /^\s*\[사진 (\d{1,3})\]\s*$/;
export function tokenOf(line) {
  const m = TOKEN.exec(String(line ?? ''));
  return m ? Number(m[1]) : 0;
}
// 본문 칸 안 '[사진 n]' 줄 번호들(나온 차례, 겹침 없이).
export function tokensIn(body) {
  const seen = [];
  for (const l of String(body ?? '').split(/\r\n?|\n/)) { const n = tokenOf(l); if (n && !seen.includes(n)) seen.push(n); }
  return seen;
}
// '[사진 n]' 줄 → 그 사진 주소 줄(srcOf(n)이 주소를 줄 때만). 모르는 번호는 글자 그대로.
export function expandPhotoTokens(body, srcOf) {
  return String(body ?? '').split(/(\r\n?|\n)/).map(part => { const n = tokenOf(part), src = n ? srcOf(n) : ''; return src || part; }).join('');
}
// 붙여 넣거나 고른 파일 한 장을 받을 수 있나('' = 받음, 아니면 화면 한 줄).
export function photoFileError(file) {
  if (!HAND_PHOTO_TYPES[String(file?.type || '').toLowerCase()]) return 'jpg·png·webp·gif 사진만 넣을 수 있어요';
  if (!(file.size > 0)) return '빈 파일이에요';
  if (file.size > HAND_PHOTO_MAX_BYTES) return '사진은 한 장 10MB까지';
  return '';
}
// 커서 자리에 여러 줄 끼워 넣기(사진 줄 여러 장).
export function insertPhotoLines(value, at, lines) {
  let v = String(value ?? ''), i = Number.isFinite(at) ? at : v.length;
  for (const line of lines) { const next = insertPhotoLine(v, i, line); v = next.value; i = next.caret; }
  return {value: v, caret: i};
}
// 커서 자리에 사진 줄 끼워 넣기 → {value, caret}. 줄 가운데면 앞뒤로 줄을 바꿔 사진 줄이 한 줄 전체가 되게 한다.
export function insertPhotoLine(value, at, line) {
  const v = String(value ?? ''), i = Math.max(0, Math.min(Number.isFinite(at) ? at : v.length, v.length));
  const before = v.slice(0, i), after = v.slice(i);
  const head = before && !before.endsWith('\n') ? '\n' : '';
  const tail = after.startsWith('\n') ? '' : '\n';
  const next = before + head + line + tail + after;
  return {value: next, caret: (before + head + line + tail).length};
}
export function hostOf(url) {
  try { return new URL(String(url || '')).hostname.replace(/^www\./, ''); } catch { return ''; }
}
// 입력 값 → 서버 몸통 또는 {error: 화면 글자}. 본문은 처음 값에서 바뀌었을 때만 보낸다(바뀌지 않으면 서버가 읽어 둔 본문·사진을 그대로 둔다).
// photos: 본문 칸 '[사진 n]' 번호 → 저장된 사진 주소(올리기 전이면 ''). 그 줄은 주소 줄로 바꿔 보내고 사진 수에 센다.
export function handRequest(id, values, initial, photos = new Map()) {
  const title = oneLineText(values.title), publisher = oneLineText(values.publisher), author = oneLineText(values.author);
  if (!title) return {error: '제목을 넣어 주세요'};
  if ([...title].length > HAND_LIMITS.title) return {error: `제목은 ${HAND_LIMITS.title}자까지`};
  if ([...publisher].length > HAND_LIMITS.publisher) return {error: `매체는 ${HAND_LIMITS.publisher}자까지`};
  if ([...author].length > HAND_LIMITS.author) return {error: `기자 이름은 ${HAND_LIMITS.author}자까지`};
  const at = isoOfLocalInput(values.at);
  if (at === undefined) return {error: '기사 시각을 다시 넣어 주세요'};
  const body = String(values.body ?? '');
  if ([...body].length > HAND_LIMITS.body) return {error: `본문은 ${HAND_LIMITS.body.toLocaleString('ko-KR')}자까지`};
  const known = tokensIn(body).filter(n => photos.has(n));
  if (handPhotoCount(body) + known.length > HAND_PHOTOS_MAX) return {error: `사진은 ${HAND_PHOTOS_MAX}장까지`};
  const out = {id, title, publisher: publisher || null, author: author || null, published_at: at};
  const changed = body.replace(/\s+/g, ' ').trim() !== String(initial?.body ?? '').replace(/\s+/g, ' ').trim();
  if (changed) {
    if (!body.trim()) return {error: '본문을 비울 수는 없어요'};
    out.body = expandPhotoTokens(body, n => photos.get(n) || '');
    if ([...out.body].length > HAND_LIMITS.body) return {error: `본문은 ${HAND_LIMITS.body.toLocaleString('ko-KR')}자까지`};
  }
  return {body: out};
}
// 저장 실패 → 화면 한 줄.
export function handError(e) {
  const code = String(e?.message || '');
  if (e?.status === 403) return '이 작업공간에서는 쓸 수 없어요';
  if (e?.status === 404) return '기사를 찾지 못함';
  if (e?.status === 400 && /INVALID_DATE/.test(code)) return '기사 시각을 다시 넣어 주세요';
  if (e?.status === 400 && /TOO_MANY_PHOTOS/.test(code)) return `사진은 ${HAND_PHOTOS_MAX}장까지`;
  if (e?.status === 400 && /INVALID_TEXT/.test(code)) return '본문에 글자를 넣어 주세요';
  if (e?.status === 413 && /PHOTO_TOO_LARGE/.test(code)) return '사진은 한 장 10MB까지';
  if (e?.status === 415) return 'jpg·png·webp·gif 사진만 넣을 수 있어요';
  if (e?.status === 424) return '구글 드라이브 연결이 필요해요 · 자료실에서 연결';
  if (e?.status === 409 && /DRIVE_FOLDER_SHARED/.test(code)) return "구글 드라이브 '뉴스 사진' 폴더가 공유돼 있어 올리지 않았어요";
  if (e?.status === 409 && /DRIVE_FOLDER_MISSING/.test(code)) return '구글 드라이브 노트 첨부 폴더가 아직 없어요 · 노트에 파일을 한 번 붙인 뒤 다시';
  if (e?.status === 400 || e?.status === 413) return '넣은 값이 너무 길거나 모양이 달라요';
  return e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시';
}
