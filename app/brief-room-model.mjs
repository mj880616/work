// BRIEF-브리핑룸 ③ 화면 모델(설계 docs/design/brief-room.md 6절, 시안 docs/design/mockups/brief-room.html). DOM·네트워크 없음.
// 화면(brief-room.js)은 이 모듈이 돌려준 글자를 textContent로만 넣는다.
import { shortListDate } from './short-date.mjs';
export const BRIEF_FOLDER = '브리핑 요청함';
export const BRIEF_POLL_MS = 4000;
export const BRIEF_STALE_MS = 30 * 1000;   // 서버 brief-run.mjs BRIEF_STALE_MS와 같은 값
export const BRIEF_SELECT = 'id,document_id,status,stage,step_no,step_total,page_count,brief,error_code,created_at,updated_at,finished_at,lease_until';
// S70-27: 손으로 고친 한 장(DB 20261125143000). 적용 전(칸 없음 400)이면 화면이 BRIEF_SELECT로 다시 읽고 [고치기]만 끈다.
export const BRIEF_SELECT_EDIT = `${BRIEF_SELECT},edited,edited_at`;
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

// S68-44(명진 11/23 11:42·11:45): 다 된 줄의 날짜가 '11/20'이면 '만드는 중 17/22' 진행 칸 수와 같은 자리·같은 모양이라 멈춘 진행으로 읽혔다.
// 날짜는 노트 목록과 같은 공용 표기(short-date.mjs: 올해 '11.20', 다른 해 '25.11.20', 서울 시간)로 쓴다. 진행 'n/m'은 그대로.
export const doneDate = (iso, now = new Date()) => (iso ? shortListDate(iso, now) : '');

/**
 * 목록 한 줄의 상태. row = 그 자료의 가장 최근 브리핑 행(없으면 null).
 * @returns {{kind:'start'|'making'|'done'|'failed', text:string, date:string}}
 */
export function rowState(row, now = new Date()) {
  if (!row) return { kind: 'start', text: '', date: '' };
  if (row.status === 'queued' || row.status === 'running') {
    const n = Number(row.step_no) || 0, t = Number(row.step_total) || 0;
    // read 단계(큰 파일 나눠 읽기)는 '파일 읽기 n/t', 그 뒤는 '만드는 중 n/t'.
    const word = row.stage === 'read' ? '파일 읽기' : '만드는 중';
    return { kind: 'making', text: t ? `${word} ${Math.min(n, t)}/${t}` : '만드는 중', date: '' };
  }
  // S70-27: 손으로 고친 한 장(edited)이 있으면 그 요지(brief-edit-model.mjs shownBrief와 같은 규칙).
  const shown = row.edited && typeof row.edited === 'object' && !Array.isArray(row.edited) ? row.edited : row.brief;
  if (row.status === 'done' && row.brief && shown && typeof shown.lead === 'string') return { kind: 'done', text: shown.lead, date: doneDate(row.finished_at || row.updated_at, now) };
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

// S68-56(명진 11/23 15:06·15:12 "챙길 일에 집착하지 마 / 미리 정해 놓은 칸에 우겨넣지 말고 걍 요약"):
// 보기 = 요지 1~3줄(옅은 띠) → AI가 자료 짜임대로 정한 소제목별 항목(앞 SHOW_N개 소제목만 펼침, 나머지 접힘) → 원문 인용(접힘).
// 칸 이름(챙길 일·우리 조직 관련·대응할 것)은 화면이 정하지 않는다. '우리 관련'은 항목 옆 작은 표시만(서버가 확실할 때만 남김).
export const SHOW_N = 3;
export const GIST_TITLE = '요지';
export const QUOTES_TITLE = '원문 인용';
export const OURS_TAG = '우리 관련';
// BRIEF-품질올리기('더 깊게', 운영자 기능 brief_plus): 새 칸 이름. 칸이 없는 브리핑(지금 것·다른 사람)은 그리지 않는다.
export const PLUS_TITLES = Object.freeze({ core: '짜임', issues: '쟁점', mismatches: '문서 안 불일치·확인 필요', background: '배경 지식' });
export const CHECK_TAG = '확인 필요';
export const LENS_LABEL = '쟁점 관점';
export const LENS_HINT = '브리핑의 쟁점을 어떤 눈으로 볼지 적어요. 비우면 기본 관점으로 봐요.';
/** 불일치 한 줄: '시행일: 공포 후 6개월(주요 내용) ↔ 공포 후 1년(부칙 제1조)'. */
export const mismatchLine = mm => `${mm.what}: ${mm.a.value}${mm.a.ref ? `(${mm.a.ref})` : ''} ↔ ${mm.b.value}${mm.b.ref ? `(${mm.b.ref})` : ''}`;
export const moreLabel = n => `+ ${n}개 더 보기`;
const strs = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : []);
const str = v => (typeof v === 'string' ? v.trim() : '');
const pageOf = p => (Number.isInteger(p) && p > 0 ? p : null);
/** 앞 SHOW_N개와 나머지. */
export const splitShown = (items, n = SHOW_N) => ({ shown: items.slice(0, n), rest: items.slice(n) });

