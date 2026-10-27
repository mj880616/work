// HWP-서식변환(노조 서식으로 만들기)의 화면 없는 부분: 문서 종류, AI 답 검사, 번호 기호 붙이기, 스타일 대응, 파일 이름.
// 시험(tests/hwp-convert.test.mjs)이 같은 코드를 부른다. 기준: docs/hwp-style-map.md 3절(Web2 → 한글 스타일·기호).
// AI(ai-assist kind=hwp_convert)는 문단 단계(l1~l7·참고·일반)만 정하고, 번호 기호(1. 1) (1) ① 가. 가) (가))는 여기서 붙인다.
import {orderedLabel} from './ed-schema.mjs';

export const DOC_TYPES = Object.freeze([
  {id: 'report', label: '보고서'},
  {id: 'letter', label: '공문'},
  {id: 'meeting', label: '회의자료'},
]);
export const CONVERT_MAX_CHARS = 20000;
export const CONVERT_MAX_BLOCKS = 400;
export const CONVERT_BLOCK_CHARS = 600;
const KINDS = new Set(['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'note', 'body']);

// 단계 → 한글 스타일 이름(양식의 DocInfo 스타일 이름과 같다). 5~7단계는 바탕글 + 기호.
export const STYLE_NAMES = Object.freeze({
  title: '안건제목', l1: '큰 제목', l2: '중간 제목', l3: '작은 제목', l4: '최하위 제목[강조]',
  l5: '바탕글', l6: '바탕글', l7: '바탕글', note: '세부 참고사항', body: '바탕글',
});

// 단계 n번째 항목의 기호: 1. → 1) → (1) → ① → 가. → 가) → (가). 가나다 14자를 넘으면 숫자로 이어 간다.
export function levelLabel(level, n) {
  if (level === 1) return orderedLabel('decimal', 0, n);
  if (level === 2) return orderedLabel('paren', 1, n);
  if (level === 3) return orderedLabel('parens', 2, n);
  if (level === 4) return orderedLabel('circled', 3, n);
  const base = orderedLabel('hangul', 4, n).replace(/\.$/, '');
  if (level === 5) return base + '.';
  if (level === 6) return base + ')';
  return '(' + base + ')';
}

const one = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const chars = text => [...text].length;
const BAD = /[\u0000-\u001f\u007f-\u009f<>]/;

// 서버 답(믿지 않는 입력) → {title, blocks, dropped} 또는 null. 서버가 이미 검사한 것을 화면이 한 번 더 본다.
export function convertAnswer(data) {
  if (!data || data.ok !== true || data.kind !== 'hwp_convert' || typeof data.title !== 'string' || !Array.isArray(data.blocks)) return null;
  const title = one(data.title);
  if (!title || chars(title) > 100 || BAD.test(title) || !data.blocks.length || data.blocks.length > CONVERT_MAX_BLOCKS) return null;
  const blocks = [];
  let dropped = Number.isSafeInteger(data.dropped) && data.dropped > 0 ? data.dropped : 0;
  for (const block of data.blocks) {
    const text = one(block?.text);
    if (!KINDS.has(block?.kind) || !text || chars(text) > CONVERT_BLOCK_CHARS || BAD.test(text)) { dropped++; continue; }
    blocks.push({kind: block.kind, text});
  }
  return blocks.length ? {title, blocks, dropped} : null;
}

// 단계마다 번호를 세어 기호를 붙인다. 위 단계가 나오면 아래 단계 번호는 1부터 다시. 참고 줄은 '* ', 일반 문단은 글 그대로.
export function numberBlocks(blocks) {
  const counters = [0, 0, 0, 0, 0, 0, 0, 0];
  return blocks.map(block => {
    if (block.kind === 'body') return {text: block.text, style: STYLE_NAMES.body};
    if (block.kind === 'note') return {text: '* ' + block.text.replace(/^[*※]\s*/, ''), style: STYLE_NAMES.note};
    const level = Number(block.kind.slice(1));
    counters[level] += 1;
    for (let deeper = level + 1; deeper < counters.length; deeper++) counters[deeper] = 0;
    return {text: `${levelLabel(level, counters[level])} ${block.text}`, style: STYLE_NAMES[block.kind]};
  });
}

export const pad2 = n => String(n).padStart(2, '0');
// 양식 누름틀 "날짜"에 넣는 글: 2026. 10. 27.
export const planDate = now => `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}.`;
// 편집기 위 줄에 보이는 파일 이름: 보고서_1027.hwp
export function convertedFileName(docType, now) {
  const label = DOC_TYPES.find(row => row.id === docType)?.label || '문서';
  return `${label}_${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.hwp`;
}

export function buildPlan(answer, now) {
  return {title: answer.title, date: planDate(now), paragraphs: numberBlocks(answer.blocks)};
}

// 끌어 놓은 파일: 글 파일(.md .markdown .txt)만, 1MB까지.
export const DROP_MAX_BYTES = 1024 * 1024;
export const isTextFile = file => /\.(?:md|markdown|txt|text)$/i.test(String(file?.name || '')) || /^text\//i.test(String(file?.type || ''));
export function dropProblem(file) {
  if (!file) return '파일을 읽지 못했어요.';
  if (!isTextFile(file)) return '글 파일(.md·.txt)만 끌어 놓을 수 있어요. 다른 파일은 열어서 글을 복사해 붙여 넣어 주세요.';
  if (file.size > DROP_MAX_BYTES) return '파일이 너무 커요. 1MB까지 끌어 놓을 수 있어요.';
  return '';
}
export const cleanPasted = text => String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
export const textState = text => {
  const trimmed = cleanPasted(text).trim();
  const count = chars(trimmed);
  return {count, empty: !trimmed, tooLong: count > CONVERT_MAX_CHARS, text: trimmed};
};
