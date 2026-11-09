// RECORD-한줄 ①: 보고 표 줄 ⋯ [원문 보기] — 표에는 기록의 '한 줄'만 보이고, 원문은 이 작은 창에서 저장된 그대로 본다(읽기만, 쓰지 않음).
// 창은 잊지 말기 기록 창(record-sheet.js, ✕·바깥 누름·Esc·뒤로가기로 닫힘)을 그대로 쓴다. 마크다운 원문은 같은 마크다운 보기로 정리해 보인다.
import {openRecordSheet} from './record-sheet.js';

// text = 원문 그대로, day = '10.22.' 같은 날짜 글, line = 표에 보이는 한 줄, place = 조직·사업 이름(있으면), trigger = 누른 버튼(닫으면 초점이 돌아감).
export function openRawRecord({text = '', day = '', line = '', place = '', trigger = null} = {}) {
  return openRecordSheet({
    row: {raw_text: String(text ?? ''), summary: line || null},
    trigger,
    title: '원문',
    meta: [place, day].filter(Boolean).join(' · '),
    summaryLabel: '한 줄',
  });
}