// 옛 형식 칸 → 소제목. 옛 칸 이름을 그대로 쓰되(v1 화면 이름의 짧은 꼴), '챙길 일'처럼 해석을 붙이지 않는다.
const LEGACY_TITLES = Object.freeze({ touches: '닿는 것', orgs: '닿는 것', todos: '할 일·기한·숫자', conflicts: '부딪히는 대목', counters: '부딪히는 대목' });
const item = text => ({ text, page: null, ours: false });

/**
 * 브리핑 보기 모델. v3(S68-56)는 그대로, 옛 형식(v1: 글 줄 칸, v2: S68-45 칸)은 읽을 때만 같은 모양으로 옮긴다(저장된 행은 바꾸지 않음).
 * @returns {{gist: string[], sections: {title:string, items:{text:string,page:number|null,ours:boolean}[]}[], quotes: {text:string,speaker:string,heading:string,page:number|null}[], legacy: boolean}}
 */
export function briefView(brief) {
  const b = brief && typeof brief === 'object' ? brief : {};
  const legacy = b.v !== 3;
  let gist = strs(legacy ? (b.v === 2 ? b.glance : []) : b.gist).slice(0, 3);
  if (!gist.length && str(b.lead)) gist = [str(b.lead)];
  let sections;
  if (!legacy) {
    sections = (Array.isArray(b.sections) ? b.sections : []).map(sec => ({
      title: str(sec?.title),
      items: (Array.isArray(sec?.items) ? sec.items : []).filter(it => it && str(it.text)).map(it => ({ text: str(it.text), page: pageOf(it.page), ours: it.ours === true, ...(str(it.ref) ? { ref: str(it.ref) } : {}) })),
    })).filter(sec => sec.items.length);
  } else if (b.v === 2) {
    const objs = v => (Array.isArray(v) ? v.filter(o => o && typeof o === 'object') : []);
    sections = [
      { key: 'todos', items: objs(b.todos).filter(t => str(t.text)).map(t => item(str(t.due) ? `${str(t.due)} · ${str(t.text)}` : str(t.text))) },
      { key: 'orgs', items: objs(b.orgs).filter(o => str(o.text)).map(o => item(str(o.name) ? `${str(o.name)} · ${str(o.text)}` : str(o.text))) },
      { key: 'counters', items: objs(b.counters).filter(c => str(c.claim)).map(c => item(str(c.reply) ? `${str(c.claim)} → ${str(c.reply)}` : str(c.claim))) },
    ].filter(x => x.items.length).map(x => ({ title: LEGACY_TITLES[x.key], items: x.items }));
  } else {
    sections = ['touches', 'todos', 'conflicts'].map(k => ({ title: LEGACY_TITLES[k], items: strs(b[k]).map(item) })).filter(x => x.items.length);
  }
  const quotes = (Array.isArray(b.quotes) ? b.quotes : [])
    .filter(q => q && typeof q.text === 'string' && q.text)
    .map(q => ({ text: q.text, speaker: str(q.speaker), heading: str(q.heading), page: pageOf(q.page) }));
  return { gist, sections, quotes, legacy, plus: legacy ? null : plusView(b.plus) };
}

