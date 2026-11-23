// BRIEF-브리핑룸 ③ 화면 모델(설계 docs/design/brief-room.md 6절, 시안 docs/design/mockups/brief-room.html). DOM·네트워크 없음.
// 화면(brief-room.js)은 이 모듈이 돌려준 글자를 textContent로만 넣는다.
import {word} from './brand/brand.mjs';
export const BRIEF_FOLDER = '브리핑 요청함';
export const BRIEF_POLL_MS = 4000;
export const BRIEF_STALE_MS = 30 * 1000;   // 서버 brief-run.mjs BRIEF_STALE_MS와 같은 값
export const BRIEF_SELECT = 'id,document_id,status,stage,step_no,step_total,page_count,brief,error_code,created_at,updated_at,finished_at,lease_until';
const ERRORS = Object.freeze({
  no_text: '글자를 읽을 수 없는 파일이에요',
  unsupported: '브리핑할 수 없는 형식이에요',
  too_large: '너무 큰 파일이에요',
  ai_monthly_cap: '이번 달 AI 사용 한도를 다 썼어요',
  usage_unavailable: 'AI 사용 기록을 확인하지 못했어요',
  ai_not_configured: 'AI 설정을 확인하지 못했어요',
  locked: '암호가 걸린 파일이라 읽을 수 없어요',
  read_failed: '파일을 끝까지 읽지 못했어요',
});
export const errorLine = code => ERRORS[code] || '브리핑을 만들지 못했어요';

const EXT = /\.([a-z0-9]{1,6})$/i;
/** 형식 꼬리표(PDF·HWP·DOC·…). */
export function fileBadge(name = '', mime = '') {
  const e = (String(name).match(EXT)?.[1] || '').toLowerCase();
  if (e === 'pdf' || mime === 'application/pdf') return 'PDF';
  if (e === 'hwp' || e === 'hwpx') return 'HWP';
  if (['doc', 'docx', 'odt', 'rtf'].includes(e)) return 'DOC';
  if (['ppt', 'pptx', 'odp'].includes(e)) return 'PPT';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(e)) return 'XLS';
  if (['txt', 'md'].includes(e)) return 'TXT';
  return e ? e.toUpperCase().slice(0, 4) : '파일';
}

/** 진행 중인데 서버가 멈춘 것(화면이 이어 달라고 부탁할 때). 서버 isStalled와 같은 기준. */
export function isStalled(row, nowMs) {
  if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
  const lease = row.lease_until ? Date.parse(row.lease_until) : 0;
  const upd = row.updated_at ? Date.parse(row.updated_at) : 0;
  return lease <= nowMs && nowMs - upd >= BRIEF_STALE_MS;
}

const md = iso => { const d = new Date(Date.parse(iso) + 9 * 3600 * 1000); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : ''; };

/**
 * 목록 한 줄의 상태. row = 그 자료의 가장 최근 브리핑 행(없으면 null).
 * @returns {{kind:'start'|'making'|'done'|'failed', text:string, date:string}}
 */
export function rowState(row) {
  if (!row) return { kind: 'start', text: '', date: '' };
  if (row.status === 'queued' || row.status === 'running') {
    const n = Number(row.step_no) || 0, t = Number(row.step_total) || 0;
    // read 단계(큰 파일 나눠 읽기)는 '파일 읽기 n/t', 그 뒤는 '만드는 중 n/t'.
    const word = row.stage === 'read' ? '파일 읽기' : '만드는 중';
    return { kind: 'making', text: t ? `${word} ${Math.min(n, t)}/${t}` : '만드는 중', date: '' };
  }
  if (row.status === 'done' && row.brief && typeof row.brief.lead === 'string') return { kind: 'done', text: row.brief.lead, date: md(row.finished_at || row.updated_at) };
  return { kind: 'failed', text: errorLine(row.error_code), date: '' };
}

