// PRIVACY-백업안내(S66-01, 시안 docs/design/mockups/backup-export.html, #2677 사용자 확정): '내 기록 백업'의 순수 부분.
// 무엇을 담는지(종류·표·읽는 조건), 표를 CSV·읽기용 글로 바꾸는 일, 오래된 백업 고르기. 네트워크·Drive·인증은 handler.ts가 한다.
// 이 파일은 Deno(Edge)와 Node 시험이 같이 읽는다.
//
// 담는 범위(설계 docs/design/collab-sharing.md 10.3):
// - 내 작업공간(서버가 정함)의 행만. 읽기는 사용자 로그인 토큰 + anon 키로 해서 기존 owner RLS를 그대로 지난다(서비스 역할로 기록을 읽지 않음).
// - 남이 공유한 대상의 내용은 넣지 않는다: 모든 읽기에 '내 작업공간' 조건을 붙인다(공유 표가 생겨 RLS가 넓어져도 남의 행은 안 들어옴).
// - 일정·할 일 원본은 Google(Calendar·Tasks)에 있다. 여기서는 노조+가 붙인 연결 기록만 담는다.
// - 자료실 파일 원본은 이미 내 드라이브에 있다. 여기서는 목록(이름·분류·드라이브 주소)만 담는다.
// - 텔레그램 하루 정리·통화 정리·가족 기록은 이번에 넣지 않는다: 그 표들은 '정해진 파일만 읽는다'는 격리 시험(family-notes·call-personal-box·tg-personal-days)이
//   지키는 표라, 넣으려면 그 허용 목록을 바꾸는 결정이 먼저다(PR 본문 '사용자 결정').
// - 비밀값·토큰이 든 표(드라이브·원드라이브 연결, 폰 기기 등)는 담지 않는다.

// 맨 위 폴더 이름(새로 만들 때만 고름)은 ../_shared/brand-folders.mjs FOLDER_NAMES.record_backup(S68-02).
export const KEEP_WEEKS = 4;            // 11/16 사용자 확정: 최근 4주만 보관(오래된 날짜 폴더는 드라이브 휴지통으로)
export const AUTO_EVERY_DAYS = 7;       // 매주 자동 백업
export const ROWS_PER_TABLE = 20000;    // 넘으면 잘린 백업을 만들지 않고 실패
export const DOC_BYTES = 3 * 1024 * 1024; // 읽기용 문서 상한(넘으면 문서는 건너뛰고 CSV만)
export const CELL_CHARS = 2000;         // 읽기용 문서의 한 칸 글자 상한(CSV는 자르지 않음)

const ws = { by: 'workspace' };
// join: 작업공간 칸이 없는 표는 부모 표를 거쳐 내 작업공간만(PostgREST !inner).
export const CATEGORIES = Object.freeze([
  { key: 'notes', label: '노트', tables: [
    { name: 'app_notes', label: '노트', ...ws },
    { name: 'app_note_folders', label: '노트 폴더', ...ws },
    { name: 'app_note_comments', label: '옛 노트 메모', ...ws },
    { name: 'app_memos', label: '메모', ...ws }, // S69-94 NOTE-메모통일: 노트·읽을 거리·저장한 글 메모(표가 아직 없으면 handler가 건너뜀)
  ] },
  { key: 'reports', label: '조직 보고 · 사업 보고', tables: [
    { name: 'app_suborganizations', label: '담당조직', ...ws },
    { name: 'app_suborganization_updates', label: '조직 보고', by: 'join', alias: 'o', parent: 'app_suborganizations', fk: 'organization_id' },
    { name: 'app_business_records', label: '사업 보고', ...ws },
    { name: 'app_org_key_people', label: '조직 주요 인물', ...ws },
    { name: 'app_dispute_stages', label: '쟁의 단계', ...ws },
  ] },
  { key: 'plans', label: '일정 · 할 일', note: '구글에 이미 있음', tables: [
    { name: 'app_record_links', label: '일정·할 일 연결', ...ws },
  ] },
  { key: 'meetings', label: '회의 · 주간 보고', tables: [
    { name: 'app_meetings', label: '회의', ...ws },
    { name: 'app_weekly_own_drafts', label: '주간 보고 초안', ...ws },
    { name: 'app_weekly_org_lines', label: '주간 보고 조직 줄', ...ws },
    { name: 'app_weekly_org_summaries', label: '주간 조직 요약', ...ws },
    { name: 'app_journal_drafts', label: '업무일지 초안', ...ws, order: 'journal_day' },
    { name: 'app_journal_next_week_sheets', label: '다음 주 계획', ...ws, order: 'week_start' },
    { name: 'app_pre_meeting_sheets', label: '회의 전 준비', ...ws, order: 'event_key' },
  ] },
  { key: 'projects', label: '프로젝트 · 자료 목록', note: '파일은 이미 내 드라이브에 있음', tables: [
    { name: 'app_spaces', label: '프로젝트', ...ws },
    { name: 'app_project_progress_updates', label: '프로젝트 진행 기록', by: 'join', alias: 'p', parent: 'app_spaces', fk: 'project_id' },
    { name: 'app_documents', label: '자료 목록', ...ws },
    { name: 'app_library_folders', label: '자료실 폴더', ...ws },
  ] },
  { key: 'ledger', label: '원장 · 뉴스 밑줄 · 프로필', tables: [
    { name: 'app_ledger_records', label: '원장 기록', ...ws },
    { name: 'app_ledger_topics', label: '원장 주제', ...ws },
    { name: 'app_ledger_organizations', label: '원장 조직', ...ws },
    { name: 'app_ledger_sources', label: '원장 근거 자료', ...ws },
    { name: 'app_ledger_record_sources', label: '원장 기록-근거', ...ws },
    { name: 'app_ledger_links', label: '원장 연결', ...ws },
    { name: 'app_news_highlights', label: '뉴스 밑줄', ...ws },
    { name: 'app_profiles', label: '프로필', by: 'user' },
  ] },
].map(c => Object.freeze({ ...c, tables: Object.freeze(c.tables.map(t => Object.freeze(t))) })));
export const KINDS = Object.freeze(CATEGORIES.map(c => c.key));

