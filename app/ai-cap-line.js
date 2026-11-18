// AI-사람별한도: 내 프로필 '사용 현황' 칸의 한도 한 줄(MULTI-다른담당자맞춤 ⑥: 한 달 AI 한도에 닿았을 때만). 이 파일이 이 줄의 유일한 상태 소유자이자 렌더러다.
// - 읽기: ai-assist kind=ai_month(로그인 토큰, 서버가 내 작업공간만 — 화면은 작업공간을 보내지 않는다). AI를 부르지 않는다.
// - 운영자 작업공간(서버 허용 표 ai_no_cap)·읽기 실패면 줄을 그리지 않는다(명진 화면은 그대로).
import {aiMonthLine} from './ai-cap.mjs';

export function mountAiCapLine(host, {rt = window.KPTURuntime} = {}) {
  if (!host) return null;
  host.hidden = true;
  let run = 0;
  async function refresh() {
    const mine = ++run;
    let line = null;
    try { line = aiMonthLine(await rt.api('/functions/v1/ai-assist', {method: 'POST', body: {kind: 'ai_month'}, singleFlight: false})); }
    catch { line = null; }
    if (mine !== run) return;
    host.textContent = line ? line.text : '';
    host.toggleAttribute('data-capped', !!line?.capped);
    host.hidden = !line;
  }
  return {refresh};
}
