// NOTE-읽생기아이디어 ① 댓글: 유형·글 검사·모아 보기 거르기(화면 없는 계산만). 표는 app_note_comments(migration 20261102203000).
// 유형은 지금 세 가지(생각·질문·인용). 표의 kind는 글자라 다음 단계(유형 더하기·이름 바꾸기)에서 표를 바꾸지 않는다.
export const COMMENT_KINDS = Object.freeze([
  Object.freeze({key: 'thought', name: '생각'}),
  Object.freeze({key: 'question', name: '질문'}),
  Object.freeze({key: 'quote', name: '인용'}),
]);
// 표의 검사와 같은 숫자(app_note_comments_body_check·quote_check).
export const COMMENT_LIMITS = Object.freeze({body: 4000, quote: 1000});

export const kindName = key => COMMENT_KINDS.find(k => k.key === key)?.name || String(key || '');

// 본문에서 고른 문장 → 인용 글. 줄바꿈·연속 띄어쓰기는 한 칸으로, 1000자까지. 빈 글이면 null.
export function quoteFromSelection(text) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one ? [...one].slice(0, COMMENT_LIMITS.quote).join('') : null;
}

// 저장 전 검사(표가 같은 규칙으로 다시 막는다). 통과하면 보낼 값, 아니면 오류(쉬운 말).
export function commentDraft({kind, quote, body}) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('댓글을 써 주세요.');
  if ([...text].length > COMMENT_LIMITS.body) throw new Error(`댓글은 ${COMMENT_LIMITS.body}자까지 쓸 수 있어요.`);
  const k = COMMENT_KINDS.some(x => x.key === kind) ? kind : 'thought';
  const q = k === 'quote' ? quoteFromSelection(quote) : null;
  return {kind: k, quote: q, body: text};
}

// 모아 보기: 유형(null = 전체)·검색어로 거르고 최근 쓴 순. 노트가 목록에 없는(휴지통 등) 댓글은 뺀다.
export function commentRows(comments, {kind = null, query = '', noteById}) {
  const q = String(query || '').toLowerCase();
  return (comments || [])
    .filter(c => noteById(c.note_id))
    .filter(c => !kind || c.kind === kind)
    .filter(c => !q || `${c.body || ''}\n${c.quote || ''}\n${noteById(c.note_id)?.title || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0) || String(b.id).localeCompare(String(a.id)));
}

// 노트 하나의 댓글: 쓴 차례(오래된 것 위).
export const commentsOf = (comments, noteId) => (comments || []).filter(c => c.note_id === noteId)
  .sort((a, b) => (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0) || String(a.id).localeCompare(String(b.id)));

// 노트 검색에 댓글도 걸리게: 그 노트 댓글 글·인용을 한 줄로.
export const commentText = (comments, noteId) => (comments || []).filter(c => c.note_id === noteId).map(c => `${c.body || ''}\n${c.quote || ''}`).join('\n');
