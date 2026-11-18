// WEEKLY-내양식자유변형 ⑤-3d: 주간보고 AI 안내 글·학습 묶음 이름에 박혀 있던 양식 제목('5. 주요 일정' 등)을 부른 사람의 '내 양식' 제목으로.
// - 묶음 이름 규칙은 앱과 바이트까지 같은 사본(_shared/weekly-group-names.mjs). 양식 제목 읽기는 handler.ts 가 부른 사람 로그인으로
//   자기 작업공간 app_weekly_forms 행만 읽는다(owner RLS 그대로, 서비스 권한 없음). 양식이 없거나 못 읽으면 일반적인 말.
// - 안내 글은 자리표를 쓰고 보내기 직전에 바꾼다(owner-role.ts 와 같은 방식). 양식 글자는 한 줄·60자, 따옴표·괄호류를 뺀 글만 들어간다.
// 순수 함수만 둔다(입출력은 handler.ts).
import { groupKeyOf, groupNames, titlesOfForm } from "../_shared/weekly-group-names.mjs";

export type GroupNames = Record<string, string>;
export const CALENDAR_TITLE = "{{주요 일정 제목}}";
export const BODY_CELLS = "{{본문 칸 이름}}";

export { groupKeyOf, groupNames, titlesOfForm };
export const genericNames = (): GroupNames => groupNames(null) as GroupNames;
// 칸 열쇠 → 묶음 이름(학습 재료의 where·group).
export const groupOfCell = (cell: string, names: GroupNames = genericNames()): string => names[groupKeyOf(cell)] ?? names.other ?? "기타";

// 안내 글에 넣는 글: 자리표·따옴표·괄호류·꺾쇠를 뺀다(양식 글자가 안내 글 모양을 바꾸지 않게).
const safe = (s: unknown) => String(s ?? "").replace(/[{}<>'"`\\]/g, "").replace(/\s+/g, " ").trim();
const bare = (s: string) => s.replace(/^\s*\(?\d+[.)]\s*/, "");

// 자리표를 묶음 이름으로. 자리표가 없는 안내 글은 그대로.
//  - CALENDAR_TITLE: 주요 일정 큰 항목 제목('5. 주요 일정' 꼴, 없으면 '주요 일정').
//  - BODY_CELLS: AI가 고쳐 쓰는 본문 칸(요약·사업장 현황·조직 현황)의 번호 뗀 이름을 '·'로.
export function withFormNames(instructions: string, names: GroupNames = genericNames()): string {
  let out = instructions;
  if (out.includes(CALENDAR_TITLE)) out = out.split(CALENDAR_TITLE).join(safe(names.calendar) || "주요 일정");
  if (out.includes(BODY_CELLS)) out = out.split(BODY_CELLS).join(["summary", "sites", "orgs"].map((k) => safe(bare(names[k] ?? ""))).filter(Boolean).join("·"));
  return out;
}
