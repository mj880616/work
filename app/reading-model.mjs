// S68-09 READ-읽을거리함(명진 11/22 "Raindrop 가져올 것 ㄱ", 위치 "B: 메뉴에 새 칸"): 읽을 거리의 순수 계산. DOM·네트워크 없음(node --test).
// 저장은 서버 표 public.app_reading_items(DB 20261122100000 — 자기 작업공간 주인만). 원문 받아 오기는 기존 Edge note-import 답(글자 블록)을 그대로 쓴다.
// 밑줄은 기존 표 app_news_highlights(종류 'reading')와 공용 부품 text-highlights.js. 여기서는 주소 다듬기·줄 값·거르기·원문 글자·상태 한 줄만 만든다.
import {readImportUrl, hostOf, resultOutcome, failInfo} from './note-import-model.mjs';
import {shareArticleUrl, shareArticleTitle} from './share-intake-model.mjs';

export const TITLE_MAX = 500, SITE_MAX = 120, BODY_MAX = 200000, URL_MAX = 2000, LIST_LIMIT = 500;
// S68-27: origin('direct' 직접 · 'news' News 언론 · 'outside' News 사회운동)과 원래 글 연결 칸(news_article_id·outside_article_id) — DB 20261122230000.
export const LIST_COLS = 'id,url,title,site,saved_at,read_at,body_state,body_at,business_area_id,updated_at,origin,news_article_id,outside_article_id';
export const BODY_STATES = Object.freeze(['pending', 'ok', 'paywall', 'bot_check', 'robots', 'too_big', 'blocked', 'failed']);
// 거르기 칩: [안 읽음 n] [전체] [밑줄] (+ News 기능 키가 있는 사람만 [News n], S68-24). 처음은 안 읽음.
export const FILTERS = Object.freeze(['unread', 'all', 'marks']);
export const NEWS_FILTERS = Object.freeze([...FILTERS, 'news']);
export const filtersOf = (newsOn = false) => (newsOn ? NEWS_FILTERS : FILTERS);
export const keepFilter = (v, newsOn = false) => (filtersOf(newsOn).includes(v) ? v : 'unread');

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
// 목록 한 줄 값: 안 읽음 점 · 제목 · 사이트 · 날짜. 제목이 없으면 사이트(그것도 없으면 주소).
export function lineOf(row) {
  const site = oneLine(row?.site, SITE_MAX) || hostOf(row?.url) || '';
  return {id: row?.id, url: row?.url || '', title: oneLine(row?.title, TITLE_MAX) || site || row?.url || '제목 없음', site,
    day: shortDay(row?.saved_at), unread: !row?.read_at, area: row?.business_area_id || null, state: BODY_STATES.includes(row?.body_state) ? row.body_state : 'pending'};
}