// 몸통 {kinds:[...]} 검사: 아는 종류만, 겹침 없이, 하나 이상. 다른 키가 있으면 거절.
export function parseKinds(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(k => k !== 'kinds')) return null;
  const list = body.kinds;
  if (!Array.isArray(list) || !list.length || list.length > KINDS.length) return null;
  if (!list.every(k => typeof k === 'string' && KINDS.includes(k)) || new Set(list).size !== list.length) return null;
  return KINDS.filter(k => list.includes(k)); // 순서는 서버 순서
}

// PostgREST 읽기 주소(표 이름·조건은 이 파일 목록에서만 온다. 작업공간·사용자 id는 서버가 확인한 값).
export function tableQuery(table, { workspaceId, userId }, { limit, offset, count = false } = {}) {
  const q = new URLSearchParams();
  if (table.by === 'join') {
    q.set('select', count ? `id,${table.alias}:${table.parent}!${table.fk}!inner(workspace_id)` : `*,${table.alias}:${table.parent}!${table.fk}!inner(workspace_id)`);
    q.set(`${table.alias}.workspace_id`, `eq.${workspaceId}`);
  } else if (table.by === 'user') {
    q.set('select', count ? 'user_id' : '*');
    q.set('user_id', `eq.${userId}`);
  } else {
    q.set('select', count ? 'workspace_id' : '*');
    q.set('workspace_id', `eq.${workspaceId}`);
  }
  // V67(11/19 '백업하지 못했어요'): id 칸이 없는 표(기본 키가 workspace_id+날짜 등)는 id로 줄 세우면 PostgREST가 400을 줘
  // RECORD_READ_FAILED로 백업 전체가 실패했다. 그런 표는 목록의 order(기본 키의 나머지 칸)로 줄 세운다.
  if (!count) q.set('order', table.by === 'user' ? 'user_id.asc' : `${table.order || 'id'}.asc`);
  if (limit != null) q.set('limit', String(limit));
  if (offset != null) q.set('offset', String(offset));
  return `${table.name}?${q}`;
}
// join으로 붙인 부모 칸은 백업에 넣지 않는다.
export const cleanRow = (table, row) => {
  if (table.by !== 'join' || !row || typeof row !== 'object') return row;
  const { [table.alias]: _drop, ...rest } = row;
  return rest;
};

const cellText = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
export function toCsv(rows) {
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (!cols.includes(k)) cols.push(k);
  const esc = s => /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map(c => esc(cellText(r?.[c]))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // 엑셀에서 한글이 깨지지 않게 BOM
}

const html = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 읽기 쉬운 글: 표마다 제목, 행마다 '칸: 값' 줄(빈 칸은 뺌). 이 앱을 그만 써도 구글 문서로 그대로 열린다.
// S68-21: 첫 줄의 앱 이름(appName)은 handler가 정한다(_shared/brand-folders.mjs appNameFor). S69-42: 누구나 'WORK ON+'.
// 이미 만든 백업 문서는 다시 쓰지 않는다(새로 만드는 문서만).
export function readableHtml(category, tables, date, appName = 'WORK ON+') {
  const parts = [`<h1>${html(category.label)} — ${html(date)} 백업</h1><p>${html(appName)}가 내 드라이브에 만든 백업입니다. 같은 내용의 표 파일(csv)이 같은 폴더에 있습니다.</p>`];
  for (const { table, rows } of tables) {
    parts.push(`<h2>${html(table.label)} (${rows.length}건)</h2>`);
    for (const r of rows) {
      const cells = Object.entries(r || {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
      parts.push(`<p>${cells.map(([k, v]) => `<b>${html(k)}</b>: ${html(cellText(v).slice(0, CELL_CHARS))}`).join('<br>')}</p><hr>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${parts.join('')}</body></html>`;
}

export const kstDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 날짜 폴더 중 최근 KEEP_WEEKS개만 남기고 나머지(오래된 것)를 고른다. 날짜 모양이 아닌 폴더는 건드리지 않는다.
export function foldersToTrash(folders, keep = KEEP_WEEKS) {
  const dated = folders.filter(f => DATE_RE.test(f?.appProperties?.kptu_backup_date || '')).sort((a, b) => b.appProperties.kptu_backup_date.localeCompare(a.appProperties.kptu_backup_date));
  return dated.slice(keep);
}
// 자동 백업 차례: 켜져 있고, 마지막 성공이 없거나 7일 이상 지났을 때.
export function autoDue(auto, lastAt, now) {
  if (auto !== true) return false;
  const at = Date.parse(lastAt || '');
  return !Number.isFinite(at) || now - at >= AUTO_EVERY_DAYS * 86400000;
}