// S67-37: 본문을 못 읽어 미리보기 글자(파일 앞부분)만으로 만든 브리핑이면 결과 위에 한 줄.
export const PARTIAL_LINE = '파일 앞부분만 읽고 만든 브리핑이에요';
export const partialLine = brief => (brief && brief.partial === 'preview' ? PARTIAL_LINE : '');
// 줄 ⋯ [다시 만들기]: 못 만든 줄만(같은 [브리핑 받기] 길 brief-start로 새 작업을 만든다).
export const RETRY_LABEL = '다시 만들기';
export const canRetry = row => !!row && row.status === 'failed';

/** 자료마다 가장 최근 브리핑 행 하나. rows는 created_at 내림차순. */
export function latestByDocument(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) if (r && typeof r.document_id === 'string' && !out.has(r.document_id)) out.set(r.document_id, r);
  return out;
}

/**
 * 목록: 브리핑 요청함 폴더 자료 + 브리핑이 있는 자료(다른 폴더에서 받은 것). 최근 것 먼저(브리핑 시각 또는 자료 시각).
 * @param {{docs: any[], folderIds: Set<string>, briefs: Map<string, any>}} p
 */
export function listRows({ docs, folderIds, briefs }) {
  const rows = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || typeof d.id !== 'string') continue;
    const b = briefs.get(d.id) || null;
    if (!folderIds.has(d.id) && !b) continue;
    rows.push({ doc: d, brief: b, state: rowState(b), at: Date.parse(b?.created_at || d.created_at || '') || 0 });
  }
  return rows.sort((a, b) => b.at - a.at);
}

// S67-50: 칸 이름은 단어표(app/brand/girok-words.mjs '#brief' 자리)를 거친다. 노동조합+ 얼굴은 지금 글자 그대로.
export const NO_SCOPE_LINE = '등록한 담당이 없어요';
// S68-45(명진 11/23 "직관적으로 문서가 딱 읽히지 않아", 시안 12:19 "ㄱㄱ"): 위에서 아래로 한눈에 3줄 → 챙길 일 → 우리 조직 관련 → 대응할 것 → 원문 인용(접힘).
// 칸마다 앞 SHOW_N개만 펼치고 나머지는 '+ n개 더 보기'. 빈 칸은 그리지 않는다(등록한 담당이 없을 때의 '우리 조직 관련' 한 줄만 예외 — S67-50).
export const SHOW_N = 3;
export const GLANCE_TITLE = '한눈에';
export const moreLabel = n => `+ ${n}개 더 보기`;
const strs = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : []);
const str = v => (typeof v === 'string' ? v.trim() : '');
const DAY = 24 * 3600 * 1000;
/**
 * 기한 꼬리표가 급한지(옅은 빨강). 서버(AI)가 urgent를 주면 그대로, 아니면 글자로: 오늘·내일·즉시·이번 주·일주일 내,
 * 또는 날짜(M/D·M월 D일·YYYY-MM-DD)가 오늘부터 7일 안(지난 날짜 포함). now는 시험용.
 */
export function dueUrgent(due, urgent = false, now = new Date()) {
  if (urgent === true) return true;
  const d = str(due);
  if (!d) return false;
  if (/오늘|내일|즉시|당장|이번\s?주|일주일\s?(?:내|안|이내)|7일\s?(?:내|안|이내)/.test(d)) return true;
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear(), today = Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate());
  let m = d.match(/(\d{4})[-.\/]\s?(\d{1,2})[-.\/]\s?(\d{1,2})/), at = null;
  if (m) at = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  else if ((m = d.match(/(\d{1,2})\s?(?:\/|월\s?)(\d{1,2})/))) {
    at = Date.UTC(y, +m[1] - 1, +m[2]);
    if (at < today - 180 * DAY) at = Date.UTC(y + 1, +m[1] - 1, +m[2]); // 12월에 본 '1/5'는 내년
  }
  if (at === null || !Number.isFinite(at)) return false;
  return at - today <= 7 * DAY;
}
/** 챙길 일 정렬: 급한 것 → 기한 있는 것 → 기한 없는 것. 같은 묶음 안은 서버(중요한 순) 순서 그대로. */
export function sortTodos(list, now = new Date()) {
  const rank = t => (t.urgent ? 0 : t.due ? 1 : 2);
  return list.map((t, i) => ({ ...t, urgent: dueUrgent(t.due, t.urgent, now), i })).sort((a, b) => rank(a) - rank(b) || a.i - b.i).map(({ i, ...t }) => t);
}
/** 앞 SHOW_N개와 나머지. */
export const splitShown = (items, n = SHOW_N) => ({ shown: items.slice(0, n), rest: items.slice(n) });

