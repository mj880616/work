// S48-3b (JOURNAL-오늘한일업무개인 남은 일 · WEEKLY-환류전칸과 같은 길): [주간 정리] 참고 '한 줄'에서 개인 줄 ⋯ [빼기].
// - 누르면 바로 그 줄을 이번 주 업무 재료(화면·[글로 복사]·한글 파일 상자)에서 뺀다(work-scope-model.mjs markUserDrop — 탭 메모리).
// - 서버 원본은 그 주 요청 표 행 draft.picks 한 칸(owner RLS, weekly-draft-store.js changeWeekDocs — 다시 읽고 그 칸만 바꿔 조건부로 씀).
//   {kind:'work_line', cell:'notes:lines:<날짜>', act:'drop', text}. 다음에 열 때 서버(ai-assist work_scope)가 이 줄을 뺄 줄에 더하고,
//   앞 주들에 뺀 줄은 '개인 줄로 뺀 예'로 AI 가르기에 준다(학습). 하루 화면·달력·일기의 줄은 그대로다(지우지 않음).
// - 작은 알림(small-notice.js)에 [되돌리기] — 되돌리면 같은 열쇠를 'none' 으로 쓰고 줄을 다시 넣는다. 브라우저 저장소에 아무것도 두지 않는다.
//   줄 글은 로그·오류 보고에 쓰지 않는다.
import {changeWeekDocs} from './weekly-draft-store.js';
import {withPick} from './weekly-picks.mjs';
import {markUserDrop, clearUserDrops, workLinePick} from './work-scope-model.mjs';
import {notify} from './small-notice.js';

const emptyDraft = () => ({v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[]});
const save = (start, day, text, act, rt) => changeWeekDocs({start, change:d => ({...(d ?? emptyDraft()), picks:withPick(d?.picks, workLinePick(day, text), act, new Date().toISOString())})}, rt);

if (typeof window !== 'undefined') window.addEventListener('kptu:session-changed', clearUserDrops);

// li: 화면의 그 줄(빼면 목록에서 떼고, 되돌리면 같은 자리에 다시 붙임). 반환 Promise<boolean>(저장 성공).
export async function dropWorkLine({start, day, text, li = null, rt = window.KPTURuntime}) {
  const parent = li?.parentNode ?? null, next = li?.nextSibling ?? null;
  markUserDrop(day, text); li?.remove();
  const back = () => { markUserDrop(day, text, false); if (parent && li && !li.isConnected) parent.insertBefore(li, next?.parentNode === parent ? next : null); };
  try {
    const r = await save(start, day, text, 'drop', rt);
    if (r.missing) throw new Error('missing');
  } catch {
    back(); notify('저장하지 못했어요. 다시 눌러 주세요.', {error:true});
    return false;
  }
  notify('개인 줄로 뺐어요. 다음 가르기에 참고해요.', {label:'한 줄 빼기', undo:async () => {
    try { const r = await save(start, day, text, 'none', rt); if (r.missing) return false; } catch { return false; }
    back(); return true;
  }});
  return true;
}
