// NOTE-주소로 가져오기 2단계(화면, 설계 docs/design/note-import-by-url.md 2절·9절): 화면·서버를 모르는 순수 부품.
// - 주소 칸에 넣은 글 → 서버에 보낼 주소 하나(https만. http는 막는다 — 2026-11-11 명진 결정).
// - 서버(Edge note-import)가 준 블록 {t:'p'|'h'|'quote', text} → 편집기 저장 모양(ed1). 글자는 글자 노드로만 넣는다(HTML로 넣지 않음).
// - 원문 정보: 노트 행의 기존 metadata 칸 안 source = {url, site, author, published_at, fetched_at, state, reason, kept}(DB 변경 없음).
// - 실패 이유별 안내 한 줄(일상어)과 [다시 시도]를 보일지.
// - 뒤처리 줄: 한 번에 하나씩 차례로(처리 중에 또 와도 거절하지 않고 줄 세움). 기기에 아무것도 저장하지 않는다(메모리뿐).
import {cleanDoc, DEFAULT_BODY} from './ed-schema.mjs';
import {toPlain} from './ed-text.mjs';

export const IMPORT_URL_MAX = 2000;
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 100000;
export const SOURCE_STATES = Object.freeze(['fetching', 'ok', 'failed']);
const NAME_MAX = 120;

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
// 한 줄 글자: 줄바꿈·탭·제어 글자를 빈칸 하나로, 앞뒤 빈칸 없이, 글자 수(유니코드) 상한까지.
const oneLine = (v, max) => typeof v === 'string' ? [...v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim() : '';

// https 주소만 통과시킨다(아이디·비밀번호가 든 주소도 막는다). 통과하면 다듬은 주소, 아니면 ''.
export function safeHttps(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > IMPORT_URL_MAX) return '';
  let url;
  try { url = new URL(value.trim()); } catch { return ''; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
  return url.href;
}

// 주소 칸에 넣은 글 → {ok:true, url} 또는 {ok:false, message}. 서버가 같은 것을 다시(더 엄격하게) 본다: 여기는 바로 알려 주기 위한 앞 확인이다.
export function readImportUrl(text) {
  const value = String(text ?? '').trim();
  if (!value) return {ok: false, message: '주소를 넣어 주세요.'};
  if (/\s/.test(value)) return {ok: false, message: '주소는 하나만 넣어 주세요.'};
  if (value.length > IMPORT_URL_MAX) return {ok: false, message: '주소가 너무 길어요.'};
  if (/^http:\/\//i.test(value)) return {ok: false, message: 'http 주소는 가져올 수 없어요. https로 시작하는 주소를 넣어 주세요.'};
  // 'news.example.com/글' 처럼 앞머리 없이 넣은 주소는 https로 본다.
  const full = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value;
  const url = safeHttps(full);
  if (!url || !new URL(url).hostname.includes('.')) return {ok: false, message: '이 주소는 가져올 수 없어요. 주소를 다시 확인해 주세요.'};
  return {ok: true, url};
}

// 주소의 사이트 이름(앞의 www.는 뺌). 주소가 아니면 ''.
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}
// 원문 줄에 보일 짧은 주소: 사이트 이름 + 경로(물음표 뒤는 뺌), 길면 뒤를 줄임.
export function shortAddress(url, max = 60) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  let path = u.pathname === '/' ? '' : u.pathname;
  try { path = decodeURI(path); } catch { /* 그대로 둔다 */ }
  const chars = [...(hostOf(url) + path)];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

// ---- 원문 정보(metadata.source) ----
const isoOrNull = v => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null;
const reasonOrNull = v => typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : null;

// 저장할 원문 정보를 만든다(모르는 칸은 넣지 않음). 주소가 https가 아니면 null.
export function makeSource({url, site, author, published_at, fetched_at, state, reason, kept} = {}) {
  const safe = safeHttps(url);
  if (!safe || !SOURCE_STATES.includes(state)) return null;
  const out = {url: safe, state};
  const s = oneLine(site, NAME_MAX), a = oneLine(author, NAME_MAX), p = isoOrNull(published_at), f = isoOrNull(fetched_at), r = reasonOrNull(reason);
  if (s) out.site = s;
  if (a) out.author = a;
  if (p) out.published_at = p;
  if (f) out.fetched_at = f;
  if (r) out.reason = r;
  if (kept === true) out.kept = true;
  return out;
}
// 노트 행에서 원문 정보를 읽는다(모양이 다르면 null: 화면은 그 노트를 보통 노트로 본다).
export function noteSource(note) {
  const m = isObject(note?.metadata) ? note.metadata.source : null;
  return isObject(m) ? makeSource(m) : null;
}
// 가져오기로 만든 뒤 아직 '주소만' 들어 있는 노트인가(본문이 그 주소 그대로). 사람이 본문을 고쳤으면 가져온 글로 덮지 않는다.
export function isUrlOnly(note, source = noteSource(note)) {
  return !!source && String(note?.raw_text ?? '').trim() === source.url;
}
// '주소만' 노트의 본문(저장 모양)과 제목.
export function urlOnlyDoc(url) {
  return cleanDoc({type: 'doc', content: [{type: 'paragraph', attrs: {style: DEFAULT_BODY}, content: [{type: 'text', text: url}]}]});
}
export const urlOnlyTitle = url => oneLine(hostOf(url), NOTE_TITLE_MAX) || '가져온 글';

// ---- 서버가 준 글 → 노트 ----
// 블록 → 저장 모양. 문단·소제목·인용만 받고(사진 등 다른 블록은 1단계에서 뺌), 글자는 글자 노드로만 넣는다.
export function blocksToDoc(blocks) {
  const content = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!isObject(block) || typeof block.text !== 'string') continue;
    const lines = block.text.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+$/, '')).filter(line => line.trim());
    if (!lines.length) continue;
    const inline = [];
    lines.forEach((line, i) => { if (i) inline.push({type: 'hard_break'}); inline.push({type: 'text', text: line}); });
    const paragraph = {type: 'paragraph', attrs: {style: DEFAULT_BODY}, content: inline};
    if (block.t === 'h') content.push({type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: lines.join(' ')}]});
    else if (block.t === 'quote') content.push({type: 'blockquote', content: [paragraph]});
    else if (block.t === 'p') content.push(paragraph);
  }
  return content.length ? cleanDoc({type: 'doc', content}) : null;
}
// 서버 결과 → 노트에 넣을 것 {title, doc, text}. 본문이 없으면 null. 노트 글자 상한을 넘으면 뒤 블록부터 뺀다.
export function importedNote(result, url) {
  let blocks = Array.isArray(result?.blocks) ? result.blocks.slice() : [];
  let doc = blocksToDoc(blocks), text = doc ? toPlain(doc) : '';
  while (doc && [...text].length > NOTE_BODY_MAX && blocks.length > 1) {
    blocks = blocks.slice(0, Math.max(1, Math.floor(blocks.length * 0.9)));
    doc = blocksToDoc(blocks); text = doc ? toPlain(doc) : '';
  }
  if (!doc || !text.trim() || [...text].length > NOTE_BODY_MAX) return null;
  return {title: importedTitle(result, url), doc, text};
}
// 노트 제목: 글 제목 → 사이트 이름 → 주소의 사이트 이름.
export function importedTitle(result, url) {
  return oneLine(result?.title, NOTE_TITLE_MAX) || oneLine(result?.site, NOTE_TITLE_MAX) || urlOnlyTitle(url);
}

