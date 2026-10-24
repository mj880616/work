// ED③ 1단계: 옛 마크다운 노트를 새 편집기 형식(ed1)으로 한 번에 바꾸는 계산(DOM 없음, Node 시험이 그대로 돈다). 1회용이다:
// 변환이 끝나고 대조까지 마치면 다음 PR에서 note-convert.js·이 파일·[옛 마크다운 노트 변환] 메뉴를 함께 지운다.
// 설계 docs/design/unified-editor.md 4.1·11.3, 2026-10-24 명진 결정 1(열 때 하나씩이 아니라 노트 화면 PR 직전에 한 번에).
//
// 대상: kind=note이고 아직 doc이 없으며, 지금 읽기 화면이 마크다운으로 읽는 노트(noteMarkdown: 저장된 [마크다운] 값, 값이 없으면 기호 추정).
//   [마크다운]을 끈 노트(쓴 그대로)는 바꾸지 않는다 — 새 화면이 열 때 글자 그대로 연다(plainToDocKeep, 글자가 바뀌지 않음).
// 백업 조건: app_ed3_text_backups에 그 노트의 행이 있고, 백업 때 고친 시각이 지금 노트의 고친 시각과 같아야 한다(백업 뒤 고친 노트는
//   원본이 백업에 없으므로 건너뜀). 저장도 같은 조건(updated_at=백업 값, doc 비어 있음)으로만 한다.
// 바꾸기: 편집기의 [서식으로 바꾸기]와 같은 markdownToDoc(같은 markdown-it 설정), 글자 사본은 toPlain. 그 전에 지금 읽기 화면과 같은
//   guardDateLines(markdown-render.mjs)를 거쳐 "2026. 10. 21."로 시작하는 줄이 번호 목록이 되지 않게 한다(지금 보이는 그대로). 고친 시각(updated_at)은 그대로 둔다
//   (변환은 사람이 고친 것이 아니다: 목록 순서·"고친 날"이 바뀌지 않고, 되돌릴 때 "변환 뒤 손대지 않은 노트"를 고친 시각으로 가려낸다).
// 확인 필요: 바꾼 글자 사본에서 원문의 글자(기호·링크 주소 제외)가 하나라도 빠지면 바꾸지 않고 목록에 남긴다(예: [a]: 주소 같은 참조 줄).
import {noteMarkdown} from './note-markdown.mjs';
import {markdownToDoc} from './ed-markdown.mjs';
import {guardDateLines} from './markdown-render.mjs';
import {toPlain} from './ed-text.mjs';
import {cleanDoc} from './ed-schema.mjs';
import {jsonbBytes, DOC_MAX_BYTES} from './ed-window-model.mjs';

export const NOTE_TEXT_MAX = 100000;
export const CONVERT_TEXT = Object.freeze({
  menu: '옛 마크다운 노트 변환',
  confirm: n => `마크다운으로 쓴 옛 노트 ${n}개를 새 편집기 형식으로 바꿀까요? 원본은 따로 보관돼 있고, 하나씩 저장합니다. 바꾼 노트는 옛 글자 그대로 보기로 돌아가지 않습니다(되돌리기는 커맨드센터 SQL).`,
  noBackup: '원본 보관(백업)이 아직 없어 시작하지 않았어요. 백업을 먼저 적용해 주세요.',
  backupFailed: '원본 보관 목록을 읽지 못해 시작하지 않았어요.',
  listFailed: '노트 목록을 읽지 못해 시작하지 않았어요.',
  nothing: '바꿀 옛 마크다운 노트가 없어요.',
});

