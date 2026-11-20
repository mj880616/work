// S67-51 WORK ON 노조 전제 전수(docs/design/workon-union-assumptions-audit.md A1·A2): AI 안내문이 기록 주인을 부르는 말 — 한 규칙.
// - 그 사람이 내 프로필에 등록한 값만 쓴다: 소속(app_profiles.union_name)과 직책(job_title). 이름은 넣지 않는다.
// - 코드에 업종·단체 이름을 박지 않는다(예전: 늘 '노동조합 <직책>', 기본 '노동조합 활동가'). 둘 다 없으면 업종 없는 기본값.
// - ai-assist(owner-role.ts)와 회의 정리(meeting-draft-prompt.mjs)가 이 파일 하나를 쓴다(사본 없음).
// - 값은 안내문에 들어가므로 한 줄로 정리하고 칸마다 40자까지만(안내문을 늘이지 못하게).
export const NEUTRAL_ROLE = '업무 담당자';
export const ROLE_PART_CHARS = 40;

export function rolePart(value) {
  if (typeof value !== 'string') return '';
  const t = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, ROLE_PART_CHARS).join('');
}

// 소속+직책 → '<소속> <직책>', 직책만 → '<직책>', 소속만 → '<소속> 업무 담당자', 둘 다 없음 → '업무 담당자'.
export function ownerRoleOf({ org, title } = {}) {
  const o = rolePart(org), t = rolePart(title);
  if (o && t) return `${o} ${t}`;
  if (t) return t;
  if (o) return `${o} ${NEUTRAL_ROLE}`;
  return NEUTRAL_ROLE;
}

// 그 사람 자기 프로필 행의 소속 한 칸(회의 정리 쪽에서 씀). 부른 사람 로그인 클라이언트(owner RLS) 또는 맡긴 사람 id로만 읽는다.
// 칸이 아직 없는 DB·읽기 실패는 빈 글자(부르는 말이 직책만으로 돈다 — 회의 정리를 멈추지 않는다).
export async function readOwnerOrg(db, userId) {
  try {
    const { data, error } = await db.from('app_profiles').select('union_name').eq('user_id', userId).maybeSingle();
    return error ? '' : rolePart(data?.union_name);
  } catch {
    return '';
  }
}
