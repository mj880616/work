// NEWS-클리핑 화면 계산(설계 docs/design/news-clipping.md, 명진 11/01 22:34): 그리기 없는 순수 함수만. app/news-clipping.js가 쓴다.
// - 한 목록: 채널 기사(lane=channel) + 서버가 찾은 기사(lane=keyword·media) = 하나의 스크랩. 어디서 왔는지(채널/자동) 칩·꼬리표는 화면에 없다(11/04 명진: 굳이 구분 안 해도 됨). lane 값·수집 방식은 그대로.
// - 한 문장 요약은 늘 보이고 본문은 접는다. 외국어 기사 제목은 서버가 수집 때 한국어로 미리 번역해 두고(한국어 제목 + 원제 작게),
//   본문은 [번역]을 누를 때만 서버가 번역해 저장한다(저장본 재사용, S47-57 명진 결정).
// - 하루 횟수 같은 기본값은 서버(supabase/functions/news-feed/handler.ts) 상수 한 곳이 정하고, 화면은 catalog 응답 limits로 받는다.
export const ALL = 'all';
// C2: 별표한 기사는 폴더 트리(폴더 안 폴더)로 본다.
export const STAR = 'star';
export const PAGE_SIZE = 40;
export const KEYWORD_MAX_CHARS = 30;
// 서버가 limits를 주기 전(또는 실패)의 보임용 값. 실제 한도는 서버가 센다.
export const DEFAULT_LIMITS = Object.freeze({fill: 10, translate: 20, keywords: 30});

// 목록 읽기 걸러내기(PostgREST 조건 조각). 지운 줄(hidden_at)은 늘 뺀다.
export function laneFilter(tab) {
  if (tab === STAR) return '&starred_at=not.is.null';
  return '';
}
export const orderOf = tab => (tab === STAR ? 'starred_at.desc,id.desc' : 'created_at.desc,id.desc');

