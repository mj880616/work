// S69-97 노트 서식(NOTE-에버노트 ③, 설계 docs/design/note-evernote.md 4절): 기본 서식과 서식 이름 검사(화면 없음).
// 기본 서식 셋은 코드에만 있다(저장하지 않음, 고칠 수 없음). 내 서식은 서버 표 app_note_templates(주인만, migration 20261125131000).
// WORK ON+ 원칙: 기본 서식 글은 누구나 쓰는 일반 문구(특정 단체·업무 색 낱말 없음).
export const TEMPLATE_NAME_MAX = 40;
export const TEMPLATE_MAX = 50; // 한 사람이 저장하는 서식 수(화면이 지킨다)

const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: text ? [{type: 'text', text}] : []});
const h = text => ({type: 'heading', attrs: {level: 2}, content: [{type: 'text', text}]});
const bullets = (...items) => ({type: 'bullet_list', content: items.map(t => ({type: 'list_item', content: [p(t)]}))});
const checks = (...items) => ({type: 'bullet_list', attrs: {marker: 'check'}, content: items.map(t => ({type: 'list_item', content: [p(t)]}))});
const ed1 = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});

export const BUILTIN_TEMPLATES = [
  {key: 'meeting', name: '회의록', doc: ed1(h('일시·장소'), p(''), h('참석'), p(''), h('안건'), bullets(''), h('논의'), p(''), h('정한 것'), bullets(''), h('할 일'), checks(''))},
  {key: 'week', name: '주간 계획', doc: ed1(h('이번 주 목표'), bullets(''), h('월'), p(''), h('화'), p(''), h('수'), p(''), h('목'), p(''), h('금'), p(''), h('할 일'), checks(''), h('돌아보기'), p(''))},
  {key: 'call', name: '통화 기록', doc: ed1(h('누구와'), p(''), h('언제'), p(''), h('나눈 이야기'), bullets(''), h('다음에 할 일'), checks(''))},
];

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