// ---- 안내 글(일상어) ----
// 서버 reason(9절) + 화면이 붙이는 이유: daily_limit(하루 횟수) · login(로그인 만료) · forbidden · busy(서버·연결 문제) · stopped(앱을 닫아 끊김) · changed(그사이 노트를 수정함).
const FAIL = {
  blocked: ['이 주소는 가져올 수 없어요. 주소를 다시 확인해 주세요.', false],
  redirect: ['이 주소는 가져올 수 없어요. 주소를 다시 확인해 주세요.', false],
  not_found: ['이 주소에서 글을 찾지 못했어요. 주소를 다시 확인해 주세요.', false],
  robots: ['가져오지 못했어요. 이 사이트가 읽기를 막아 두었어요.', false],
  bot_check: ['가져오지 못했어요. 이 사이트가 읽기를 막아 두었어요.', false],
  paywall: ['가져오지 못했어요. 이 사이트가 읽기를 막아 두었어요.', false],
  unreachable: ['사이트가 답하지 않아요. 잠시 뒤 다시 시도해 주세요.', true],
  timeout: ['사이트가 답하지 않아요. 잠시 뒤 다시 시도해 주세요.', true],
  http_error: ['사이트가 답하지 않아요. 잠시 뒤 다시 시도해 주세요.', true],
  too_big: ['글이 너무 커서 가져오지 못했어요.', false],
  not_text: ['글을 찾지 못했어요. 주소만 남겨 둘게요.', false],
  no_body: ['글을 찾지 못했어요. 주소만 남겨 둘게요.', false],
  daily_limit: ['오늘은 더 가져올 수 없어요. 내일 다시 해 주세요.', true],
  login: ['로그인이 풀렸어요. 다시 로그인한 뒤 [다시 시도]를 눌러 주세요.', true],
  forbidden: ['이 계정으로는 가져올 수 없어요.', false],
  busy: ['지금은 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.', true],
  stopped: ['가져오다가 멈췄어요. [다시 시도]를 눌러 주세요.', true],
  changed: ['그사이 노트를 수정해서 가져온 글을 넣지 않았어요.', false],
};
export function failInfo(reason) {
  const [text, retry] = FAIL[reason] || FAIL.busy;
  return {text, retry};
}
// 우리 서버 요청이 실패했을 때(읽기 결과가 아니라 요청 자체): 오류 → 이유.
export function requestFailReason(error) {
  const status = Number(error?.status) || 0, code = String(error?.code || ''), message = String(error?.message || '');
  if (code === 'session_required' || code === 'session_changed' || status === 401) return 'login';
  if (status === 429 || /DAILY_LIMIT/.test(message)) return 'daily_limit';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 413) return 'blocked';
  return 'busy';
}
// 서버 결과 → {state:'ok'|'failed', reason}. 앞부분만 온 글(lead)은 넣되 reason에 남긴다.
export function resultOutcome(result) {
  if (!isObject(result) || result.ok !== true) return {state: 'failed', reason: 'busy'};
  if (result.state === 'ok') return {state: 'ok', reason: result.truncated === true ? 'cut' : null};
  if (result.state === 'lead') return {state: 'ok', reason: 'lead'};
  return {state: 'failed', reason: reasonOrNull(result.reason) && FAIL[result.reason] ? result.reason : 'busy'};
}
// 끝났을 때 작은 알림 글.
export function doneText(reason) {
  return reason === 'lead' ? '공개된 앞부분만 가져왔어요.' : reason === 'cut' ? '글이 길어 앞부분만 가져왔어요.' : '글을 가져왔어요.';
}
// 날짜 글자(서울 기준): '2026. 11. 10.' / 가져온 날 '11. 11. 가져옴'.
function seoulParts(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 9 * 3600000);
  return {y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate()};
}
export function dayText(iso) { const p = seoulParts(iso); return p ? `${p.y}. ${p.m}. ${p.d}.` : ''; }
export function fetchedText(iso) { const p = seoulParts(iso); return p ? `${p.m}. ${p.d}. 가져옴` : ''; }
// 원문 줄 글자: '사이트 이름 · 짧은 주소'. 저자·발행일 줄: '저자 · 2026. 11. 10.'.
export function sourceLabel(source) {
  const address = shortAddress(source?.url || '');
  return source?.site && source.site !== hostOf(source.url) ? `${source.site} · ${address}` : address;
}
export function sourceByline(source) {
  return [source?.author || '', dayText(source?.published_at)].filter(Boolean).join(' · ');
}
// 목록 줄 제목(가져오는 중): '○○에서 가져오는 중…'.
export const busyTitle = source => `${hostOf(source?.url || '') || '주소'}에서 가져오는 중…`;

