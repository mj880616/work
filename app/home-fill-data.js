// HOME-모바일홈채우기: 홈 새 칸이 쓰는 읽기. 모두 owner RLS REST 읽기뿐(새 RPC·Edge 없음).
//  - 놓친 약속: 원장 첫 화면과 같은 경로·조건(ledger-browse-model.mjs overdueRecordsPath)
//  - 새 소식 수: 텔레그램 소식 메뉴의 오늘 줄(feed-data.js readDays + feed-model.mjs telegramToday)의 '중요한 m개'
//  - 정리 안 된 것: inbox-count.js readInboxCount
// 표나 함수가 아직 없으면(404 등) 그 값은 null이고 화면은 그 항목을 뺀다.
import {overdueRecordsPath, validResult, seoulDay} from './ledger-browse-model.mjs';
import {readDays} from './feed-data.js';
import {telegramToday, kstDay} from './feed-model.mjs';
import {readInboxCount} from './inbox-count.js';

const workspaceOf = rt => rt?.context?.read?.()?.workspace?.id || null;

export async function readMissedPromises(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  if (!ws) return {ok: false, rows: []};
  try {
    const rows = await rt.api(overdueRecordsPath(ws, seoulDay()), {singleFlight: false});
    return {ok: true, rows: (Array.isArray(rows) ? rows : []).filter(validResult)};
  } catch { return {ok: false, rows: []}; }
}
// 오늘 새 소식 수(텔레그램 소식 메뉴가 보이는 '중요한 m개'). 읽지 못했거나 오늘 줄이 없으면 null → 요약에서 뺀다.
export async function readNewsCount(rt = window.KPTURuntime) {
  try {
    const today = telegramToday(await readDays('telegram', rt), kstDay());
    return today ? today.kept : null;
  } catch { return null; }
}
// 정리 안 된 것 숫자와, 같은 읽기에서 센 텔레그램 '나한테 온 요청' 수. 읽지 못하면 둘 다 null.
export async function readInbox(rt = window.KPTURuntime, taskTitles = []) {
  const out = await readInboxCount(rt, {taskTitles});
  return out?.ok ? {total: out.total, asks: out.asks} : {total: null, asks: null};
}
