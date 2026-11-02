// NEWS-클리핑 화면 계산(설계 docs/design/news-clipping.md, 명진 11/01 22:34): 그리기 없는 순수 함수만. app/news-clipping.js가 쓴다.
// - 한 목록: 채널 기사(lane=channel) + 서버가 찾은 기사(lane=keyword·media) = 하나의 스크랩. 꼬리표는 '채널'/'자동' 두 가지뿐.
// - 한 문장 요약은 늘 보이고 본문은 접는다. 외국어 기사 제목은 서버가 수집 때 한국어로 미리 번역해 두고(한국어 제목 + 원제 작게),
//   본문은 [번역]을 누를 때만 서버가 번역해 저장한다(저장본 재사용, S47-57 명진 결정).
// - 하루 횟수 같은 기본값은 서버(supabase/functions/news-feed/handler.ts) 상수 한 곳이 정하고, 화면은 catalog 응답 limits로 받는다.
export const ALL = 'all';
export const CHANNEL = 'channel';
export const AUTO = 'auto';
// C2: 별표한 기사는 폴더 트리(폴더 안 폴더)로 본다.
export const STAR = 'star';
export const TABS = Object.freeze([
  {id: ALL, label: '전체'},
  {id: CHANNEL, label: '채널'},
  {id: AUTO, label: '자동'},
  {id: STAR, label: '별표'},
]);
export const PAGE_SIZE = 40;
export const KEYWORD_MAX_CHARS = 30;
// 서버가 limits를 주기 전(또는 실패)의 보임용 값. 실제 한도는 서버가 센다.
export const DEFAULT_LIMITS = Object.freeze({fill: 10, translate: 20, keyword_items: 30, keywords: 30});

// 목록 읽기 걸러내기(PostgREST 조건 조각). 지운 줄(hidden_at)은 늘 뺀다.
export function laneFilter(tab) {
  if (tab === CHANNEL) return '&lane=eq.channel';
  if (tab === AUTO) return '&lane=in.(keyword,media)';
  if (tab === STAR) return '&starred_at=not.is.null';
  return '';
}
export const orderOf = tab => (tab === STAR ? 'starred_at.desc,id.desc' : 'created_at.desc,id.desc');
export const tagOf = item => (item?.lane === 'channel' ? '채널' : '자동');
export const tabAt = (tab, step) => {
  const i = TABS.findIndex(t => t.id === tab) + step;
  return i >= 0 && i < TABS.length ? TABS[i].id : null;
};
export const keepTab = tab => (TABS.some(t => t.id === tab) ? tab : ALL);

export function domainOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
// 주소·도메인뿐인 제목('https://…', 'www.…', 'naver.me/abc', 'labortoday.co.kr').
export const isAddressTitle = t => /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?)…?$/i.test(String(t ?? '').trim());
export const isForeign = item => !!item && typeof item.lang === 'string' && item.lang !== 'ko';

// 상태 글(제목 아래 작은 줄). 정상(ok)은 없음.
const STATE_NOTE = {
  pending: '아직 안 읽음',
  robots: '사이트가 자동 읽기를 막아 둠 · 원문에서',
  bot_check: '사이트 확인 화면 · 원문에서',
  paywall: '유료 기사 · 공개 요약만',
  failed: '읽지 못함 · 원문에서',
  too_big: '본문이 너무 큼 · 원문에서',
  blocked: '읽지 않는 주소 · 원문에서',
};
export const stateNote = state => STATE_NOTE[state] || '';

