// S71-69 SHARE-글공유 ②(사용자 결정 2026-11-26 "노트는 본문을 공유 / 노트가 텍스트만 있지 않은 경우 html 또는 pdf 또는 링크로 공유 묻기"):
// 노트 [공유] 계산 한 곳(화면 없음, 시험 가능). 화면 쪽은 note-share.js·basket-notes.js.
// - 글만 있는 노트(서식 없는 글로 바꿔도 잃는 게 없음) = 바로 '제목 + 본문 글'.
// - 그 밖(표·사진·첨부·체크 목록·머리글·굵게 같은 서식·인용·코드·접기·줄 맞춤·들여쓰기) = 고르기 [HTML 파일][PDF 파일][링크][글만 보내기].
// 판정은 저장된 값만 본다(서버로 아무것도 보내지 않음).
import {cleanDoc} from './ed-schema.mjs';
import {toPlain} from './ed-text.mjs';
import {noteMarkdown} from './note-markdown.mjs';
import {hasMarkdownMarks} from './note-preview.mjs';
import {exportFileName} from './note-board-export-model.mjs';

export const NOTE_SHARE_TITLE = '어떻게 보낼까요?';
// 고르기 칸(차례 그대로). link는 게시할 수 있는 노트만(잠근 폴더 노트는 빠짐).
export const NOTE_SHARE_CHOICES = Object.freeze([['html', 'HTML 파일'], ['pdf', 'PDF 파일'], ['link', '링크'], ['text', '글만 보내기']]);
export const NOTE_LINK_ASK = Object.freeze({text: '링크로 공유할까요?', note: '게시하면 링크를 아는 사람은 누구나 이 노트를 볼 수 있어요. 언제든 ⋯ [게시 멈춤]으로 닫을 수 있어요.', ok: '게시하고 공유'});
export const NOTE_SHARE_NOTE = Object.freeze({copied: '복사했어요', copyFail: '복사하지 못했어요. 다시 눌러 주세요.', empty: '보낼 글이 없어요', making: '파일을 만드는 중이에요…', saved: '파일을 내려받았어요', again: '공유 창이 막혔어요. [보내기]를 한 번 더 눌러 주세요.', failed: '파일을 만들지 못했어요. 다시 눌러 주세요.', linkFail: '링크를 만들지 못했어요. 다시 시도해 주세요.'});

const hasAttachments = note => Array.isArray(note?.attachments) && note.attachments.length > 0;
// 글자 마크: 없음, 또는 글자가 곧 주소인 링크(글로 보내도 주소가 그대로 남음).
function plainText(n) {
  const marks = Array.isArray(n.marks) ? n.marks : [];
  return marks.every(m => m?.type === 'link' && typeof m.attrs?.href === 'string' && m.attrs.href.replace(/\/$/, '') === String(n.text || '').trim().replace(/\/$/, ''));
}
// 편집기 문서(ed1)가 글만인가: 문단(본문 글자 크기는 상관없음, 줄 맞춤·들여쓰기 없음) · 글자 · 줄바꿈만.
export function docIsPlain(value) {
  const clean = cleanDoc(value);
  if (!clean) return true;
  const walk = n => {
    if (!n || typeof n !== 'object') return true;
    if (n.type === 'text') return plainText(n);
    if (n.type === 'hard_break') return true;
    if (n.type !== 'paragraph' && n.type !== 'doc') return false;
    if (n.type === 'paragraph' && (n.attrs?.align || n.attrs?.indent)) return false;
    return (n.content || []).every(walk);
  };
  return walk(clean.doc);
}
const hasDocValue = note => !!cleanDoc(note?.doc);
// 노트가 글만인가(첨부·사진·서식이 없음). 마크다운으로 보는 노트는 마크다운 표시(머리·굵게·표·코드·링크)가 없을 때만 글만.
export function noteIsPlain(note) {
  if (!note || hasAttachments(note)) return false;
  if (hasDocValue(note)) return docIsPlain(note.doc);
  const raw = String(note.raw_text || '');
  return !noteMarkdown(note) || !hasMarkdownMarks(raw);
}
// 보낼 글: 제목 + 빈 줄 + 본문(서식 없는 글). 둘 다 비면 null.
export function noteShareText(note) {
  const title = String(note?.title || '').replace(/\s+/g, ' ').trim();
  const body = (hasDocValue(note) ? toPlain(note.doc) : String(note?.raw_text || '').replace(/\r\n?/g, '\n')).trim();
  if (!title && !body) return null;
  return {title, body, text: title && body ? `${title}\n\n${body}` : title || body};
}
// 고르기 칸: 링크는 게시할 수 있을 때만.
export const noteShareChoices = ({canLink = true} = {}) => NOTE_SHARE_CHOICES.filter(([v]) => v !== 'link' || canLink);
// 내려받을·보낼 파일 이름: '노트 제목 2026-11-27.pdf' — 보드 내보내기와 같은 규칙(note-board-export-model.mjs exportFileName).
export const noteFileName = (title, ext, at) => exportFileName(String(title || '').trim() || '노트', ext, at);