// ---- 한 목록(S68-24 READ-보관하나로 → S68-27 READ-보관기록일원화, 명진 11/22 21:37 "저장된 기록도 일원화 하지 왜?") ----
// 보관한 글의 원본은 읽을 거리 표 하나: News ★·밀기 보관은 그 글을 가리키는 읽을 거리 줄(origin news·outside, news_article_id·outside_article_id)이다.
// 그래서 목록은 읽을 거리 줄 그대로 한 번 읽어 그린다(두 곳을 읽어 합치지 않음). 줄 = 읽을 거리 줄(row).
// 원래 글 연결 → {type:'news'|'outside', id} 또는 null.
const linked = v => typeof v === 'string' && v.length > 0 && v.length <= 64; // 모양(uuid) 검사는 서버(외래 키)가 한다
export function linkOf(row) {
  if (linked(row?.news_article_id)) return {type: 'news', id: row.news_article_id};
  if (linked(row?.outside_article_id)) return {type: 'outside', id: row.outside_article_id};
  return null;
}
// News에서 보관한 줄(News ★·밀기·폰 공유 'News 보관'으로 생긴 줄) — News 기능 키가 있으면 누르면 News 글 보기로 연다(원문·밑줄은 News 쪽 그대로).
// 직접 넣은 줄이 같은 주소라 연결만 된 줄(origin direct)은 읽을 거리 보기로 연다(꼬리표 둘).
export const fromNews = row => row?.origin !== 'direct' && !!linkOf(row) && (row?.origin === 'news' || row?.origin === 'outside');
// News 기능 키가 없는(또는 아직 모르는) 사람에게는 News에서 보관한 줄을 보이지 않는다(S63-03 NEWS-운영자만 — 모인 보관은 지우지 않고 그대로 둔다).
// 직접 넣은 줄은 같은 주소로 News 글에 연결돼 있어도 그대로 보인다.
export const visibleRows = (rows, newsOn = false) => (Array.isArray(rows) ? rows : []).filter(r => r?.id && (newsOn || !fromNews(r)));
// 밑줄 표(app_news_highlights) 줄 → '종류:id' 묶음(읽을 거리 'reading:<id>', News 'news:<id>'·'outside:<id>'). News 밑줄은 옮기지 않았으므로 연결 칸으로 찾는다.
export const markKeysOf = list => new Set((Array.isArray(list) ? list : []).filter(h => h?.source_type && h?.source_id).map(h => `${h.source_type}:${h.source_id}`));
export function entryMarked(row, keys = new Set()) {
  const l = linkOf(row);
  return keys.has(`reading:${row?.id}`) || (!!l && keys.has(`${l.type}:${l.id}`));
}
// 안 읽음은 직접 넣은 줄만(News에서 보관한 글은 이미 본 글을 보관한 것이라 '안 읽음'에 넣지 않는다 — S68-24와 같음).
export const entryUnread = row => !!row?.id && !fromNews(row) && !row.read_at;
export const entryNews = row => !!linkOf(row);
// 거르기. newsOn이 아니면 [News] 칩이 없다(줄은 그대로 읽을 거리 줄로 보인다).
export function filterEntries(rows, filter, keys = new Set(), newsOn = false) {
  const f = keepFilter(filter, newsOn), list = (Array.isArray(rows) ? rows : []).filter(r => r?.id);
  if (f === 'unread') return list.filter(entryUnread);
  if (f === 'marks') return list.filter(r => entryMarked(r, keys));
  if (f === 'news') return list.filter(entryNews);
  return list;
}
export const unreadCount = rows => (Array.isArray(rows) ? rows.filter(entryUnread).length : 0);
export function filterOptions(rows, keys = new Set(), newsOn = false) {
  const list = Array.isArray(rows) ? rows : [];
  const n = unreadCount(list), m = list.filter(r => entryMarked(r, keys)).length;
  const out = [{value: 'unread', label: `안 읽음 ${n}`}, {value: 'all', label: '전체'}, {value: 'marks', label: m ? `밑줄 ${m}` : '밑줄'}];
  if (newsOn) { const k = list.filter(entryNews).length; out.push({value: 'news', label: k ? `News ${k}` : 'News'}); }
  return out;
}
// 좌우 밀기: 지금 칩에서 옆 칩으로(끝에서는 그대로).
export function nextFilter(current, dir, newsOn = false) {
  const all = filtersOf(newsOn), i = all.indexOf(keepFilter(current, newsOn)), j = Math.min(all.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)));
  return all[j];
}
// 빈 목록 한 줄.
export function emptyText(filter, total) {
  if (filter === 'news') return 'News에서 보관한 글이 없어요';
  if (!total) return '읽을 거리가 없어요 — [+ 추가]에 주소를 넣거나 폰에서 공유 → 읽을 거리';
  if (filter === 'marks') return '밑줄을 그은 글이 없어요';
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
const FAIL_STATE = {robots: 'robots', bot_check: 'bot_check', paywall: 'paywall', too_big: 'too_big', blocked: 'blocked', redirect: 'blocked'};
export function bodyPatch(result, nowIso = new Date().toISOString()) {
  const outcome = resultOutcome(result);
  const meta = {};
  const title = oneLine(result?.title, TITLE_MAX), site = oneLine(result?.site, SITE_MAX);
  if (title) meta.title = title;
  if (site) meta.site = site;
  if (outcome.state === 'ok') {
    const body = bodyText(result?.blocks);
    if (body) return {...meta, body, body_state: outcome.reason === 'lead' ? 'paywall' : 'ok', body_at: nowIso};
    return {...meta, body: null, body_state: 'failed', body_at: nowIso};
  }
  return {...meta, body: null, body_state: FAIL_STATE[outcome.reason] || 'failed', body_at: nowIso};
}
// 이미 사람이 단 제목이 있으면 원문 제목으로 덮지 않는다(사이트도 같음).
export function keepOwn(row, patch) {
  const out = {...patch};
  if (row?.title && out.title) delete out.title;
  if (row?.site && row.site !== hostOf(row?.url) && out.site) delete out.site;
  return out;
}

// 원문 사본 상태 한 줄(원래 페이지 링크는 화면이 늘 따로 보인다). ok면 ''.
export function stateLine(row, {busy = false} = {}) {
  const s = BODY_STATES.includes(row?.body_state) ? row.body_state : 'pending';
  if (busy) return '원문을 가져오는 중…';
  if (s === 'ok') return '';
  if (s === 'pending') return '원문을 아직 가져오지 않았어요.';
  if (s === 'paywall') return row?.body ? '공개된 앞부분만 가져왔어요.' : failInfo('paywall').text;
  return failInfo(s === 'failed' ? 'no_body' : s).text;
}
// 다시 가져오기 버튼을 보일까(막힌 주소·너무 큰 글은 다시 해도 같음).
export const canRetry = row => !['ok', 'blocked', 'too_big'].includes(row?.body_state);
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
