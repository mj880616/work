// READ-수정한창(사용자 요청 2026-11-28 "읽을 거리 수정 이렇게 문단별로 창을 구분하지 말고 걍 원문 전체를 노트처럼"): 글 보기 '원문 전체' [수정]을
// 노트와 같은 공용 편집기(ed-editor.js) 한 창으로 고칠 때, 원문 블록 ↔ 편집기 문서(ed1)를 바꾸는 순수 계산. DOM·서버 없음.
// - 원문 블록(body-edit-model.mjs): 문단 p · 소제목 h · 인용 quote(한 줄 글자) · 사진 img(https 주소·설명·대체 글).
// - 편집기 문서: 문단 → paragraph, 소제목 → heading(2), 인용 → blockquote, 사진 → image. 사진 주소는 편집기 문서에 넣지 않고
//   자리 표(pics: 'share:rd<n>' → 원래 사진 블록)로 따로 들고 있다가 저장할 때 되돌린다(편집기 사진 src 모양 PHOTO_SRC는 우리 사진 id만 받는다).
// - 되돌릴 때: 엔터로 나눈 줄은 문단 하나씩, 빈 줄은 빠진다(문단 지우기 = 글을 지우면 됨). 목록·표처럼 원문 블록에 없는 모양은 글자만 문단으로.
//   줄 안 바꿈(Shift+Enter)은 빈칸 하나. 꾸밈(굵게 등)은 원문 칸이 글자만 담으므로 남지 않는다(편집기는 서식 줄 없이 연다).
// - 밑줄은 블록 번호가 아니라 고른 글자(앞뒤 글 실마리)로 다시 찾으므로(text-highlights-model.mjs locate) 앞 문단을 지워도 같은 문장에 남는다.
import {DEFAULT_BODY} from './ed-schema.mjs';

const PIC = 'share:rd';
const para = (type, text, attrs) => ({type, ...(attrs ? {attrs} : {}), ...(text ? {content: [{type: 'text', text}]} : {})});

// 원문 블록 → {value: 편집기 저장 모양 {v:'ed1', doc}, pics: Map(자리 id → 사진 블록)}.
export function blocksToDoc(blocks) {
  const pics = new Map(), content = [];
  (Array.isArray(blocks) ? blocks : []).forEach((b, i) => {
    if (b?.t === 'img') {
      if (typeof b.src !== 'string' || !b.src) return;
      const id = PIC + i;
      pics.set(id, {t: 'img', src: b.src, cap: b.cap || null, alt: b.alt || null});
      content.push({type: 'image', attrs: {src: id, alt: String(b.cap || b.alt || '').slice(0, 200)}});
      return;
    }
    if (typeof b?.text !== 'string') return;
    if (b.t === 'h') content.push(para('heading', b.text, {level: 2}));
    else if (b.t === 'quote') content.push({type: 'blockquote', content: [para('paragraph', b.text, {style: DEFAULT_BODY})]});
    else if (b.t === 'p') content.push(para('paragraph', b.text, {style: DEFAULT_BODY}));
  });
  if (!content.length) content.push(para('paragraph', '', {style: DEFAULT_BODY}));
  return {value: {v: 'ed1', doc: {type: 'doc', content}}, pics};
}

const inlineText = node => (Array.isArray(node?.content) ? node.content : []).map(n => (n?.type === 'text' ? String(n.text || '') : n?.type === 'hard_break' ? ' ' : '')).join('');

// 편집기 저장 모양 → 원문 블록 초안(body-edit-model.mjs editBlocks가 빈 글을 빼고 모양·길이를 확인한다).
export function docToBlocks(value, pics) {
  const out = [], map = pics instanceof Map ? pics : new Map();
  const doc = value?.v === 'ed1' ? value.doc : value;
  const walk = (nodes, kind) => {
    for (const n of Array.isArray(nodes) ? nodes : []) {
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'image') { const pic = map.get(n.attrs?.src); if (pic) out.push({...pic}); continue; }
      if (n.type === 'paragraph') { out.push({t: kind, text: inlineText(n)}); continue; }
      if (n.type === 'heading') { out.push({t: kind === 'quote' ? 'quote' : 'h', text: inlineText(n)}); continue; }
      if (n.type === 'code_block') { for (const line of inlineText(n).split('\n')) out.push({t: kind, text: line}); continue; }
      if (n.type === 'blockquote') { walk(n.content, 'quote'); continue; }
      walk(n.content, kind); // 목록·표·접기·사진 묶음: 안쪽 글자·사진을 차례대로
    }
  };
  walk(doc?.content, 'p');
  return out;
}

