// S68-09 READ-읽을거리함(명진 11/22 "Raindrop 가져올 것 ㄱ", 위치 "B: 메뉴에 새 칸"): 읽을 거리의 순수 계산. DOM·네트워크 없음(node --test).
// 저장은 서버 표 public.app_reading_items(DB 20261122100000 — 자기 작업공간 주인만). 원문 받아 오기는 기존 Edge note-import 답(글자 블록)을 그대로 쓴다.
// 밑줄은 기존 표 app_news_highlights(종류 'reading')와 공용 부품 text-highlights.js. 여기서는 주소 다듬기·줄 값·거르기·원문 글자·상태 한 줄만 만든다.
import {readImportUrl, hostOf, resultOutcome, failInfo, makeSource, NOTE_BODY_MAX, NOTE_TITLE_MAX} from './note-import-model.mjs';
import {shareArticleUrl, shareArticleTitle} from './share-intake-model.mjs';
import {urlTitle} from './url-title.mjs';

export const TITLE_MAX = 500, SITE_MAX = 120, BODY_MAX = 200000, URL_MAX = 2000, LIST_LIMIT = 500;
export const LIST_COLS = 'id,url,title,site,saved_at,read_at,body_state,body_at,business_area_id,updated_at,origin,news_article_id,outside_article_id';
// lead(본문을 못 찾아 소개 글만)·login(로그인 화면이 옴)은 S70-40a READ-실패까닭에서 더함(DB 20261125170000_reading_body_state_login_lead).
export const BODY_STATES = Object.freeze(['pending', 'ok', 'paywall', 'lead', 'bot_check', 'robots', 'too_big', 'blocked', 'login', 'failed']);
// 거르기 칩: [전체] [안 읽음 n] [밑줄] [메모]. 처음은 전체(S70-24 READ-저장한글기본전체, 명진 11/25 "전체를 기본으로").
// S68-29(명진 11/23 02:23 "news 란을 만들라는 게 아니라 뉴스에서 보관하면 그냥 여기로 오는 개념"): News에서 보낸 글을 따로 거르는 칩은 없다 — 평범한 읽을 거리 줄.
// S69-94 NOTE-메모통일: [메모] = 이 화면 글에 남긴 메모만 모아 보기(노트 [메모]와 같은 메모 목록·같은 줄).
export const FILTERS = Object.freeze(['all', 'unread', 'marks', 'memos']);
export const DEFAULT_FILTER = 'all';
export const keepFilter = v => (FILTERS.includes(v) ? v : DEFAULT_FILTER);

