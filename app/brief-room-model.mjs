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
    return { kind: 'making', text: t ? `만드는 중 ${Math.min(n, t)}/${t}` : '만드는 중', date: '' };
  }
  if (row.status === 'done' && row.brief && typeof row.brief.lead === 'string') return { kind: 'done', text: row.brief.lead, date: md(row.finished_at || row.updated_at) };
  return { kind: 'failed', text: errorLine(row.error_code), date: '' };
}

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