export function domainOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
// 주소·도메인뿐인 제목('https://…', 'www.…', 'naver.me/abc', 'labortoday.co.kr').
export const isAddressTitle = t => /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?)…?$/i.test(String(t ?? '').trim());
// 이미 저장된 글에 태그·&nbsp;가 글자로 남은 것(11/04 ITF)을 화면에서 글자만으로 — 서버 feedText와 같은 순서(풀기 → 태그 걷기 → 다시 풀기).
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”'};
const unescapeText = s => String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
  }
  return ENT[e.toLowerCase()] ?? m;
});
export function plainText(raw) {
  const s = String(raw ?? '');
  if (!/[<&]/.test(s)) return s;
  const t = unescapeText(s)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, ' ');
  return unescapeText(t).split('\n').map(l => l.replace(/[\s\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
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

// 줄 하나의 보임 값. 외국어 제목은 한국어 번역(title_ko)이 있으면 늘 한국어로 보이고 원제는 origTitle로 작게.
// showKo: 본문 번역 보기를 고른 상태(본문 번역 저장본이 있을 때만 화면이 켠다).
export function itemView(item, {showKo = false} = {}) {
  const foreign = isForeign(item);
  const ko = foreign && showKo;
  const t = whenOf(item);
  const koTitle = foreign && typeof item.title_ko === 'string' && item.title_ko.trim() ? plainText(item.title_ko).replace(/\s+/g, ' ').trim() : '';
  // 제목이 없거나 주소·도메인뿐이면 도메인을 제목으로 보이지 않는다(NEWS-채널밀림 ②, 11/02): '제목 읽기 전 · 도메인' / '제목 없음 · 도메인'.
  const rawTitle = plainText(item.title).replace(/\s+/g, ' ').trim();
  const own = rawTitle && !isAddressTitle(rawTitle) ? rawTitle : '';
  const host = domainOf(item.url);
  const title = koTitle || own || `${item.state === 'pending' ? '제목 읽기 전' : '제목 없음'}${host ? ` · ${host}` : ''}`;
  return {
    publisher: item.publisher || domainOf(item.url),
    time: t === null ? '' : hhmm(t),
    title,
    origTitle: koTitle && rawTitle && rawTitle !== koTitle ? rawTitle : '',
    titleLang: foreign && !koTitle ? item.lang : '',
    summary: plainText(item.summary).replace(/\s+/g, ' ').trim(),
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
export function errorNote(e, what) {
  const code = `${e?.code || ''} ${e?.message || ''}`;
  if (code.includes('MONTHLY_LIMIT')) return '이번 달 AI 한도에 닿음';
  if (e?.status === 429 || code.includes('DAILY_LIMIT')) return `오늘 ${what} 횟수를 다 씀`;
  if (e?.status === 404) return '기사가 없음';
  return `${what} 실패 · 잠시 뒤 다시`;
}
// 목록을 열 때 화면에 읽기 전(pending) 채널 기사가 있으면 서버가 새 것부터 몇 건 바로 채운다(S50-15, 하루 한도는 서버가 지킴).
// 같은 화면에서 AUTO_FILL_GAP_MS 안에는 다시 부르지 않는다(메모리 값만, 기기에 저장하지 않음).
export const AUTO_FILL_GAP_MS = 10 * 60 * 1000;
export function needsAutoFill(items, lastMs, nowMs) {
  if (Number.isFinite(lastMs) && nowMs - lastMs < AUTO_FILL_GAP_MS) return false;
  return Array.isArray(items) && items.some(it => it?.lane === 'channel' && it?.state === 'pending');
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

// 키워드 칸(S59-1 NEWS-키워드살리기, 11/11 명진 결정): 밖에서 새로 찾지 않고, 받은 매체 글 가운데 서버(news-feed 키워드 단계)가
// keywords 칸에 키워드를 적어 둔 글을 키워드마다 모아 보인다. 켠 키워드만, 키워드 목록 순서, 키워드마다 새 글부터 KW_GROUP_SIZE건.
export const KW_GROUP_SIZE = 20;
// PostgREST 배열 값(cs.{…})의 글자: 낱말마다 큰따옴표로 감싸고, 안의 \ 와 " 는 앞에 \ 를 붙인다(PostgreSQL 배열 글자 규칙). 주소에 넣을 때는 따로 encodeURIComponent.
export const pgTextArray = words => `{${(words || []).map(w => `"${String(w).replace(/[\\"]/g, c => `\\${c}`)}"`).join(',')}}`;
// 켠 키워드 → 모아 볼 묶음. hits: Map(낱말 → {items, more}). 걸린 글이 없는 키워드는 묶음을 만들지 않는다.
export function keywordGroups(keywords, hits) {
  return (keywords || []).filter(k => k?.enabled === true && typeof k.word === 'string')
    .map(k => ({word: k.word, items: hits?.get?.(k.word)?.items || [], more: !!hits?.get?.(k.word)?.more}))
    .filter(g => g.items.length);
}
// 묶음 머리 글자: '철도 · 12건', 더 있으면 '철도 · 최근 20건'.
export const keywordGroupLabel = g => `${g.word} · ${g.more ? `최근 ${g.items.length}건` : `${g.items.length}건`}`;

// 매체 카탈로그(서버 news-feed ?action=catalog): key·name·region·lang만 받는다.
export function normalizeCatalog(data) {
  const list = Array.isArray(data?.sources) ? data.sources : [];
  return list.filter(s => s && /^news-[a-z0-9-]{1,34}$/.test(String(s.key)) && typeof s.name === 'string')
    .map(s => ({key: s.key, name: s.name.slice(0, 60), region: s.region === 'foreign' ? 'foreign' : 'domestic', lang: typeof s.lang === 'string' ? s.lang : 'ko', on: s.on === true}));
}
// 켬 여부: 그 매체 줄이 있으면 줄 값, 없으면 카탈로그 기본 켬(on, S53-6 — 서버 news-feed도 같은 규칙으로 읽는다).
export function sourceOn(source, row) {
  return row ? row.enabled === true : source?.on === true;
}
export function enabledSourceKeys(catalog, rows) {
  return (catalog || []).filter(s => sourceOn(s, rows?.get?.(s.key))).map(s => s.key);
}
export function normalizeLimits(data) {
  const l = data?.limits || {};
  const pick = (k) => (Number.isInteger(l[k]) && l[k] >= 0 ? l[k] : DEFAULT_LIMITS[k]);
  return {fill: pick('fill'), translate: pick('translate'), keywords: pick('keywords')};
}
// 이번 달 AI 한도(서버 catalog 응답 ai.month_capped, NEWS-다받기 ④): 닿으면 수집 때 요약·외국어 제목 번역이 멈춘다. 예/아니오만 받는다.
export const AI_CAP_NOTE = '이번 달 AI 한도에 닿아 요약·제목 번역이 멈춤 · 다음 달 1일 다시';
export const aiCapped = data => data?.ai?.month_capped === true;
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