// Letters and digits only, as a count per character (marks, spaces and punctuation are not compared).
const LETTER = /[\p{L}\p{N}]/gu;
const counts = text => { const m = new Map(); for (const ch of String(text).match(LETTER) || []) m.set(ch, (m.get(ch) || 0) + 1); return m; };
// The written letters a reader sees: link and image addresses, fence language names and callout names are not text in the read view.
export function readableLetters(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n')
    .replace(/(!?\[[^\]\n]*\])\((?:[^()\s]+|\([^()\s]*\))*(?:\s+"[^"\n]*")?\)/g, '$1')
    .replace(/^(\s{0,3}(?:`{3,}|~{3,}))[^\n]*$/gm, '$1')
    .replace(/^\s{0,3}\[[^\]\n]+\]:[ \t]*\S+.*$/gm, '')
    .replace(/\]\[[^\]\n]*\]/g, ']')
    .replace(/^(\s*(?:>\s*)+)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gim, '$1');
}
// The letters of `raw` (as read) that the converted text does not have, e.g. "가×1". [] when nothing is lost.
export function missingLetters(raw, text) {
  const want = counts(readableLetters(raw)), have = counts(text), out = [];
  for (const [ch, n] of want) { const got = have.get(ch) || 0; if (got < n) out.push(`${ch}×${n - got}`); }
  return out;
}

const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

// One note → {ok:true, doc, text} or {ok:false, reason, detail?}. md: a markdown-it instance with the editor's settings.
export function convertNote(md, note) {
  const raw = String(note?.raw_text ?? '');
  let doc;
  try { doc = cleanDoc(markdownToDoc(md, guardDateLines(raw))); } catch { return {ok:false, reason:'convert'}; }
  if (!doc) return {ok:false, reason:'convert'};
  const text = toPlain(doc);
  if (text.length > NOTE_TEXT_MAX) return {ok:false, reason:'too_long'};
  if (jsonbBytes(doc) > DOC_MAX_BYTES) return {ok:false, reason:'too_big'};
  const lost = missingLetters(raw, text);
  if (lost.length) return {ok:false, reason:'letters', detail:lost.slice(0, 8).join(' ')};
  return {ok:true, doc, text};
}

// notes: kind=note rows {id, title, raw_text, metadata, updated_at, doc}; backups: rows {row_id, row_updated_at}.
// → {todo:[note], changed:[note] (edited after the backup), noBackup:[note], already, plain, total}
export function buildConvertPlan(notes, backups) {
  const backed = new Map((backups || []).map(b => [b.row_id, b.row_updated_at]));
  const plan = {todo:[], changed:[], noBackup:[], already:0, plain:0, total:0};
  for (const note of notes || []) {
    if (note.doc) { plan.already++; continue; }
    if (!noteMarkdown({...note, metadata:plainObject(note.metadata) ? note.metadata : {}})) { plan.plain++; continue; }
    plan.total++;
    if (!backed.has(note.id)) plan.noBackup.push(note);
    else if (!sameTime(backed.get(note.id), note.updated_at)) plan.changed.push(note);
    else plan.todo.push(note);
  }
  return plan;
}
export const sameTime = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);

// Random sample of up to n converted results (for the side-by-side check). random: () => [0,1).
export function sample(list, n = 5, random = Math.random) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy.slice(0, n);
}

const REASONS = {convert:'변환 실패', too_long:'바꾼 글이 10만 자를 넘음', too_big:'서식이 1MB를 넘음', letters:'바꾸면 글자가 빠짐', changed:'백업 뒤에 고친 노트', no_backup:'백업에 없는 노트', moved:'그사이 바뀜', failed:'저장 실패'};
export const reasonText = (reason, detail) => (REASONS[reason] || reason) + (detail ? ` (${detail})` : '');
export function progressText(s) {
  if (s.finished) return resultText(s);
  return `바꾸는 중 ${s.index}/${s.todo} · 바꿈 ${s.done} · 건너뜀 ${s.skipped.length}`;
}
export function resultText(r) {
  if (r.status === 'refused') return r.message;
  return `${r.status === 'stopped' ? '멈춤: ' + r.message + ' · ' : ''}바꿈 ${r.done} · 건너뜀 ${r.skipped.length} · 이미 바뀜 ${r.already} (마크다운 노트 ${r.total})`;
}