// 시각: 24시간 HH:MM(UI-화면정리 B). 날짜 묶음 머리가 날짜를 보이므로 줄에는 시각만.
const KST = 9 * 3600000;
const dayKey = ms => new Date(ms + KST).toISOString().slice(0, 10);
const hhmm = ms => new Date(ms + KST).toISOString().slice(11, 16);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function whenOf(item) {
  const t = Date.parse(item?.scrapped_at || item?.published_at || item?.created_at || '');
  return Number.isFinite(t) ? t : null;
}
export function dayLabel(key, now = Date.now()) {
  const today = dayKey(now), yest = dayKey(now - 86400000);
  if (key === today) return '오늘';
  if (key === yest) return '어제';
  const [y, m, d] = key.split('-').map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(y) === today.slice(0, 4) ? '' : `${y}. `}${m}. ${d}. (${w})`;
}
// 받은 순서(created_at 내림차순) 그대로 날짜 묶음. 묶음 날짜는 받은 날.
export function groupItems(items, now = Date.now()) {
  const out = [];
  for (const it of items) {
    const t = Date.parse(it?.created_at || '');
    const key = Number.isFinite(t) ? dayKey(t) : '';
    const last = out.at(-1);
    if (last && last.key === key) last.items.push(it);
    else out.push({key, label: key ? dayLabel(key, now) : '', items: [it]});
  }
  return out;
}

// 줄 하나의 보임 값. 외국어 제목은 한국어 번역(title_ko)이 있으면 늘 한국어로 보이고 원제는 origTitle로 작게.
// showKo: 본문 번역 보기를 고른 상태(본문 번역 저장본이 있을 때만 화면이 켠다).
export function itemView(item, {showKo = false} = {}) {
  const foreign = isForeign(item);
  const ko = foreign && showKo;
  const t = whenOf(item);
  const koTitle = foreign && typeof item.title_ko === 'string' && item.title_ko.trim() ? item.title_ko : '';
  // 제목이 없거나 주소·도메인뿐이면 도메인을 제목으로 보이지 않는다(NEWS-채널밀림 ②, 11/02): '제목 읽기 전 · 도메인' / '제목 없음 · 도메인'.
  const own = typeof item.title === 'string' && item.title.trim() && !isAddressTitle(item.title) ? item.title : '';
  const host = domainOf(item.url);
  const title = koTitle || own || `${item.state === 'pending' ? '제목 읽기 전' : '제목 없음'}${host ? ` · ${host}` : ''}`;
  return {
    tag: tagOf(item),
    publisher: item.publisher || domainOf(item.url),
    time: t === null ? '' : hhmm(t),
    title,
    origTitle: koTitle && item.title && item.title !== koTitle ? item.title : '',
    titleLang: foreign && !koTitle ? item.lang : '',
    summary: item.summary || '',
    note: stateNote(item.state),
    foreign,
    showingKo: ko,
    // 본문 접기: 매체 새 글(제목만)·대기·막힘 줄은 본문 칸이 없다(원문 링크만). 유료는 공개 요약(lead)만.
    canOpen: item.state === 'ok' || item.state === 'paywall' || !!item.body_kind,
    url: /^https?:\/\//.test(String(item.url || '')) ? item.url : '',
    keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 3) : [],
  };
}

// 서버 [본문 열기] 응답 → 화면 글. 'stored'·'ok'는 줄을 다시 읽어 본문을 보인다.
export function openResult(status) {
  if (status === 'stored' || status === 'ok') return {reload: true, note: ''};
  if (status === 'paywall') return {reload: true, note: ''};
  if (status === 'original_only') return {reload: false, note: '이 기사는 원문에서 보기'};
  return {reload: true, note: stateNote(status) || '본문을 읽지 못함 · 원문에서'};
}
export function errorNote(e, what) {
  const code = `${e?.code || ''} ${e?.message || ''}`;
  if (code.includes('MONTHLY_LIMIT')) return '이번 달 AI 한도에 닿음';
  if (e?.status === 429 || code.includes('DAILY_LIMIT')) return `오늘 ${what} 횟수를 다 씀`;
  if (e?.status === 404) return '기사가 없음';
  return `${what} 실패 · 잠시 뒤 다시`;
}
export function fillResult(r) {
  if (r?.status === 'nothing') return '채울 기사 없음';
  const done = Number(r?.done) || 0, left = Number(r?.deferred) || 0;
  return left ? `${done}건 채움 · ${left}건은 다음에` : `${done}건 채움`;
}

// 키워드: 앞뒤 공백 떼고 1~30자, 제어 문자 없음, 이미 있으면 안 됨.
export function cleanWord(raw, have = []) {
  const w = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!w) return {ok: false, reason: ''};
  if ([...w].length > KEYWORD_MAX_CHARS) return {ok: false, reason: `${KEYWORD_MAX_CHARS}자까지`};
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(w)) return {ok: false, reason: '쓸 수 없는 글자'};
  if (have.some(h => h === w)) return {ok: false, reason: '이미 있음'};
  return {ok: true, word: w};
}

// 매체 카탈로그(서버 news-feed ?action=catalog): key·name·region·lang만 받는다.
export function normalizeCatalog(data) {
  const list = Array.isArray(data?.sources) ? data.sources : [];
  return list.filter(s => s && /^news-[a-z0-9-]{1,34}$/.test(String(s.key)) && typeof s.name === 'string')
    .map(s => ({key: s.key, name: s.name.slice(0, 60), region: s.region === 'foreign' ? 'foreign' : 'domestic', lang: typeof s.lang === 'string' ? s.lang : 'ko'}));
}
export function normalizeLimits(data) {
  const l = data?.limits || {};
  const pick = (k) => (Number.isInteger(l[k]) && l[k] >= 0 ? l[k] : DEFAULT_LIMITS[k]);
  return {fill: pick('fill'), translate: pick('translate'), keyword_items: pick('keyword_items'), keywords: pick('keywords')};
}
export const REGIONS = Object.freeze([{key: 'domestic', label: '국내'}, {key: 'foreign', label: '해외'}]);
export function sourceNote(row) {
  if (!row?.enabled) return '';
  if (row.last_error) return '읽지 못함';
  const t = Date.parse(row.last_ok_at || '');
  if (!Number.isFinite(t)) return '아직 읽지 않음';
  return `${dayLabel(dayKey(t))} ${hhmm(t)} 읽음`;
}

// ---------- C2: 별표 폴더 · 메모(= 노트) ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
// 기사 → 별표 폴더 id(없거나 모르는 폴더면 null = 폴더 없음).
export const itemFolderId = (item, folders) => (item?.starred_at && isUuid(item.folder_id) && folders.some(f => f.id === item.folder_id) ? item.folder_id : null);
// 메모 노트 → 기사 id(metadata.news_item_id). 노트 화면의 [기사로 가기]도 이것만 본다.
export function noteNewsItemId(note) {
  const m = note?.metadata;
  const id = m && typeof m === 'object' && !Array.isArray(m) ? m.news_item_id : null;
  return isUuid(id) ? id : null;
}
// 메모 노트 제목: '기사 메모 · 기사 제목'(한 줄, 200자 안쪽). 노트 목록에서 어느 기사 메모인지 보이게.
export function memoTitle(item) {
  const t = String(item?.title_ko || (item?.title && !isAddressTitle(item.title) ? item.title : '') || domainOf(item?.url) || '기사').replace(/\s+/g, ' ').trim();
  return [...`기사 메모 · ${t}`].slice(0, 200).join('');
}
// 기사 id 여러 개 → 메모 노트 묶음(기사마다 가장 최근에 고친 노트 하나).
export function memoIndex(notes) {
  const out = new Map();
  for (const n of Array.isArray(notes) ? notes : []) {
    const id = noteNewsItemId(n);
    if (!id) continue;
    const have = out.get(id);
    if (!have || String(n.updated_at || '') > String(have.updated_at || '')) out.set(id, n);
  }
  return out;
}