const oneLine = (v, max) => (typeof v === 'string' ? [...v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim() : '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = v => typeof v === 'string' && UUID.test(v);

// 손으로 넣은 주소 → {ok, url} / {ok:false, message}. http는 https로 바꿔 받는다(공유로 온 주소와 같게, 원문은 https로만 읽음).
export function readingUrl(text) {
  const value = String(text ?? '').trim().replace(/^http:\/\//i, 'https://');
  return readImportUrl(value);
}
// 폰 공유 창으로 온 글 → {url, title}. 주소가 없으면 url ''.
export function sharedReading({subject = '', text = ''} = {}) {
  const raw = shareArticleUrl({subject, text});
  const got = raw ? readingUrl(raw) : {ok: false};
  return {url: got.ok ? got.url : '', title: oneLine(shareArticleTitle({subject, text}), TITLE_MAX)};
}
// 새 줄(넣기 칸만): 주소·제목·사이트. 작업공간 칸은 부르는 쪽이 붙인다.
export function newRow(url, title = '') {
  return {url, title: oneLine(title, TITLE_MAX) || null, site: oneLine(hostOf(url), SITE_MAX) || null};
}

// 날짜 한 줄(서울 기준 MM/DD).
export function shortDay(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}
// 목록 한 줄 값: 안 읽음 점 · 제목 · 사이트 · 날짜. 제목이 없으면 주소 경로의 읽을 만한 조각(S69 NEWS-제목늘읽기, url-title.mjs), 그다음 사이트(그것도 없으면 주소).
export function lineOf(row) {
  const site = oneLine(row?.site, SITE_MAX) || hostOf(row?.url) || '';
  return {id: row?.id, url: row?.url || '', title: oneLine(row?.title, TITLE_MAX) || urlTitle(row?.url) || site || row?.url || '제목 없음', site,
    day: shortDay(row?.saved_at), unread: !row?.read_at, area: row?.business_area_id || null, state: BODY_STATES.includes(row?.body_state) ? row.body_state : 'pending'};
}

// ---- 한 목록(S68-27 READ-보관기록일원화, 명진 11/22 "2. A" → 21:37 "저장된 기록도 일원화") ----
// 보관의 원본은 이 표 하나다(DB 20261122230000). News에서 보관한 글도 이 표의 줄이고, 원래 글 연결 칸(news_article_id·outside_article_id)과
// 어디서 왔나(origin: direct·news·outside)를 가진다. 화면은 이 표만 읽는다(두 곳을 합치지 않음).
// 줄(entry): {key: 줄 id, at: 저장 시각, row, link: {type:'news'|'outside', id} | null}
export function linkOf(row) {
  if (isId(row?.news_article_id)) return {type: 'news', id: row.news_article_id};
  if (isId(row?.outside_article_id)) return {type: 'outside', id: row.outside_article_id};
  return null;
}
export function entriesOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => typeof r?.id === 'string' && r.id).map(row => ({key: row.id, at: row.saved_at || '', row, link: linkOf(row)}))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(a.key).localeCompare(String(b.key)));
}
export const entryUnread = e => !!e?.row && !e.row.read_at;
// 거르기([안 읽음]·[전체] — [밑줄]은 글 줄이 아니라 밑줄 줄 목록이라 reading.js가 visibleMarks로 그린다, S69-04). keep: 지금 열어 둔 줄 key — [안 읽음]에서 열자마자 읽음이 되어도(S68-45) 닫을 때까지 그 자리에 남는다(PC 두 칸 목록이 튀지 않게).
export function filterEntries(entries, filter, keep = '') {
  const f = keepFilter(filter), list = Array.isArray(entries) ? entries : [];
  if (f === 'unread') return list.filter(e => entryUnread(e) || (!!keep && e.key === keep));
  if (f === 'marks' || f === 'memos') return [];
  return list;
}
export const unreadCount = entries => (Array.isArray(entries) ? entries.filter(entryUnread).length : 0);
// marks: [밑줄] 탭 숫자 = 노트 › 밑줄과 같은 밑줄 수(visibleMarks 목록 길이, 모르면 null).
export function filterOptions(entries, marks = null, memos = null) {
  const list = Array.isArray(entries) ? entries : [];
  const n = unreadCount(list), m = Number.isInteger(marks) ? marks : 0, c = Number.isInteger(memos) ? memos : 0;
  return [{value: 'all', label: '전체'}, {value: 'unread', label: `안 읽음 ${n}`}, {value: 'marks', label: m ? `밑줄 ${m}` : '밑줄'}, {value: 'memos', label: c ? `메모 ${c}` : '메모'}];
}
// 좌우 밀기: 지금 칩에서 옆 칩으로(끝에서는 그대로).
export function nextFilter(current, dir) {
  const i = FILTERS.indexOf(keepFilter(current)), j = Math.min(FILTERS.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)));
  return FILTERS[j];
}
// 빈 목록 한 줄.
export function emptyText(filter, total) {
  if (filter === 'marks') return '저장한 밑줄이 없어요 · 글을 선택하고 [밑줄 저장]';
  if (filter === 'memos') return '남긴 메모가 없어요 · 글 아래 [메모 남기기]';
  if (!total) return '저장한 글이 없어요 — [+ 추가]에 주소를 넣거나 폰에서 공유 → WORK ON+ 저장한 글';
  return '안 읽은 글이 없어요';
}