/** '더 깊게' 칸(서버가 검사한 값). 없거나 모두 비면 null. */
export function plusView(p) {
  if (!p || typeof p !== 'object') return null;
  const objs = v => (Array.isArray(v) ? v.filter(o => o && typeof o === 'object') : []);
  const side = s => (s && typeof s === 'object' && str(s.value) ? { value: str(s.value), ref: str(s.ref) } : null);
  const core = str(p.core);
  const issues = objs(p.issues).filter(o => str(o.text)).map(o => ({ text: str(o.text), why: str(o.why), ref: str(o.ref) }));
  const mismatches = objs(p.mismatches).map(o => ({ what: str(o.what), a: side(o.a), b: side(o.b), note: str(o.note) })).filter(o => o.what && o.a && o.b);
  const background = objs(p.background).filter(o => str(o.text)).map(o => ({ text: str(o.text) }));
  if (!core && !issues.length && !mismatches.length && !background.length) return null;
  return { core, issues, mismatches, background };
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
export function deleteConfirm(kind, n, name = '', { keep = 0 } = {}) {
  const what = n > 1 ? `${n}개` : `“${String(name || '이름 없는 자료')}”`;
  // 밀기 [삭제]: 브리핑과 자료를 함께 삭제한다. 자료실에 이미 있던 자료(keep)는 자료를 남기고 브리핑만 삭제한다.
  if (kind === 'auto') {
    if (keep >= n) return { text: `${what} 브리핑을 삭제할까요?`, note: '자료실에 있던 자료라 자료는 삭제하지 않고 그대로 남아요.', ok: '삭제', danger: true };
    return { text: `${what} 브리핑과 자료를 삭제할까요?`, note: keep ? `자료실에 있던 자료 ${keep}개는 삭제하지 않아요. 나머지는 자료실에서도 빠지고 Drive 파일은 휴지통으로 옮겨요(30일 뒤 사라짐).` : '자료실에서도 빠지고 Drive 파일은 휴지통으로 옮겨요(30일 뒤 사라짐).', ok: '삭제', danger: true };
  }
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

// S69-86 BRIEF-밑줄노트(명진 11/25 00:50 "브리핑 밑줄 저장, 답글 달기(노트에 메모로 저장), 보관(노트로 보관) … 브리핑룸에서 없애도 파생 저장은 남기게").
// 밑줄·답글·보관 노트는 모두 글을 복사해 넣는다(브리핑·자료를 가리키는 연결 없음 — 지워도 남는다). 출처는 '브리핑 · 날짜 · 자료 이름' 글자로만.
// 원래 주소(Drive)는 넣지 않는다: 자료까지 삭제하면 Drive 파일이 휴지통으로 가 주소가 죽기 때문. 다시 찾아가는 길은 노트 › 밑줄 [원문에서 보기]뿐이고,
// 브리핑이 사라졌으면 그 길만 꺼진다(알림 한 줄).
export const BRIEF_MEDIA = '브리핑';
export const ARCHIVE_LABEL = '노트로 보관';
export const BRIEF_GONE = '원래 브리핑이 없어요 · 밑줄은 그대로 남아 있어요';
/** 밑줄 출처(text-highlights cleanSource 모양). source_id = 자료(app_documents.id) — 브리핑을 다시 만들어도 같은 자료면 같은 밑줄을 찾는다. */
export function briefSource(doc, row) {
  if (!doc?.id) return null;
  return { type: 'brief', id: doc.id, title: String(doc.title || doc.file_name || '이름 없는 자료'), media: BRIEF_MEDIA, date: row?.finished_at || row?.updated_at || null, url: null };
}
const kstDay = iso => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return ''; const d = new Date(t + 9 * 3600e3); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const quoteLines = text => String(text).trim().split('\n').map(l => `> ${l}`).join('\n');
/**
 * [노트로 보관]: 브리핑 한 장(요지·소제목별 줄·원문 인용) + 이 자료에서 저장한 밑줄(메모 포함)을 노트 한 장(마크다운)으로.
 * @param {{doc:object, row:object, marks?:object[]}} a  row = app_document_briefs 줄(brief·finished_at·page_count), marks = 이 자료 밑줄(새 것이 위)
 * @returns {{title:string, raw_text:string}|null}
 */
export function archiveNote({ doc, row, marks = [] } = {}) {
  if (!doc?.id || !row?.brief) return null;
  const name = String(doc.title || doc.file_name || '이름 없는 자료').trim();
  // S70-27: 손으로 고친 한 장이 있으면 그것을 보관한다(화면에 보이는 글 그대로).
  const v = briefView(row.edited && typeof row.edited === 'object' && !Array.isArray(row.edited) ? row.edited : row.brief);
  const out = [`출처: ${[BRIEF_MEDIA, kstDay(row.finished_at || row.updated_at), name].filter(Boolean).join(' · ')}`];
  const meta = [fileBadge(doc.file_name, doc.mime_type), row.page_count ? `${row.page_count}쪽` : ''].filter(Boolean).join(' · ');
  if (meta) out[0] += ` (${meta})`;
  if (v.gist.length) out.push(`## ${GIST_TITLE}\n\n${v.gist.join('\n\n')}`);
  if (v.plus?.core) out.push(`${PLUS_TITLES.core}: ${v.plus.core}`);
  for (const sec of v.sections) {
    const lines = sec.items.map(it => `- ${it.text}${it.ours ? ` (${OURS_TAG})` : ''}${it.ref ? ` · ${it.ref}` : ''}${it.page ? ` · ${it.page}쪽` : ''}`).join('\n');
    out.push(sec.title ? `## ${sec.title}\n\n${lines}` : lines);
  }
  // BRIEF-품질올리기: '더 깊게' 칸도 화면 순서 그대로 보관한다.
  if (v.plus?.issues.length) out.push(`## ${PLUS_TITLES.issues}\n\n${v.plus.issues.map((it, i) => `${i + 1}. ${it.text}${it.ref ? ` · ${it.ref}` : ''}${it.why ? `\n   - ${it.why}` : ''}`).join('\n')}`);
  if (v.plus?.mismatches.length) out.push(`## ${PLUS_TITLES.mismatches}\n\n${v.plus.mismatches.map(mm => `- ${mismatchLine(mm)}${mm.note ? `\n  - ${mm.note}` : ''}`).join('\n')}`);
  if (v.plus?.background.length) out.push(`## ${PLUS_TITLES.background} (${CHECK_TAG})\n\n${v.plus.background.map(it => `- ${it.text}`).join('\n')}`);
  if (v.quotes.length) {
    out.push(`## ${QUOTES_TITLE}\n\n${v.quotes.map(q => {
      const tail = [q.speaker, q.page ? `${q.page}쪽` : '', q.heading].filter(Boolean).join(' · ');
      return `${quoteLines(`“${q.text}”`)}${tail ? `\n\n— ${tail}` : ''}`;
    }).join('\n\n')}`);
  }
  const hl = (Array.isArray(marks) ? marks : []).filter(h => h && typeof h.quote === 'string' && h.quote.trim()).slice().reverse();
  if (hl.length) out.push(`## 밑줄 ${hl.length}\n\n${hl.map(h => `${quoteLines(h.quote)}${h.memo ? `\n\n메모: ${String(h.memo).trim()}` : ''}`).join('\n\n')}`);
  return { title: `${BRIEF_MEDIA} · ${name}`.slice(0, 80), raw_text: out.join('\n\n') };
}
