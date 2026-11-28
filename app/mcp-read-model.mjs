// MCP-Claude읽기 M-5(설계 docs/design/mcp-claude-read.md 2판 4.6·6절): Claude 연결 화면의 판정만 모은 곳(화면 없음, 시험이 직접 부른다).
// 쓰는 곳: 내 프로필 'Claude 연결' 칸(mcp-read-settings.js), 동의 화면(oauth-consent/consent.js).
// 화면 판정은 편의일 뿐이다. 실제 차단은 DB 문지기(private.app_mcp_gate)가 한다(설계 7.2).

// 되돌아갈 곳: claude.ai 커넥터의 되돌아올 주소 하나만(설계 4.5 표). 그 밖의 주소로는 보내지 않는다.
import {word} from './brand/brand.mjs';
export const CLAUDE_ORIGIN = 'https://claude.ai';
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

// Supabase Auth OAuth 2.1 서버의 동의 화면 입구(supabase/auth #2107: GET /oauth/authorizations/{id}, POST …/consent).
// 몸통 {action:'approve'|'deny'}와 응답 칸(redirect_url·client·redirect_uri·scope)은 supabase-js auth.oauth 구현에서 본 모양(추정, 설계 9절 M-7에서 확인).
export const authorizationPath = id => `/auth/v1/oauth/authorizations/${encodeURIComponent(id)}`;
export const consentPath = id => `${authorizationPath(id)}/consent`;

export const validAuthorizationId = id => typeof id === 'string' && /^[A-Za-z0-9._~-]{8,200}$/.test(id);

/** claude.ai로 가는 주소만 그대로 돌려준다. 그 밖(다른 사이트·http·javascript:)은 ''. */
export function safeClaudeRedirect(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const u = new URL(raw);
    if (u.origin !== CLAUDE_ORIGIN || u.username || u.password) return '';
    return u.href;
  } catch { return ''; }
}

/** 열쇠 몸통 읽기(서명 검사는 Auth 몫). 동의 화면은 일반 로그인 열쇠로만 연다 — 위임 열쇠(client_id 있음)면 거절. */
export function tokenClaims(token) {
  try {
    const part = String(token || '').split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch { return null; }
}
export const isDelegatedToken = token => {
  const c = tokenClaims(token);
  return !!c && c.client_id !== undefined && c.client_id !== null && c.client_id !== '';
};

// 3판(설계 15.2): 읽을 영역 스위치. 칸은 설정 행의 area_* 다섯 개, 가족 방만 기본 꺼짐. 실제 판정은 DB 문지기가 한다.
export const AREAS = Object.freeze([
  {key: 'diary', label: '하루 기록', desc: '그날 쓴 글·업무일지 줄·사진 이름'},
  {key: 'calls', label: '통화', desc: '요약·전사'},
  {key: 'recordings', label: '녹음', desc: '회의록 전문·회의 결과'},
  {key: 'basket', label: '정리함 원문', desc: 'AI 재료에서 뺀 것은 빼고'},
  {key: 'family', label: '가족 방', desc: '기본은 꺼짐 — 켜야 읽어요'},
]);
export const AREA_COLUMNS = AREAS.map(a => `area_${a.key}`);
const areaOn = (row, key) => key === 'family' ? row[`area_${key}`] === true : row[`area_${key}`] !== false;

// 내 프로필 칸에서 쓰는 설정 행. 행이 없으면(운영자 작업공간 말고는 SQL로 넣지 않음, 설계 7.6) 칸을 보이지 않는다.
export function settingsState(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== 'object') return null;
  return {
    workspaceId: String(row.workspace_id || ''),
    enabled: row.enabled === true,
    revokedBefore: row.revoked_before || null,
    allowedClientId: typeof row.allowed_client_id === 'string' ? row.allowed_client_id : null,
    areas: Object.fromEntries(AREAS.map(a => [a.key, areaOn(row, a.key)])),
  };
}

/** 동의 요청 정보(GET 응답) 정리. 이미 허락한 연결이면 Auth가 redirect_url만 준다. */
export function readDetails(data) {
  if (!data || typeof data !== 'object') return {kind: 'bad'};
  if (typeof data.authorization_id !== 'string' && typeof data.redirect_url === 'string') return {kind: 'redirect', url: safeClaudeRedirect(data.redirect_url)};
  const client = data.client && typeof data.client === 'object' ? data.client : {};
  return {
    kind: 'ask',
    clientId: String(client.client_id || client.id || ''),
    clientName: String(client.name || client.client_name || '').slice(0, 80),
    redirectUri: String(data.redirect_uri || ''),
    scope: String(data.scope || '').slice(0, 200),
  };
}

