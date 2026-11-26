import {word} from './brand/brand.mjs';
import {UNION_WORD, UNION_LABEL} from './profile-words.mjs';
// COLLAB-묶인사람끼리공유 1단계 '묶기' 화면 모델(설계 docs/design/collab-sharing.md 3절, 시안 docs/design/mockups/collab-groups-3.html).
// 화면(collab-groups.js)이 쓰는 글자·모양을 계산만 한다. 서버 호출·저장 없음. 권한 판정은 서버 함수(app_collab_*)가 한다 — 여기 값은 표시용.

// 묶음 종류 이름(서버 값 kind는 'dept'·'union' 그대로, 화면 글자만). '노조' 자리는 소속 칸 이름(app/profile-words.mjs).
export const KIND_NAME = {dept: '부서 묶음', union: `${UNION_WORD} 묶음`};
export const INVITE_PARAM = 'join';
export const TOKEN_RE = /^[0-9a-f]{64}$/;

// 같은 이름이 있든 없든 만든 사람에게는 이 한 줄만(설계 3.2, 시안 ③).
export const CREATED_TEXT = {
  dept: '부서 묶음을 만들었어요. 같은 이름 묶음이 이미 있으면 그 묶음에서 수락할 때 하나로 합쳐져요.',
  union: `${UNION_WORD} 묶음을 만들었어요. 같은 이름 묶음이 이미 있으면 그 묶음에서 수락할 때 하나로 합쳐져요.`,
};
export const LIMIT_HINT = '하루에 3번까지 만들 수 있어요. 넘으면 같은 안내 뒤에 아무 일도 일어나지 않아요.';
export const EMPTY_TEXT = word('같은 부서·같은 노조 사람과 일정·자료·조직·사업을 선택해서 나눠 볼 수 있어요. 나누는 건 항목마다 직접 켜요.');
export const INVITE_HINT = '초대 링크를 받았으면 그 링크를 누르면 돼요.';
export const LINK_NOTE = '7일 동안 한 사람이 쓸 수 있어요. 이 창을 닫으면 다시 볼 수 없어요(필요하면 새로 만들기).';
// 들어갈 때 알리고 동의받는 것(결정 ①, 시안 ②·⑥).
export const CONSENT_LINES = [
  '내 이름·직책(프로필 글)',
  '캘린더·폴더를 나누면 내 구글 메일(구글 화면에 보여요)',
  '내가 켠 공유만 — 개인 기록은 안 보여요',
];

const ERRORS = {
  COLLAB_INVITE_UNUSABLE: '쓸 수 없는 링크예요. 묶음 사람에게 새 링크를 받아 주세요.',
  COLLAB_PROFILE_NAME_REQUIRED: '프로필에 이름을 먼저 채워 주세요.',
  COLLAB_CONSENT_REQUIRED: '보이는 것에 동의해야 들어갈 수 있어요.',
  COLLAB_NAME_INVALID: `${UNION_LABEL}·부서명을 60자 안으로 한 줄로 써 주세요.`,
  COLLAB_LIMIT: '묶음 수나 멤버 수가 한도에 닿았어요.',
  COLLAB_ADMIN_MUST_MOVE: '관리자는 먼저 다른 멤버에게 관리자를 넘긴 뒤 나갈 수 있어요.',
  COLLAB_ADMIN_REQUIRED: '관리자만 할 수 있어요.',
  COLLAB_MEMBER_REQUIRED: '이 묶음 멤버가 아니에요.',
  COLLAB_SELF_NOT_ALLOWED: '자기 자신에게는 할 수 없어요. 나가기를 써 주세요.',
  COLLAB_WORKSPACE_REQUIRED: '작업공간을 먼저 시작해 주세요.',
  COLLAB_AUTH_REQUIRED: '다시 로그인해 주세요.',
};
export function errorCode(err) {
  const m = String(err?.message ?? err ?? '').match(/COLLAB_[A-Z_]+/);
  return m && Object.hasOwn(ERRORS, m[0]) ? m[0] : '';
}
export function errorText(err, fallback = '처리하지 못했어요. 잠시 뒤 다시 해 주세요.') {
  const code = errorCode(err);
  return code ? ERRORS[code] : fallback;
}

// 서버 정리와 같게: 앞뒤 공백 제거·연속 공백 하나로·줄바꿈 등은 빈칸. 60자 넘거나 비면 ''.
export function cleanName(text) {
  const c = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return c.length >= 1 && c.length <= 60 ? c : '';
}
export function groupName(g) {
  const parts = [g?.union_name, g?.kind === 'dept' ? g?.dept_name : '', g?.kind === 'dept' ? '부서' : UNION_WORD].filter(Boolean);
  return parts.join(' ');
}
export const roleText = role => (role === 'admin' ? '관리자' : '멤버');
export function memberLine(m) {
  return [m?.name, m?.title].filter(Boolean).join(' ');
}
// 목록 한 줄의 작은 글: '관리자 · 3명 · 요청 1'
export function groupMeta(g) {
  const parts = [roleText(g?.my_role), `${(g?.members || []).length}명`];
  const req = (g?.requests || []).length;
  if (g?.my_role === 'admin' && req) parts.push(`요청 ${req}`);
  return parts.join(' · ');
}
// 만들기 창 기본값: 빈 칸(S71-34 PROFILE-이름만 — 프로필은 소속·부서를 받지 않으므로 만들기 창에서 직접 쓴다). 노조 묶음은 부서명 없음.
export function createDefaults(kind) {
  return {kind, union: '', dept: ''};
}
export function createReady(form) {
  return !!cleanName(form?.union) && (form?.kind !== 'dept' || !!cleanName(form?.dept));
}
export function createArgs(form) {
  return {
    p_kind: form.kind === 'union' ? 'union' : 'dept',
    p_union_name: cleanName(form.union),
    p_dept_name: form.kind === 'dept' ? cleanName(form.dept) : null,
    p_agree: true,
  };
}

// 초대 링크: 앱 주소 + ?view=profile&join=<64자>. 링크 글자는 화면 메모리에만 둔다(서버는 해시만 가짐).
export function inviteUrl(appRoot, token) {
  if (!TOKEN_RE.test(String(token || ''))) return '';
  const u = new URL(appRoot);
  u.searchParams.set('view', 'profile');
  u.searchParams.set(INVITE_PARAM, token);
  return u.href;
}
export function tokenFromUrl(href) {
  try {
    const t = new URL(href).searchParams.get(INVITE_PARAM) || '';
    return TOKEN_RE.test(t) ? t : (t ? 'bad' : '');
  } catch { return ''; }
}
export function urlWithoutToken(href) {
  const u = new URL(href);
  u.searchParams.delete(INVITE_PARAM);
  return u.pathname + (u.search || '') + u.hash;
}
export function inviteSummary(peek) {
  if (!peek) return '';
  const others = Math.max(0, Number(peek.member_count || 0) - 1);
  const admin = [peek.admin_name, peek.admin_title].filter(Boolean).join(' ');
  return `${groupName(peek)} · ${admin}${others ? ` 외 ${others}명` : ''}`;
}
