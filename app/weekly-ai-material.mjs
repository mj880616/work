// WEEKLY-개발후보연결 1) (10/26 명진이 [승인]한 개선 제안 — "AI에게 기록마다 날짜와 예정/끝남을 같이 주면 지난 일을 또 쓰는 일이 줄어요"):
// 주간보고 AI 초안(ai-assist weekly_draft)에 보내는 이번 주 기록 줄 앞에 '날짜 [상태]'를 붙인다. 상태는 보고일 기준
// 끝남(보고일 전) · 오늘(보고일) · 예정(보고일 뒤). 날짜가 없는 줄(달력 참고 등)은 그대로. 순수 함수만(화면 journal-hwpx.js 가 부름).
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MATERIAL_STATE = Object.freeze({done:'끝남', today:'오늘', plan:'예정'});
export const materialState = (day, report) => !DAY.test(String(day ?? '')) || !DAY.test(String(report ?? '')) ? '' : day < report ? MATERIAL_STATE.done : day === report ? MATERIAL_STATE.today : MATERIAL_STATE.plan;
// x: {day, text, ai?} — ai 가 있으면(달력 참고 줄 등 이미 만든 AI용 글) 그대로. dayText: 날짜 → 짧은 날짜 글.
export function materialLine(x, report, dayText) {
  if (x?.ai) return x.ai;
  const state = materialState(x?.day, report), text = String(x?.text ?? '');
  return x?.day ? `${dayText(x.day)} ${state ? `[${state}] ` : ''}${text}` : text;
}