// ---- 뒤처리 줄 ----
// run(job) → Promise. 한 번에 하나씩, 온 순서대로. 처리 중에 또 오면 줄 끝에 선다. 같은 id가 이미 줄에 있으면 새로 세우지 않는다.
export function createImportQueue({run, report = () => {}}) {
  const waiting = [];
  let running = null, current = null;
  const tell = event => { try { report(event); } catch { /* 알림 하나가 줄을 막지 않는다 */ } };
  function pump() {
    if (running) return running;
    running = (async () => {
      while (waiting.length) {
        current = waiting.shift();
        tell({type: 'start', job: current});
        let outcome;
        try { outcome = await run(current); } catch (error) { outcome = {state: 'failed', reason: 'busy', error}; }
        const job = current; current = null;
        tell({type: 'done', job, outcome});
      }
    })().finally(() => { running = null; current = null; });
    return running;
  }
  const has = id => current?.id === id || waiting.some(job => job.id === id);
  return {
    add(job) {
      if (!job?.id || has(job.id)) return false;
      waiting.push(job);
      tell({type: 'queued', job, ahead: waiting.length - 1 + (current ? 1 : 0)});
      void pump();
      return true;
    },
    has,
    idle: () => running || Promise.resolve(),
    get size() { return waiting.length + (current ? 1 : 0); },
  };
}