// note-import 답 → 저장할 원문 사본 {body, body_state, title?, site?} 또는 요청 실패 {retry:true, reason}.
// 글자 블록(p·h·quote)만 글자로 잇는다(문단 사이 빈 줄). 제어 문자는 뺀다(DB 검사와 같음). 넘치면 뒤를 자른다.
const BLOCK_TEXT = new Set(['p', 'h', 'quote']);
export function bodyText(blocks) {
  const parts = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== 'object' || !BLOCK_TEXT.has(b.t) || typeof b.text !== 'string') continue;
    const t = b.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (t) parts.push(t);
  }
  const all = parts.join('\n\n');
  return [...all].length > BODY_MAX ? [...all].slice(0, BODY_MAX).join('').trim() : all;
}
const FAIL_STATE = {robots: 'robots', bot_check: 'bot_check', paywall: 'paywall', too_big: 'too_big', blocked: 'blocked', redirect: 'blocked', login_page: 'login'};
export function bodyPatch(result, nowIso = new Date().toISOString()) {
  const outcome = resultOutcome(result);
  const meta = {};
  const title = oneLine(result?.title, TITLE_MAX), site = oneLine(result?.site, SITE_MAX);
  if (title) meta.title = title;
  if (site) meta.site = site;
  if (outcome.state === 'ok') {
    const body = bodyText(result?.blocks);
    // 앞부분만 온 글: 유료벽이면 paywall, 본문을 못 찾아 메타 설명만이면 lead(예전에는 둘 다 paywall이라 '유료 기사'로 불렀다 — S70-40a).
    if (body) return {...meta, body, body_state: outcome.reason !== 'lead' ? 'ok' : outcome.lead === 'paywall' ? 'paywall' : 'lead', body_at: nowIso};
    return {...meta, body: null, body_state: 'failed', body_at: nowIso};
  }
  // 로그인 화면: 그 화면의 제목·사이트를 글 제목으로 쓰지 않는다(서버도 돌려주지 않지만 한 번 더 막음).
  if (outcome.reason === 'login_page') return {body: null, body_state: 'login', body_at: nowIso};
  return {...meta, body: null, body_state: FAIL_STATE[outcome.reason] || 'failed', body_at: nowIso};
}
// 이미 사람이 단 제목이 있으면 원문 제목으로 덮지 않는다(사이트도 같음).
// S70-44: 다만 지금 제목이 사이트 이름뿐이면(예전 서버가 게시판형 누리집에서 사이트 이름을 제목으로 읽었던 줄) 새로 읽은 글 제목으로 바꾼다.
const nameKey = v => String(v ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export function siteOnlyTitle(row, patch = {}) {
  const t = nameKey(row?.title);
  if (!t) return false;
  const names = [row?.site, patch?.site].map(nameKey).filter(k => k.length >= 2);
  for (const part of hostOf(row?.url).split('.')) if (part.length >= 3) names.push(nameKey(part));
  return names.includes(t);
}
export function keepOwn(row, patch) {
  const out = {...patch};
  if (row?.title && out.title && !(siteOnlyTitle(row, patch) && !siteOnlyTitle({...row, title: out.title}, patch))) delete out.title;
  if (row?.site && row.site !== hostOf(row?.url) && out.site) delete out.site;
  return out;
}

// 원문 사본 상태 한 줄(원래 페이지 링크는 화면이 늘 따로 보인다). ok면 ''.
export function stateLine(row, {busy = false} = {}) {
  const s = BODY_STATES.includes(row?.body_state) ? row.body_state : 'pending';
  if (busy) return '원문을 가져오는 중…';
  if (s === 'ok') return '';
  if (s === 'pending') return '원문을 아직 가져오지 않았어요.';
  if (s === 'paywall') return row?.body ? '유료 기사라 앞부분만 있어요.' : failInfo('paywall').text;
  if (s === 'lead') return row?.body ? '본문을 찾지 못해 소개 글만 있어요.' : failInfo('no_body').text;
  if (s === 'login') return failInfo('login_page').text;
  return failInfo(s === 'failed' ? 'no_body' : s).text;
}
// 다시 가져오기 버튼을 보일까. 다시 해도 같은 결과인 상태만 숨긴다: ok(이미 있음) · blocked(주소 규칙 밖 — 안쪽 주소·리다이렉트 고리, 서버 guard가 늘 거절) · too_big(크기 한도).
// robots는 S68-23·25(#2875·#2877, 11/22)부터 사람이 저장한 글은 robots.txt를 보지 않으므로 다시 가져올 수 있다. bot_check·paywall·failed도 다시 해 볼 수 있다.
const NO_RETRY = Object.freeze(['ok', 'blocked', 'too_big']);
export const canRetry = row => !NO_RETRY.includes(BODY_STATES.includes(row?.body_state) ? row.body_state : 'pending');

// S68-32 READ-보관글원문다시(명진 11/23 02:25 "이미 보관한 뉴스 전문 못불러오는 것도 제대로"): 화면이 열릴 때 한 번 자동으로 다시 가져올 줄.
// - 대상: 원문이 없는 상태(pending) · 실패(failed) · robots로 막혔던 줄. News에서 온 줄(원래 글 연결이 있음)은 bot_check도 — News 쪽 본문이 그 뒤 채워졌을 수 있다.
// - 한 줄에 한 번만: 마지막 시도 시각(body_at, 서버 칸)이 REFETCH_SINCE보다 앞인 줄만(pending은 body_at이 비어 늘 대상). 자동 시도가 실패하면
//   body_at이 지금으로 바뀌어 다시 자동 대상이 되지 않는다 — 그 뒤는 [다시] 단추만. 기기 저장 없음.
// - REFETCH_SINCE: robots를 보지 않게 된 서버 고침(#2875 21:21·#2877 22:19, 2026-11-22 KST)이 나간 뒤의 시각. 그보다 앞서 실패한 줄은 옛 규칙의 결과다.
export const REFETCH_SINCE = '2026-11-23T04:00:00+09:00';
export const AUTO_BATCH = 2;
const AUTO_STATES = Object.freeze(['pending', 'failed', 'robots']);
// S70-44 READ-제목사이트이름: 제목이 사이트 이름뿐인 줄은 고친 서버(이 시각 뒤)로 한 번 다시 읽는다 — 한 번 정리 단추 없이 목록을 열 때 저절로.
// 다시 읽은 뒤에는 body_at이 이 시각보다 뒤라 또 읽지 않는다(새 제목을 못 얻어도 되풀이 없음).
export const TITLE_REFETCH_SINCE = '2026-11-25T18:00:00+09:00';
export function needsRefetch(row, since = REFETCH_SINCE, titleSince = TITLE_REFETCH_SINCE) {
  if (!isId(row?.id) || !row?.url) return false;
  const s = BODY_STATES.includes(row?.body_state) ? row.body_state : 'pending';
  if ((s === 'ok' || s === 'paywall') && !linkOf(row) && siteOnlyTitle(row)) {
    const at = Date.parse(row?.body_at), cut = Date.parse(titleSince);
    return !Number.isFinite(at) || at < cut;
  }
  if (!(AUTO_STATES.includes(s) || (s === 'bot_check' && linkOf(row)))) return false;
  if (s === 'pending') return true;
  const at = Date.parse(row?.body_at), cut = Date.parse(since);
  return !Number.isFinite(at) || at < cut;
}
// 자동으로 다시 가져올 줄을 AUTO_BATCH개씩 묶는다(이미 해 본 id·지금 가져오는 id는 뺌). 목록 순서(최근 저장 먼저) 그대로.
export function refetchBatches(rows, {tried = new Set(), busy = () => false, since = REFETCH_SINCE, size = AUTO_BATCH} = {}) {
  const todo = (Array.isArray(rows) ? rows : []).filter(r => needsRefetch(r, since) && !tried.has(r.id) && !busy(r.id));
  const out = [];
  for (let i = 0; i < todo.length; i += size) out.push(todo.slice(i, i + size));
  return out;
}
// 자동 다시 가져오기를 그만둘 요청 실패(하루 횟수 다 씀·로그인 풀림·권한 없음 — 다음 줄도 같은 답).
export const stopsAuto = reason => ['daily_limit', 'login', 'forbidden'].includes(reason);

// ---- 제목 주인 하나(S69 READ-제목하나, 명진 11/24 "목록에서 이상한 제목이 보임") ----
// News에서 온 줄의 제목은 이 표의 사본이고, 사람이 글 보기 [직접 넣기]·⋯ [수정]으로 고치는 곳은 공용 기사(app_news_articles, 손으로 넣은 기사 manual_at)다.
// 그래서 손으로 넣은 기사의 제목이 사본과 다르면 그 제목이 이긴다 — 목록·글 보기·검색·홈·밑줄 출처가 모두 이 표 제목을 읽으므로 사본을 맞춘다.
// articles: [{id, title, manual_at}] (기사 표에서 읽은 줄). 고칠 줄 [{id: 이 표 줄 id, title}]만 돌려준다(수집 기사·빈 제목·같은 제목은 그대로).
export function titleFixes(rows, articles) {
  const by = new Map((Array.isArray(articles) ? articles : []).filter(a => isId(a?.id) && a?.manual_at).map(a => [String(a.id).toLowerCase(), oneLine(a.title, TITLE_MAX)]));
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isId(row?.id) || !isId(row?.news_article_id)) continue;
    const t = by.get(row.news_article_id.toLowerCase());
    if (t && t !== oneLine(row.title, TITLE_MAX)) out.push({id: row.id, title: t});
  }
  return out;
}
// 손으로 고친 제목 → 이 표 사본 칸 값(한 줄·상한). 빈 제목이면 null(고치지 않음).
export const ownTitle = t => oneLine(t, TITLE_MAX) || null;

