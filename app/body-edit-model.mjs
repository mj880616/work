// S71-68 ② READ-원문고치기(사용자 결정 2026-11-26 "읽을 거리에서 불필요한 글자 가져온 거 직접 수정 가능하게 수정 버튼 추가"): 글 보기 '원문 전체' [수정]의 모양 규칙. DOM·서버 없음.
// - 저장 표 public.app_feed_body_edits(DB 20261126233000): 작업공간마다 글 하나에 '직접 수정한 원문' 한 줄(owner RLS). 공용 원문(모두가 읽는 줄)은 그대로.
// - 블록 모양은 공용 본문과 같다(DB 검사 같음): 문단 p·소제목 h·인용 quote(제어 글자 없는 한 줄 글자)·사진 img(https 주소·설명·대체 글 300자).
// - 고친 블록에서 사라진 밑줄(고른 글을 새 원문에서 못 찾는 것)은 함께 삭제한다(저장 전에 'n개도 함께 삭제돼요' 확인).
import {locate} from './text-highlights-model.mjs';

export const EDIT_TABLE = 'app_feed_body_edits';
export const EDIT_LABEL = '직접 수정';
export const EDIT_TEXT_TOTAL = 110000; // DB 검사(블록 글자 JSON 배열 길이)와 같은 값
export const EDIT_BLOCKS_MAX = 400;
const CAP_MAX = 300;
// deno-lint-ignore no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b\ufeff]/g;
const oneLine = v => String(v ?? '').replace(CTRL, ' ').replace(/\s+/g, ' ').trim();
const httpsSrc = v => (typeof v === 'string' && /^https:\/\/[^\s"<>\u0000-\u001f\u007f-\u009f]{1,1990}$/.test(v) ? v : null);
const TEXT_KINDS = ['p', 'h', 'quote'];
export const editCol = type => (type === 'news' ? 'news_article_id' : type === 'outside' ? 'outside_article_id' : null);

// 화면 블록(공용 본문·직접 수정본) → 고치기 칸 초안(차례대로, k = 처음 자리 — 접근성 이름·끌기 없이 그대로 둔다).
export function draftOf(blocks) {
  return (Array.isArray(blocks) ? blocks : []).flatMap((b, k) => {
    if (b?.t === 'img') { const src = httpsSrc(b.src); return src ? [{t: 'img', src, cap: b.cap ? oneLine(b.cap).slice(0, CAP_MAX) || null : null, alt: b.alt ? oneLine(b.alt).slice(0, CAP_MAX) || null : null, k}] : []; }
    return TEXT_KINDS.includes(b?.t) && typeof b.text === 'string' ? [{t: b.t, text: b.text, k}] : [];
  });
}
// 초안 → 저장할 블록. 빈 글은 뺀다(문단을 비우면 그 문단 삭제). 답 {blocks} 또는 {error}.
export function editBlocks(draft) {
  const out = [];
  for (const b of Array.isArray(draft) ? draft : []) {
    if (b?.t === 'img') {
      const src = httpsSrc(b.src);
      if (!src) continue;
      const cap = b.cap ? oneLine(b.cap).slice(0, CAP_MAX) : '', alt = b.alt ? oneLine(b.alt).slice(0, CAP_MAX) : '';
      out.push({t: 'img', src, cap: cap || null, alt: alt || null});
      continue;
    }
    const text = oneLine(b?.text);
    if (text) out.push({t: TEXT_KINDS.includes(b?.t) ? b.t : 'p', text});
  }
  if (!out.length) return {error: '남은 문단이 없어요 · 그대로 두려면 [취소]'};
  if (out.length > EDIT_BLOCKS_MAX) return {error: `문단이 너무 많아요 · ${EDIT_BLOCKS_MAX}개까지`};
  if (JSON.stringify(out.filter(b => b.t !== 'img').map(b => b.text)).length > EDIT_TEXT_TOTAL) return {error: '글이 너무 길어요'};
  return {blocks: out};
}
export const sameBlocks = (a, b) => JSON.stringify(editBlocks(draftOf(a)).blocks || []) === JSON.stringify(editBlocks(draftOf(b)).blocks || []);
// 서버 줄(넣기·고치기 몸통). 글 종류가 틀리면 null.
export function editRow(workspaceId, item, blocks, nowIso = new Date().toISOString()) {
  const col = editCol(item?.type);
  if (!col || typeof workspaceId !== 'string' || !workspaceId || typeof item.id !== 'string') return null;
  return {workspace_id: workspaceId, [col]: item.id, blocks, edited_at: nowIso};
}
// 서버 줄 → 글 보기 원문 칸 모양(공용 본문 bodyView와 같은 칸 + edited). 모양이 틀리면 null(공용 원문을 그린다).
export function editView(row) {
  const blocks = editBlocks(draftOf(row?.blocks)).blocks;
  return blocks ? {state: 'ok', reason: '', blocks, edited: true, at: typeof row.edited_at === 'string' ? row.edited_at : null} : null;
}
const textOf = blocks => (Array.isArray(blocks) ? blocks : []).filter(b => b && b.t !== 'img' && typeof b.text === 'string').map(b => b.text).join('\n');
// 고치기 전 원문에서 찾히던 밑줄 중 고친 원문에서 못 찾는 것(지운 문단·고친 글에 걸린 밑줄). 남은 문단 밑줄은 글자로 다시 찾으므로 그대로 남는다.
export function lostMarks(beforeBlocks, afterBlocks, marks) {
  const before = textOf(beforeBlocks), after = textOf(afterBlocks);
  return (Array.isArray(marks) ? marks : []).filter(h => h && locate(before, h) && !locate(after, h));
}
export const lostNote = n => `밑줄 ${n}개도 함께 삭제돼요`;
