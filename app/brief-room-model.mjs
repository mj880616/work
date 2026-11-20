// BRIEF-브리핑룸 ③ 화면 모델(설계 docs/design/brief-room.md 6절, 시안 docs/design/mockups/brief-room.html). DOM·네트워크 없음.
// 화면(brief-room.js)은 이 모듈이 돌려준 글자를 textContent로만 넣는다.
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

/** 브리핑 다섯 칸(빈 칸은 빼지 않고 빈 배열). */
export function briefSections(brief) {
  const arr = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s) : []);
  const quotes = (Array.isArray(brief?.quotes) ? brief.quotes : [])
    .filter(q => q && typeof q.text === 'string' && q.text)
    .map(q => ({ text: q.text, heading: typeof q.heading === 'string' ? q.heading : '', why: typeof q.why === 'string' ? q.why : '', page: Number.isInteger(q.page) && q.page > 0 ? q.page : null }));
  return [
    { key: 'touches', title: '내 담당 조직·사업에 닿는 것', lines: arr(brief?.touches) },
    { key: 'todos', title: '해야 할 일·기한·숫자', lines: arr(brief?.todos) },
    { key: 'conflicts', title: '우리 쪽 주장과 부딪히는 대목', lines: arr(brief?.conflicts) },
    { key: 'quotes', title: '꼭 직접 읽을 대목', quotes },
  ];
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
export const PICK_RECENT = 50, PICK_FOUND = 100;
export const PICK_SECTIONS = Object.freeze({ all: '최근 자료', found: '찾은 자료' });
export function libraryPickRows({ docs, inRoom = new Set(), query = '' }) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const name = d => String(d?.title || d?.file_name || '이름 없는 자료');
  const all = [];
  let total = 0;
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || typeof d.id !== 'string') continue;
    total++;
    if (words.length) {
      const hay = `${d.title || ''} ${d.file_name || ''}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) continue;
    }
    if (all.length >= (words.length ? PICK_FOUND : PICK_RECENT)) continue;
    const here = inRoom.has(d.id), n = name(d);
    all.push({ id: d.id, name: n, label: n, depth: 0, enabled: !here, current: here });
  }
  return { recent: [], all, total };
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