// News에서 온 줄: News 쪽 본문(공용 본문 표 app_news_article_bodies·app_outside_article_bodies, 옛 사회운동 글은 문장 표)이 이미 있으면 그 본문으로 원문 사본을 만든다.
// DB의 private.app_reading_body(20261122230000 3))와 같은 규칙: 상태 ok·lead의 글자 블록(p·h·quote)만, lead → paywall. 문장은 빈칸으로 잇는다. 없으면 null(원래 주소로 받기).
export function copyPatch(got, sentences, nowIso = new Date().toISOString()) {
  if (got && (got.state === 'ok' || got.state === 'lead')) {
    const body = bodyText(got.blocks);
    if (body) return {body, body_state: got.state === 'lead' ? 'paywall' : 'ok', body_at: nowIso};
  }
  const lines = (Array.isArray(sentences) ? sentences : [])
    .map(x => (typeof x?.text === 'string' ? x.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '')).filter(Boolean);
  if (!lines.length) return null;
  const all = lines.join(' ');
  const body = ([...all].length > BODY_MAX ? [...all].slice(0, BODY_MAX).join('') : all).trim();
  return body ? {body, body_state: 'ok', body_at: nowIso} : null;
}
// 요청 자체가 실패했을 때 한 줄(하루 횟수·로그인 등). note-import 화면과 같은 글.
export const requestLine = reason => failInfo(reason).text;