// 화면이 먼저 거절하는 경우(설계 4.6). 스위치가 꺼져 있는 것은 거절하지 않는다:
// 설계 9.1 순서가 '연결(허락) → 그다음 스위치 켜기'라서, 꺼진 채 허락하고 켜기 전까지는 DB가 모든 읽기를 거절한다.
export const REFUSE = Object.freeze({
  framed: '다른 화면 안에서는 열 수 없어요. 주소를 브라우저에서 직접 열어 주세요.',
  bad_request: '연결 요청이 올바르지 않아요. claude.ai에서 다시 연결해 주세요.',
  delegated: word('이 로그인으로는 허락할 수 없어요. WORK ON+에 다시 로그인해 주세요.'),
  not_owner: '내 작업공간이 있는 계정에서만 허락할 수 있어요.',
  not_ready: '이 계정은 Claude 연결을 쓰지 않아요.',
  client: '등록된 Claude 연결이 아니에요. 허락하지 마세요.',
  redirect: '되돌아갈 곳이 claude.ai가 아니에요. 허락하지 마세요.',
  failed: '연결 요청을 읽지 못했어요. claude.ai에서 다시 연결해 주세요.',
});

export function consentRefusal({details, owner, settings}) {
  if (!details || details.kind !== 'ask') return 'bad_request';
  if (!owner) return 'not_owner';
  if (!settings) return 'not_ready';
  if (details.redirectUri !== CLAUDE_CALLBACK) return 'redirect';
  if (settings.allowedClientId) { if (details.clientId !== settings.allowedClientId) return 'client'; }
  else if (!/^claude\b/i.test(details.clientName.trim())) return 'client';
  return '';
}

// 최근 읽은 기록 한 줄(도구 이름·결과만, 내용은 기록에 없다 — 설계 7.1).
export const TOOL_LABELS = Object.freeze({
  web2_org_status: word('조직 현황'), web2_business_reports: word('사업 보고'), web2_project_status: '프로젝트 현황',
  ledger_search: '원장 검색', ledger_get: '원장 한 건', web2_notes_search: '노트 검색', google_where: '할 일·일정 찾는 길',
  web2_day_list: '하루 기록 목록', web2_day_get: '하루 기록', web2_calls_list: '통화 목록', web2_call_get: '통화 한 건',
  web2_recordings_list: '녹음 목록', web2_recording_get: '녹음 한 건', web2_basket_search: '정리함 검색', web2_basket_get: '정리함 한 건',
  web2_family_list: '가족 방 목록', web2_family_get: '가족 노트',
});
export const STATUS_LABELS = Object.freeze({ok: '읽음', limited: '잠깐 멈춤', denied: '막음', error: '오류'});
// MCP-Claude쓰기(설계 docs/design/mcp-claude-write.md 5.2): 최근 Claude가 수정한 것 한 줄(종류·동작·글자 수만, 내용은 기록에 없다).
export const WRITE_KIND_LABELS = Object.freeze({note: '노트', update: '업데이트', work: '업무일지', org_record: word('담당조직 기록'), business_record: '사업 기록'});
export const WRITE_ACTION_LABELS = Object.freeze({create: '새로 씀', edit: '수정', trash: '휴지통으로', append: '한 줄 더함'});
export const writeLabel = r => `${WRITE_KIND_LABELS[r?.kind] || '기록'} ${WRITE_ACTION_LABELS[r?.action] || ''}`.trim();
export function writeChars(r) {
  const b = Number(r?.chars_before), a = Number(r?.chars_after);
  if (!Number.isFinite(a)) return '';
  if (r?.action === 'create' || !Number.isFinite(b)) return `${a.toLocaleString('ko-KR')}자`;
  return `${b.toLocaleString('ko-KR')}→${a.toLocaleString('ko-KR')}자`;
}
// 되돌리기 실패 문구(DB 거절 코드 → 일상어).
export function undoError(err) {
  const text = String(err?.message || err?.body?.message || err?.payload?.message || err || '');
  if (/CHANGED|TRASH_NOT_FOUND/.test(text)) return '그 뒤에 또 바뀌어서 되돌리지 않았어요.';
  if (/NOT_FOUND/.test(text)) return '이미 되돌렸거나 찾을 수 없어요.';
  return '되돌리지 못했어요. 잠시 뒤 다시 해 주세요.';
}
export const toolLabel = t => TOOL_LABELS[t] || TOOL_LABELS[String(t || '').replace(/^app_mcp_/, '')] || String(t || '도구');
export const statusLabel = s => STATUS_LABELS[s] || String(s || '');

/** 이번 달 1일 0시(서울)를 UTC ISO로. 호출 수 세기의 시작점. */
export function monthStartIso(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3600000).toISOString();
}
export const COUNT_CAP = 10000;
export const countText = n => n >= COUNT_CAP ? `${COUNT_CAP.toLocaleString('ko-KR')}번 넘음` : `${Number(n || 0).toLocaleString('ko-KR')}번`;
