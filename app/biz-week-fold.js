// S56-13 BIZ-주간보고접힘기억(요청함 11/10 10:00 "이번주 주간보고, 어느페이지에서든 펼침, 접힘 기억" → "기기별로 기억"):
// 사업 보고 위 '이번 주 주간보고' 칸을 손으로 펼쳤나·접었나 한 곳. 서버 view_prefs.biz_week_open.<기기> = 참(펼침)·거짓(접힘)에 기억한다 — 기기 저장 없음.
// 기기 종류(app 폰 앱·phone 폰 브라우저·pc 그 밖)는 box-fold.js·[파일]과 같은 filesDeviceKind로 정한다: 폰에서 접어도 PC는 그대로.
// 기억한 값은 어느 종류·어느 기간·다시 들어올 때·새로 고침 뒤에도 그대로 쓰고(weekly-summary-table.js isOpen), 기억이 없으면 지금 규칙(주 단위 펼침, 여러 주 접힘).
// 보고 하나를 열 때의 자동 접힘(BIZ-주간보고접기)은 기억을 바꾸지 않는다. DB 적용 전이면 쓰기가 400이라 이번 접속만 기억한다(box-fold.js와 같은 방식).
import {viewPrefs} from './view-prefs.js';
import {filesDeviceKind, PHONE_WIDTH_QUERY} from './files-sources-model.mjs';

// 기기 종류는 화면을 연 때 한 번 정한다(폴드를 접고 펴도 같은 칸).
export const WEEK_DEVICE = filesDeviceKind({ua: globalThis.navigator?.userAgent || '', narrow: !!globalThis.matchMedia?.(PHONE_WIDTH_QUERY)?.matches});

let session, serverRefused = false;
globalThis.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes('biz_week_open.' + WEEK_DEVICE)) serverRefused = true; });

/** 이 기기 종류에서 기억한 펼침(참·거짓), 기억이 없으면 undefined. */
export function bizWeekOpen() {
  const v = serverRefused ? session : viewPrefs.getBizWeekOpen?.(WEEK_DEVICE);
  return typeof v === 'boolean' ? v : undefined;
}
/** 손으로 펼치거나 접은 값을 기억한다. */
export function setBizWeekOpen(open) {
  session = !!open;
  viewPrefs.setBizWeekOpen?.(WEEK_DEVICE, !!open);
}