// 저장한 원문 → 문단 목록(빈 줄로 나눔). 문단 안 줄바꿈은 그대로.
export function paragraphs(body) {
  return String(body ?? '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
}
// 밑줄 출처(text-highlights.js cleanSource 모양).
export function sourceOf(row) {
  if (!isId(row?.id)) return null;
  const l = lineOf(row);
  return {type: 'reading', id: row.id, title: l.title, media: l.site || null, date: row?.saved_at || null, url: row?.url || null};
}

// S69-98 NOTE-에버노트 ⑤(명진 11/25 "좋아 모두 다 넣어!"): 글 보기 [노트로 만들기] — 받아 둔 원문 사본 + 출처 주소 + 저장 시각을 새 노트 한 장으로.
// 새 저장소 없음: 노트는 기존 노트 만들기 길(createNoteDoc), 원래 주소는 노트의 원문 정보(metadata.source, 주소로 가져오기와 같은 모양)로도 남긴다.
// 읽을 거리 줄·원문 사본은 그대로 둔다(복사). 노트 글자 상한을 넘으면 뒤 문단부터 빼고 한 줄로 알린다.
// → {title, raw_text, source, cut} | null(줄 id·https 주소가 없을 때)
export const NOTE_CUT_LINE = '(뒷부분은 원래 페이지에서 읽어 주세요)';
export function savedStamp(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600000), two = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
export function readingNote(row, body, {max = NOTE_BODY_MAX} = {}) {
  if (!isId(row?.id)) return null;
  const l = lineOf(row);
  const source = makeSource({url: row?.url, site: l.site, fetched_at: row?.body_at || undefined, state: 'ok'});
  if (!source) return null;
  const stamp = savedStamp(row?.saved_at);
  const tail = ['---', '출처: ' + [l.site, source.url].filter(Boolean).join(' · '), stamp ? '저장: ' + stamp : ''].filter(Boolean).join('\n');
  const len = v => [...v].length;
  let paras = paragraphs(body), cut = false;
  const join = list => [list.join('\n\n'), cut ? NOTE_CUT_LINE : '', tail].filter(Boolean).join('\n\n');
  let raw = join(paras);
  while (len(raw) > max && paras.length) { paras = paras.slice(0, -1); cut = true; raw = join(paras); }
  if (len(raw) > max) return null;
  return {title: [...l.title].slice(0, NOTE_TITLE_MAX).join('').trim(), raw_text: raw, source, cut};
}
