// CAL-일정첨부 요청 6번 '사업 보고로 넘기기'(S59-23): 사업 보고 쓰기 창 '일정에 붙인 사진' 줄의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 화면은 report-event-photos.js, 서버는 document-actions `link-event-photo`(같은 Drive 원본을 가리키는 자료 행, 올리기·복사 없음).
import {photoUploadFields} from './activity-photo-model.mjs';

// 줄 머리: 시안 ③ '일정에 붙인 사진 2 · 넣으려면 누르기'. 고른 것이 있으면 '· n장 넣음'.
export const eventPhotoHead = total => `일정에 붙인 사진 ${Math.max(0, Number(total) || 0)}`;
export const eventPhotoNote = picked => (picked > 0 ? `${picked}장 넣음` : '넣으려면 누르기');

// 고른 사진 하나 → 서버 요청. 종류·날짜는 사진 올리기와 같은 규칙(사업 보고 칸 → 자료실 종류, 보고 날짜) — 서버는 모양만 본다.
// 작업공간·이름·형식은 보내지 않는다(서버가 사업 보고·Google 일정·Drive를 다시 읽어 정한다).
export function linkBody(pick, target, categories) {
  const fields = photoUploadFields({name: pick?.file_name || ''}, {kind: target?.kind, day: target?.day || ''}, categories);
  return {
    action: 'link-event-photo', meeting_id: String(target?.id || ''), calendar_id: String(pick?.calendarId || 'primary'), event_id: String(pick?.eventId || ''),
    drive_file_id: String(pick?.drive_file_id || ''), category: fields.category, ...(fields.document_date ? {document_date: fields.document_date} : {}),
  };
}

// 서버 답 → 결과. 'linked'(만들었거나 이미 있음) | 'unknown'(503: 넣었는지 모름 — 다시 보내지 않는다) | 'failed'(거절: 아무것도 안 바뀜).
export function linkOutcome(error) {
  if (!error) return 'linked';
  return Number(error?.status) === 503 ? 'unknown' : 'failed';
}

// 못 넣은 사진 알림 한 줄(하단바 위). 서버 글이 한국어 한 줄이면 그대로 작은 글로, 아니면(옛 서버 'Unknown action' 등) 정해 둔 글.
export function linkFailNotice(failed, unknown, message = '') {
  const n = failed + unknown;
  if (!n) return null;
  const text = `일정 사진 ${n}장 못 넣었어요`;
  if (unknown) return {text, note: '넣었는지 확인하지 못했어요. 다시 넣기 전에 사업 보고를 열어 확인해 주세요.', retry: false};
  const said = String(message || '').trim();
  return {text, note: /[가-힣]/.test(said) && said.length <= 120 ? said : '잠시 뒤 다시 넣어 주세요.', retry: true};
}
