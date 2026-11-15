// MULTI-다른담당자맞춤 ⑤(명진 11/13 13:46·15:30): AI 안내문에 박혀 있던 고정 소속·직책을 그 사람 프로필 값으로.
// - 안내문은 자리표 OWNER_ROLE을 쓰고, 보내기 직전에 부른 사람(로그인 토큰)의 프로필 직책(app_profiles.job_title, 내 프로필 '직책' 칸)으로 바꾼다.
// - 직책이 비었거나 이상하면 중립 표현 NEUTRAL_ROLE. 이름은 넣지 않는다(직책만). 코드·시험·문서에 실명·직책을 적지 않는다.
// - 프로필 읽기는 todo-radar와 같은 정리 규칙(cleanProfile: 한 줄, 40자)을 쓴다.
import { cleanProfile, type RadarProfile } from "./todo-radar.ts";

export const OWNER_ROLE = "{{기록 주인 직책}}";
export const NEUTRAL_ROLE = "노동조합 활동가";

// 직책이 있으면 '노동조합 <직책>', 없으면 '노동조합 활동가'.
export function roleOf(profile: RadarProfile | null | undefined): string {
  return profile?.title ? `노동조합 ${profile.title}` : NEUTRAL_ROLE;
}

// 안내문의 자리표를 직책으로. 자리표가 없는 안내문은 그대로.
export function withOwnerRole(instructions: string, profile: RadarProfile | null | undefined): string {
  return instructions.includes(OWNER_ROLE) ? instructions.split(OWNER_ROLE).join(roleOf(profile)) : instructions;
}

export { cleanProfile };
