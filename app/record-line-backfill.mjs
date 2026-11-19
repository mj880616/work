// ORG-기록첨부 옛줄바꾸기(S67-13, 명진 11/19 결정 '나'): 사진·파일만 놓은 기록의 AI 한 줄이 실패해 화면이 대신 만든 줄
// ('그림 1장 · 투쟁명령 4호.png', '그림 2장 · 파일 1개 · 이름 외 2' — record-file-line.mjs fallbackFileLine)만 골라, 그 기록 사진의
// 설명(자료별 AI 요약 표 'b1:' — library-files photo-brief)의 첫 줄로 바꾼다. 화면·읽기·저장 없는 순수 함수(판정 기준은 이 파일 한 곳).
// - 대상 판정: 줄 글이 '지금 그 기록 첨부로 다시 만든 대신 줄'과 글자 하나까지 같을 때만. 사람이 직접 쓴 글, [요약 수정]으로 고친 줄,
//   AI 한 줄, 첨부와 이름·개수가 어긋난 줄(애매함)은 모두 아님 → 안 바꿈.
// - 바꾼 줄 = 새로 올릴 때 AI 한 줄과 같은 모양(recordFileLine: 설명 첫 줄, 파일이 여럿이면 끝에 '(그림 2장)'), 줄 길이 상한·검사는
//   record-line.ts checkRecordLine과 같음(80자, 꺾쇠·제어 문자면 버림).
// - 되돌리기: 옛 줄은 첨부(app_notes.attachments)만으로 똑같이 다시 만들어지므로 따로 보관하지 않는다(새 저장소·DB 변경 없음).
//   [이전 줄로 되돌리기]는 줄 글이 '그 기록 사진 설명으로 만든 줄'과 같을 때만 보인다(AI 한 줄·사람 글에는 안 보임).
import { fallbackFileLine, recordFileLine, RECORD_LINE_CHARS } from './record-file-line.mjs';
import { isPictureFile } from './photo-fold-model.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
// 서버가 다시 거르는 글자(record-line.ts CONTROL과 같은 범위 + 꺾쇠). 하나라도 있으면 그 설명은 쓰지 않는다.
const BAD = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069<>]/;

const listOf = attachments => (Array.isArray(attachments) ? attachments : []).filter(f => f && typeof f === 'object');
// 첨부 → 대신 줄을 만들 때 쓴 파일 모양({name, type}) — 올릴 때 File.type 자리에 저장된 mime_type.
export const filesOf = attachments => listOf(attachments).map(f => ({ name: String(f.file_name ?? f.name ?? ''), type: String(f.mime_type ?? '') }));

// 그 첨부로 다시 만든 대신 줄(첨부가 없으면 '').
export const fileNameLine = attachments => fallbackFileLine(filesOf(attachments));

// 대상 판정(한 곳): 줄 글이 첨부로 다시 만든 대신 줄과 똑같은가.
export function isFileNameLine(line, attachments) {
  if (typeof line !== 'string' || !line) return false;
  const made = fileNameLine(attachments);
  return !!made && line === made;
}

// 설명(여러 줄) → 기록 한 줄: 첫 줄, 공백 하나로, 80자(넘으면 79자 + '…'). 쓸 수 없으면 ''.
export function briefLine(brief) {
  if (typeof brief !== 'string') return '';
  const first = brief.split(/\r\n?|\n/).map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  if (!first || BAD.test(first) || first.isWellFormed?.() === false) return '';
  const a = [...first];
  return a.length > RECORD_LINE_CHARS ? a.slice(0, RECORD_LINE_CHARS - 1).join('').trimEnd() + '…' : first;
}

// 첨부 순서대로 첫 설명(briefs: Map Drive 파일 id → 설명 글). 없으면 ''.
export function chosenBrief(attachments, briefs) {
  for (const f of listOf(attachments)) {
    const line = briefLine(briefs?.get?.(String(f.drive_file_id || '')));
    if (line) return line;
  }
  return '';
}

// 바꿀 줄: 설명 첫 줄(+ 파일이 여럿이면 개수). 설명이 없거나 대신 줄과 같으면 ''.
export function backfilledLine(attachments, briefs) {
  const line = chosenBrief(attachments, briefs);
  if (!line) return '';
  const next = recordFileLine(line, filesOf(attachments));
  return next && next !== fileNameLine(attachments) ? next : '';
}

// [이전 줄로 되돌리기]를 보일까: 줄 글이 그 기록 사진 설명으로 만든 줄과 똑같을 때만.
export function canRevertLine(line, attachments, briefs) {
  if (typeof line !== 'string' || !line || isFileNameLine(line, attachments)) return false;
  const made = backfilledLine(attachments, briefs);
  return !!made && line === made;
}

// 설명을 새로 읽어야 할 사진(첨부 순서, 설명 없는 그림 첨부의 Drive 파일 id).
export function picturesWithoutBrief(attachments, briefs) {
  return listOf(attachments).filter(f => DRIVE_ID.test(String(f.drive_file_id || '')) && isPictureFile({ name: String(f.file_name || ''), mime: String(f.mime_type || '') })
    && !briefLine(briefs?.get?.(String(f.drive_file_id)))).map(f => String(f.drive_file_id));
}

// 기록 줄 대상 목록 → 판정 통과한 것만(연결 줄·사업 기록 줄 공용). rows: [{id, line, attachments}].
export function backfillTargets(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && UUID.test(String(r.id || '')) && isFileNameLine(r.line, r.attachments));
}

// 진행 한 줄.
export function progressText({ done = 0, total = 0, reading = false } = {}) {
  return `옛 사진 기록 채우기 ${done}/${total}${reading ? ' · 사진 설명 만드는 중' : ''}`;
}
// 끝 알림 한 줄 + 남은 까닭.
export function finishText({ done = 0, left = 0, capped = false } = {}) {
  const head = done ? `옛 사진 기록 ${done}개를 사진 설명으로 바꿨어요.` : '바꾼 기록 줄이 없어요.';
  if (!left) return head;
  return `${head} ${left}개는 ${capped ? '오늘 사진 읽기 상한에 닿았거나 사진을 읽지 못해 남았어요. 내일 다시 누르면 이어서 해요.' : '사진 설명을 만들지 못해 그대로 두었어요.'}`;
}
