// WEEKLY-재료전체 ② (S67-07, 사용자 11/19 "조직별 기록의 내용, 사진도 다 읽어서… 주간보고에 제안" → "ㅇㅇ 둘다 해줘"):
// 기록(바구니 업데이트 — 조직·사업 기록 칸에 사진·파일을 놓으면 이 길로 저장됨)에 붙은 사진·파일을 주간보고 AI 초안 재료의
// 본문 끝에 '사진: 이름 — 설명' 줄로 붙인다. 화면 줄·복사 글·한글 파일 글은 바꾸지 않는다(AI 재료만). 화면·읽기·저장 없는 순수 함수.
// 설명 출처(먼저 것부터): ① 자료별 AI 요약 표의 'b1:' 요약(같은 Drive 파일로 들어간 자료 — 사진은 library-files photo-brief가 채움)
//   ② 사진 속 글자 읽기(첨부 ocr, 이미 읽어 둔 것만) ③ 없으면 파일 이름만(실패해도 줄은 남음).
// 업무 글이 지나가므로 로그·오류 보고에 글을 넣지 않는다.
import {effectiveOcrText} from './basket-ocr-text.mjs';
import {briefOf} from './weekly-file-lines.mjs';
import {isPictureFile} from './photo-fold-model.mjs';

export const FILE_LINES_MAX = 10;    // 기록 하나에 붙이는 사진·파일 줄 수
export const FILE_DESC_CHARS = 300;  // 설명 한 줄 글자 수(사진 속 글자는 앞부분만)
export const FILE_NAME_CHARS = 80;
const flat = (s, n) => { const a = [...String(s ?? '').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const ocrOf = file => { try { return effectiveOcrText(file); } catch { return ''; } };
const isPicture = file => isPictureFile({name:file?.file_name, mime:file?.mime_type});

// 그 주 자료 목록 → Drive 파일 id → 자료(요약이 있는 것 먼저). 남의 작업공간 자료는 읽기(owner RLS)에서 이미 빠져 있다.
export function docsByFile(docs) {
  const out = new Map();
  for (const doc of docs || []) {
    const id = String(doc?.file_id || '');
    if (!id) continue;
    if (!out.has(id) || (!briefOf(out.get(id)) && briefOf(doc))) out.set(id, doc);
  }
  return out;
}

// 업데이트 하나의 첨부 → ['사진: 이름 — 설명', '파일: 이름 — 요약', …]. 첨부가 없으면 [].
export function attachmentLines(memo, byFile = new Map()) {
  const files = Array.isArray(memo?.attachments) ? memo.attachments : [];
  return files.slice(0, FILE_LINES_MAX).map(file => {
    const picture = isPicture(file), name = flat(file?.file_name, FILE_NAME_CHARS) || '이름 없음';
    const doc = byFile.get(String(file?.drive_file_id || ''));
    const desc = flat(briefOf(doc) || (picture ? ocrOf(file) : ''), FILE_DESC_CHARS);
    return `${picture ? '사진' : '파일'}: ${name}${desc ? ` — ${desc}` : ''}`;
  });
}

// 본문 + 첨부 줄(본문이 없으면 첨부 줄만). 둘 다 없으면 ''.
export const withFiles = (body, lines) => [String(body || ''), ...(lines || [])].filter(Boolean).join('\n');

// 그 주 자료 가운데 사진 설명을 다시 읽을 것(library-files photo-brief 에 보낼 자료 id): 기록에 붙은 사진 자료인데 'b1:' 요약이 없는 것.
// 최근 것부터 max 개. memos: 그 주 업데이트, docs: 그 주 자료(mime_type 포함).
export function photoBriefTargets(memos, docs, max = 4) {
  const attached = new Set();
  for (const memo of memos || []) for (const file of Array.isArray(memo?.attachments) ? memo.attachments : []) if (isPicture(file) && file?.drive_file_id) attached.add(String(file.drive_file_id));
  return (docs || []).filter(doc => doc?.id && attached.has(String(doc.file_id || '')) && isPictureFile({name:doc.file_name, mime:doc.mime_type}) && !briefOf(doc))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, max).map(doc => String(doc.id));
}
