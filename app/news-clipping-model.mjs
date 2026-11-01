// NEWS-클리핑 화면 계산(설계 docs/design/news-clipping.md, 명진 11/01 22:34): 그리기 없는 순수 함수만. app/news-clipping.js가 쓴다.
// - 한 목록: 채널 기사(lane=channel) + 서버가 찾은 기사(lane=keyword·media) = 하나의 스크랩. 꼬리표는 '채널'/'자동' 두 가지뿐.
// - 한 문장 요약은 늘 보이고 본문은 접는다. 외국어 기사는 원문 그대로, [번역]을 누를 때만 서버가 번역해 저장한다(저장본 재사용).
// - 하루 횟수 같은 기본값은 서버(supabase/functions/news-feed/handler.ts) 상수 한 곳이 정하고, 화면은 catalog 응답 limits로 받는다.
export const ALL = 'all';
export const CHANNEL = 'channel';
export const AUTO = 'auto';
export const TABS = Object.freeze([
  {id: ALL, label: '전체'},
  {id: CHANNEL, label: '채널'},
  {id: AUTO, label: '자동'},
]);
export const PAGE_SIZE = 40;
export const KEYWORD_MAX_CHARS = 30;
// 서버가 limits를 주기 전(또는 실패)의 보임용 값. 실제 한도는 서버가 센다.
export const DEFAULT_LIMITS = Object.freeze({fill: 10, translate: 20, keyword_items: 30, keywords: 30});

// 목록 읽기 걸러내기(PostgREST 조건 조각). 지운 줄(hidden_at)은 늘 뺀다.
export function laneFilter(tab) {
  if (tab === CHANNEL) return '&lane=eq.channel';
  if (tab === AUTO) return '&lane=in.(keyword,media)';
  return '';
}
export const tagOf = item => (item?.lane === 'channel' ? '채널' : '자동');
export const tabAt = (tab, step) => {
  const i = TABS.findIndex(t => t.id === tab) + step;
  return i >= 0 && i < TABS.length ? TABS[i].id : null;
};
export const keepTab = tab => (TABS.some(t => t.id === tab) ? tab : ALL);

export function domainOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
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

// 줄 하나의 보임 값. showKo: 번역 저장본이 있고 번역 보기를 고른 상태.
export function itemView(item, {showKo = false} = {}) {
  const foreign = isForeign(item);
  const ko = foreign && showKo && !!item.translated_at;
  const t = whenOf(item);
  const title = (ko && item.title_ko) || item.title || domainOf(item.url) || '제목 없음';
  return {
    tag: tagOf(item),
    publisher: item.publisher || domainOf(item.url),
    time: t === null ? '' : hhmm(t),
    title,
    titleLang: foreign && !ko ? item.lang : '',
    summary: item.summary || '',
    note: stateNote(item.state),
    foreign,
    translated: !!item.translated_at,
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
