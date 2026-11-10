// RECORD-한줄AI요약(11/09 명진 A안, 시안 docs/design/mockups/org-record-oneline.html): 조직 기록을 저장(또는 원문 수정)한 뒤 한 번,
// 서버(ai-assist kind=record_one_line)에 'AI 한 줄'을 부탁한다. 기록 ID만 보낸다(글은 서버가 내 로그인으로 읽음).
// - 원문이 짧으면(표시 기호를 걷어낸 뒤 한 줄로 60자 안) 부르지 않는다 — 화면이 원문 그대로 보인다(record-oneline.mjs needsOneLine).
// - 기다리지 않는다: 실패·배포 전·건너뜀은 조용히 넘어가고(화면은 임시 한 줄 그대로), 한 줄이 생기면 같은 탭 표·목록이 다시 읽게 알린다.
// - 보고용으로 고친 글(app_report_line_marks.report_body)은 다른 표라 AI가 덮지 않는다. 기기 저장 없음.
import {callAiAssist} from './basket-ai-summary.js';
import {needsOneLine} from './record-oneline.mjs';

// 같은 탭 조직보고 표(record-window-view.js)·조직 상세가 듣는 '조직 기록 바뀜' 알림(원장 자동 기록이 듣는 kptu:api-saved는 쓰지 않음).
export const RECORD_ONE_LINE_EVENT = 'kptu:record-window-changed';
export function requestRecordOneLine(id, raw, {rt = globalThis.window?.KPTURuntime, call = callAiAssist, notify = () => globalThis.window?.dispatchEvent?.(new CustomEvent(RECORD_ONE_LINE_EVENT, {detail: {source: 'record-one-line'}}))} = {}) {
  if (typeof id !== 'string' || !id || !needsOneLine(raw)) return Promise.resolve(null);
  return Promise.resolve().then(() => call({kind: 'record_one_line', id}, {rt})).then(r => {
    const line = r?.ok && typeof r.data?.line === 'string' ? r.data.line : null;
    if (line) notify();
    return line;
  }).catch(() => null);
}