/**
 * 브리핑 보기 모델. 옛 형식(v1: touches·todos·conflicts 글 줄)도 읽을 때 새 칸으로 옮겨 보인다(저장된 행은 바꾸지 않음).
 * @returns {{glance: string[], sections: {key:'todos'|'orgs'|'counters'|'quotes', title:string, items:any[], empty?:string}[], legacy: boolean}}
 */
export function briefView(brief, now = new Date()) {
  const b = brief && typeof brief === 'object' ? brief : {};
  const legacy = b.v !== 2;
  const glance = (legacy ? [] : strs(b.glance)).slice(0, 3);
  if (!glance.length && str(b.lead)) glance.push(str(b.lead));
  const todos = legacy
    ? strs(b.todos).map(text => ({ due: '', text, urgent: false }))
    : (Array.isArray(b.todos) ? b.todos : []).filter(t => t && str(t.text)).map(t => ({ due: str(t.due), text: str(t.text), urgent: t.urgent === true }));
  const orgs = legacy
    ? strs(b.touches).map(text => ({ name: '', text }))
    : (Array.isArray(b.orgs) ? b.orgs : []).filter(o => o && str(o.text)).map(o => ({ name: str(o.name), text: str(o.text) }));
  const counters = legacy
    ? strs(b.conflicts).map(claim => ({ claim, reply: '' }))
    : (Array.isArray(b.counters) ? b.counters : []).filter(c => c && str(c.claim)).map(c => ({ claim: str(c.claim), reply: str(c.reply) }));
  const quotes = (Array.isArray(b.quotes) ? b.quotes : [])
    .filter(q => q && typeof q.text === 'string' && q.text)
    .map(q => ({ text: q.text, heading: str(q.heading), why: str(q.why), page: Number.isInteger(q.page) && q.page > 0 ? q.page : null }));
  const sections = [];
  if (todos.length) sections.push({ key: 'todos', title: '챙길 일', items: sortTodos(todos, now) });
  if (orgs.length) sections.push({ key: 'orgs', title: word('우리 조직 관련', 'brief'), items: orgs });
  else if (b.scope === 'none') sections.push({ key: 'orgs', title: word('우리 조직 관련', 'brief'), items: [], empty: NO_SCOPE_LINE });
  if (counters.length) sections.push({ key: 'counters', title: '대응할 것', items: counters });
  if (quotes.length) sections.push({ key: 'quotes', title: '원문 인용', items: quotes });
  return { glance, sections, legacy };
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
/** 원문 열기 주소. 쪽을 알면 PDF 미리 보기 쪽 표시(#page=n)를 붙인다([추정] Drive 미리 보기가 이 표시를 따르는지는 실기기 확인). */
export function sourceUrl(doc, page = null) {
  const id = String(doc?.file_id || '');
  const base = DRIVE_ID.test(id) ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : (/^https:\/\/(drive|docs)\.google\.com\//.test(String(doc?.drive_url || '')) ? String(doc.drive_url) : '');
  if (!base) return '';
  return page && fileBadge(doc?.file_name, doc?.mime_type) === 'PDF' ? `${base}#page=${page}` : base;
}

/** 시작 응답 오류 코드 → 한 줄. */
export function startError(code) {
  if (code === 'ai_monthly_cap') return '이번 달 AI 사용 한도를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.';
  if (code === 'not_found') return '자료를 찾을 수 없어요';
  return '브리핑을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
}

// BRIEF-브리핑룸삭제(S63-08, 명진 확정 11/16 10:55): 줄 ⋯·여러 개 선택에서 두 가지 삭제를 고른다.
// brief = 브리핑 결과만 삭제(자료는 자료실에 그대로, '브리핑 요청함' 폴더에 있었으면 폴더 밖으로), doc = 자료까지 삭제(자료실 삭제와 같은 길, Drive 휴지통).
export const DELETE_KINDS = Object.freeze({ brief: '브리핑만 삭제', doc: '자료까지 삭제' });
export function deleteConfirm(kind, n, name = '') {
  const what = n > 1 ? `${n}개` : `“${String(name || '이름 없는 자료')}”`;
  if (kind === 'doc') return { text: `${what} 자료까지 삭제할까요?`, note: '자료실에서도 빠지고 Drive 파일은 휴지통으로 옮겨요(30일 뒤 사라짐).', ok: '삭제', danger: true };
  return { text: `${what} 브리핑만 삭제할까요?`, note: '자료는 자료실에 그대로 남아요. 만드는 중이면 멈춰요.', ok: '삭제', danger: true };
}
export function deleteResult(kind, { done = 0, failed = 0, skipped = 0 } = {}) {
  const bad = failed + skipped, what = kind === 'doc' ? '자료를' : '브리핑을';
  if (!bad) return { text: done > 1 ? `${done}개 ${what} 삭제했어요` : `${what} 삭제했어요`, error: false };
  return { text: done ? `${done}개는 삭제했고 ${bad}개는 삭제하지 못했어요` : `${what} 삭제하지 못했어요`, error: true };
}

// BRIEF-자료실에서고르기(S64-10, 명진 11/17 09:31 "브리핑룸 이미 자료실에 있는 파일도 가능하게"):
// 브리핑 룸 [자료실에서 고르기] 창(공용 고르기 창 library-move-picker.js, 여러 개 고르기)에 보일 줄.
// 찾는 말이 없으면 최근 자료 PICK_RECENT개, 있으면 이름(제목·파일 이름)에 낱말이 모두 든 자료 PICK_FOUND개까지.
// 이미 브리핑 룸 목록에 있는 자료는 흐리게 '이미 있음'(고를 수 없음).
export const PICK_RECENT = 50, PICK_FOUND = 100, PICK_FOLDER = 200;
export const PICK_SECTIONS = Object.freeze({ all: '최근 자료', found: '찾은 자료' });
// S67-41(명진 11/20 18:10 "폴더도 보여야할 것같고 먼가 찾기쉽게"): 찾기 칸 아래 [최근]·[폴더] 두 보기.
export const PICK_VIEWS = Object.freeze([{ id: 'recent', label: '최근' }, { id: 'folder', label: '폴더' }]);
const IMAGE = /^(jpe?g|png|gif|webp|heic|heif|bmp)$/i;
/** 줄 앞 형식 꼬리표: 사진은 '사진', 나머지는 fileBadge(PDF·HWP·DOC…). */
export function pickKind(doc) {
  const e = (String(doc?.file_name || '').match(EXT)?.[1] || '');
  if (IMAGE.test(e) || /^image\//.test(String(doc?.mime_type || ''))) return '사진';
  return fileBadge(doc?.file_name, doc?.mime_type);
}
/** 올린 날짜 'M/D'(올해가 아니면 'YY.M/D'). now는 시험용. */
export function pickDate(iso, now = new Date()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600000), y = new Date(now.getTime() + 9 * 3600000).getUTCFullYear();
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return d.getUTCFullYear() === y ? md : `${String(d.getUTCFullYear()).slice(2)}.${md}`;
}
// 숫자뿐인 사진 이름(카메라·메신저가 붙인 이름: 20261105_123456.jpg, IMG_1234.jpg, KakaoTalk_2026…)은 '사진 · 날짜'로 보인다.
const CAMERA = /^(img|dsc|dscn|pxl|photo|screenshot|kakaotalk|mvimg)?[\s_\-.]*[\d\s_\-.()]+$/i;
/** 줄 이름 한 줄: 제목 → 파일 이름(확장자 뺌). 숫자뿐인 사진 이름은 '사진 · 날짜'. */
export function pickName(doc, now = new Date()) {
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  const file = clean(doc?.file_name), title = clean(doc?.title);
  // 제목이 파일 이름 그대로면(올릴 때 붙은 이름) 확장자를 뺀다. 사람이 쓴 제목은 그대로(예: '보고서 v1.2').
  const base = title && title !== file ? title : file.replace(EXT, '').trim();
  if (pickKind(doc) === '사진' && (!base || CAMERA.test(base))) { const day = pickDate(doc?.created_at, now); return day ? `사진 · ${day}` : '사진'; }
  return base || '이름 없는 자료';
}
const docRow = (d, inRoom, now) => {
  const here = inRoom.has(d.id), n = pickName(d, now);
  return { id: d.id, name: n, label: n, depth: 0, enabled: !here, current: here, kind: pickKind(d), meta: pickDate(d.created_at, now) };
};
const matcher = query => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? d => { const hay = `${d.title || ''} ${d.file_name || ''} ${pickName(d)}`.toLowerCase(); return words.every(w => hay.includes(w)); } : null;
};
/**
 * 고르기 창 줄. view 'recent'(기본): 찾는 말 없으면 최근 자료 PICK_RECENT개, 있으면 낱말이 모두 든 자료 PICK_FOUND개.
 * view 'folder': 찾는 말이 있으면 'recent'와 같은 찾기. 없으면 지금 폴더(folder, null = 맨 위)의 하위 폴더(들어가는 줄) → 그 폴더의 자료.
 * 맨 위에서는 폴더 밖 자료도 보인다. 폴더 순서는 자료실 나무와 같은 규칙(folderSiblings).
 * 이미 브리핑 룸 목록에 있는 자료는 흐리게 '이미 있음'(고를 수 없음).
 */
export function libraryPickRows({ docs, inRoom = new Set(), query = '', view = 'recent', folder = null, folders = [], itemFolder = new Map(), siblings = null, now = new Date() }) {
  const list = (Array.isArray(docs) ? docs : []).filter(d => d && typeof d.id === 'string');
  const match = matcher(query);
  if (view !== 'folder' || match) {
    const all = [];
    for (const d of list) {
      if (match && !match(d)) continue;
      if (all.length >= (match ? PICK_FOUND : PICK_RECENT)) break;
      all.push(docRow(d, inRoom, now));
    }
    return { recent: [], all, total: list.length };
  }
  const byId = new Map((folders || []).map(f => [f.id, f]));
  const here = folder && byId.has(folder) ? byId.get(folder) : null;
  const kids = typeof siblings === 'function' ? siblings(folders, here?.id || null) : (folders || []).filter(f => (f.parent_id || null) === (here?.id || null));
  const count = new Map();
  for (const [, f] of itemFolder) count.set(f, (count.get(f) || 0) + 1);
  const rows = [];
  if (here) { const up = here.parent_id && byId.has(here.parent_id) ? byId.get(here.parent_id) : null; rows.push({ nav: up?.id || '', back: true, name: up ? up.name : '자료실 맨 위', label: up ? up.name : '자료실 맨 위' }); }
  for (const f of kids) rows.push({ nav: f.id, id: f.id, name: f.name || '이름 없는 폴더', label: f.name || '이름 없는 폴더', color: f.color, meta: count.get(f.id) ? `${count.get(f.id)}` : '' });
  let shown = 0;
  for (const d of list) {
    if ((itemFolder.get(d.id) || null) !== (here?.id || null)) continue;
    if (shown++ >= PICK_FOLDER) break;
    rows.push(docRow(d, inRoom, now));
  }
  return { recent: [], all: rows, total: list.length, allLabel: here ? here.name || '이름 없는 폴더' : '자료실' };
}
/** 넣은 뒤 한 줄. added = 폴더에 넣은 수, kept = 다른 폴더에 있어 그대로 두고 목록에만 보인 수, failed = 못 넣은 수. */
export function pickResult({ added = 0, kept = 0, failed = 0 } = {}) {
  const n = added + kept;
  if (!n) return { text: '자료를 넣지 못했어요. 잠시 뒤 다시 해 주세요.', error: true };
  const parts = [`${n}개 넣었어요`];
  if (kept) parts.push(`${kept}개는 원래 폴더에 그대로 두었어요(브리핑을 받으면 계속 보여요)`);
  if (failed) parts.push(`${failed}개는 넣지 못했어요`);
  return { text: parts.join(' · '), error: failed > 0 };
}
