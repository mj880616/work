// MULTI-다른담당자맞춤 ⑤(사용자 11/13 13:46·15:30): AI 안내문에 박혀 있던 고정 소속·직책을 그 사람 프로필 값으로.
// - 안내문은 자리표 OWNER_ROLE을 쓰고, 보내기 직전에 부른 사람(로그인 토큰)의 프로필 소속·직책(app_profiles.union_name·job_title, 내 프로필 칸)으로 바꾼다.
// - S67-51: 부르는 말의 규칙은 _shared/owner-role.mjs 한 곳(소속+직책, 없으면 업종 없는 '업무 담당자'). 예전처럼 '노동조합 '을 붙이지 않는다.
// - 이름은 넣지 않는다(소속·직책만). 코드·시험·문서에 실명·직책을 적지 않는다.
// - 프로필 읽기는 todo-radar와 같은 정리 규칙(cleanProfile: 한 줄, 40자)을 쓴다.
import { cleanProfile, type RadarProfile } from "./todo-radar.ts";
import { NEUTRAL_ROLE, ownerRoleOf } from "../_shared/owner-role.mjs";

export const OWNER_ROLE = "{{기록 주인 직책}}";
export { NEUTRAL_ROLE };

export function roleOf(profile: RadarProfile | null | undefined): string {
  return ownerRoleOf({ org: profile?.org ?? null, title: profile?.title ?? null });
}

// 안내문의 자리표를 소속·직책으로. 자리표가 없는 안내문은 그대로.
export function withOwnerRole(instructions: string, profile: RadarProfile | null | undefined): string {
  return instructions.includes(OWNER_ROLE) ? instructions.split(OWNER_ROLE).join(roleOf(profile)) : instructions;
}

export { cleanProfile };
