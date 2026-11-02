// JOURNAL-오늘한일업무개인: 그 주 '오늘 한 일' 줄의 업무·개인 판단을 서버 AI(ai-assist kind=work_scope)에 묻는다. 주 월요일만 보낸다
// (줄은 서버가 로그인 토큰으로 읽음, 비밀 메모 규칙 그대로). 판단은 저장하지 않는다 — 부르는 쪽(journal.js)이 메모리에만 둔다.
import {callAiAssist} from './basket-ai-summary.js';
import {dropSet} from './work-scope-model.mjs';

export async function requestWorkScope(start, rt = window.KPTURuntime) {
  const result = await callAiAssist({kind:'work_scope', week_start:start}, {rt});
  const drop = result?.ok && result.data?.kind === 'work_scope' && result.data.week_start === start ? dropSet(result.data.drop) : null;
  if (!drop) return {ok:false, code:result?.code || 'ai_invalid_response'};
  return {ok:true, drop};
}
