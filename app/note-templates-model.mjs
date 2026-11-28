// S69-97 노트 서식(NOTE-에버노트 ③, 설계 docs/design/note-evernote.md 4절): 서식 이름 검사와 서식을 노트 글에 넣기(화면 없음).
// 서식은 사람이 저장한 내 서식뿐이다(서버 표 app_note_templates, 주인만, migration 20261125131000).
// S71-65(사용자 결정 2026-11-26): 앱이 미리 넣어 두던 서식 셋은 없앴다.
export const TEMPLATE_NAME_MAX = 40;
export const TEMPLATE_MAX = 50; // 한 사람이 저장하는 서식 수(화면이 지킨다)
// 내 서식이 하나도 없을 때 고르기 창·노트 목록 ⋯ [서식으로 새 노트]가 함께 쓰는 안내 한 줄.
export const TEMPLATE_EMPTY_HINT = '노트 ⋯ [서식으로 저장]으로 내 서식을 만들어요.';

export function checkTemplateName(name) {
  const v = String(name ?? '').trim();
  if (!v) return '서식 이름을 써 주세요.';
  if ([...v].length > TEMPLATE_NAME_MAX) return `서식 이름은 ${TEMPLATE_NAME_MAX}자까지 쓸 수 있어요.`;
  if (/[\u0000-\u001f\u007f]/.test(v)) return '서식 이름에 쓸 수 없는 글자가 있어요.';
  return '';
}
// 서식을 노트 글에 넣기: 빈 글이면 서식 그대로, 쓴 글이 있으면 그 뒤에 이어 붙인다. 구글 할 일 연결(gtask)과 체크 표시는 따라오지 않는다(빈 체크칸).
const strip = node => {
  if (!node || typeof node !== 'object') return node;
  const out = {...node};
  if (out.attrs && ('gtask' in out.attrs || 'checked' in out.attrs)) { const {gtask, checked, ...rest} = out.attrs; out.attrs = rest; }
  if (Array.isArray(out.content)) out.content = out.content.map(strip);
  return out;
};
export function templateBody(template) { return {v: 'ed1', doc: strip(template?.doc?.doc || {type: 'doc', content: []})}; }
export function joinTemplate(current, template) {
  const add = templateBody(template).doc.content || [];
  const now = current?.doc?.content || [];
  const empty = !now.length || (now.length === 1 && now[0].type === 'paragraph' && !(now[0].content || []).length);
  return {v: 'ed1', doc: {type: 'doc', content: empty ? add : [...now, ...add]}};
}
