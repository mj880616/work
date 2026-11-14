// FORGET-원문열기·뒤로가기(S56-10): 다른 화면의 원문(통화 한 건·텔레그램 방의 그날)을 여는 한 곳.
// - 화면 이동은 라우터 openFrom(화면을 다 불러온 뒤 기록 1칸, 그 화면 상세가 같은 칸을 씀) → 뒤로가기 한 번이면 누른 화면 그 자리.
// - 연 통화·글은 잠깐 밝힌다(record-flash.js). 읽기·쓰기는 각 화면의 기존 여는 함수(KPTUCallFeed.show·KPTUTelegramFeed.show) 그대로.
import {flashRecord} from './record-flash.js';

const router = () => window.KPTURouter;
// back: 창(조직 상세 같은 .modal) 안의 줄에서 열 때, 뒤로가기 한 번으로 그 창을 그 자리로 다시 여는 함수(라우터 openFrom의 back, S61-53).
// 통화 한 건(업무·개인 통화함 어느 쪽이든). workOnly: 업무 통화만 여는 기존 길(KPTUCallFeed.open — 원장 근거·전체 검색). 열었으면 true.
export async function openCallSource(id, {workOnly = false, back = null} = {}) {
  if (!id || !router()?.openFrom) return false;
  return router().openFrom('calls', async () => {
    const feed = window.KPTUCallFeed;
    if (workOnly) await feed?.open?.(id);
    else if ((await feed?.show?.(id)) === false) return false;
    void flashRecord(`#cfDetail [data-cf-detail="${CSS.escape(id)}"]`);
    return true;
  }, {back});
}
// 텔레그램 방의 그날(item이 있으면 그 소식 원문을 펼치고 밝힘). 열었으면 true.
export async function openTelegramSource(room, day, item = '', {back = null} = {}) {
  if (!room || !day || !router()?.openFrom) return false;
  return router().openFrom('telegram', async () => {
    if ((await window.KPTUTelegramFeed?.show?.(room, day, item)) === false) return false;
    if (item) void flashRecord(`#tgDetail [data-tg-di="${CSS.escape(item)}"]`);
    return true;
  }, {back});
}
