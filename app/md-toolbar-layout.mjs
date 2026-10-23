// MD-서식줄묶음: the big markdown editor's format buttons and how a phone groups them (pure data; md-editor.js draws it, tests read it).
// [label, action, option, aria] — option groups open a second row of choices.
export const TOOLS = [
  ['제목', 'heading-menu', null, '제목 단계 고르기'],
  ['굵게', 'bold'], ['기울임', 'italic'],
  ['• 목록', 'bullet', null, '글머리 목록'], ['1. 번호', 'number', null, '번호 목록'], ['☐ 체크', 'task', null, '체크 목록'],
  ['표', 'table', null, '표 틀 넣기'], ['인용', 'quote'], ['코드', 'code'],
  ['강조 상자', 'callout-menu', null, '강조 상자 종류 고르기'], ['구분선', 'rule'],
  ['도식', 'mermaid-menu', null, 'Mermaid 도식 틀 고르기'],
  ['↶ 되돌리기', 'undo', null, '되돌리기'], ['↷ 다시하기', 'redo', null, '다시하기'],
];

// MD-서식줄묶음 (2026-10-23, same rule as the doc editor's ED-서식줄묶음): on a phone (max-width 760px) the format row is grouped to fit one line:
//   [제목 ▾] [굵게] [글자 ▾] [문단 ▾] [넣기 ▾] [↶] [↷]   ([☐ 마크다운] at the start in a note window)
//   글자 ▾ = 기울임 코드 / 문단 ▾ = • 목록 1. 번호 ☐ 체크 인용 구분선 / 넣기 ▾ = 표 강조 상자 ▾ 도식 ▾ (📎 첨부 in a note window)
// This editor has no [·] and no 기호 group (it has no sign buttons), so those two are not made. The grouped buttons are the same nodes
// (moved, so command and state stay); a group and the 제목·강조 상자·도식 choices open right under the pressed button (toolbar-pop.js).
export const GROUPS = [
  ['g-text', '글자 ▾', '글자 서식 고르기', ['italic', 'code']],
  ['g-para', '문단 ▾', '문단 서식 고르기', ['bullet', 'number', 'task', 'quote', 'rule']],
  ['g-insert', '넣기 ▾', '넣을 것 고르기', ['table', 'callout-menu', 'mermaid-menu']],
];
export const GROUP_KEYS = GROUPS.map(g => g[0]);
export const PHONE_ORDER = ['heading-menu', 'bold', ...GROUP_KEYS, 'undo', 'redo'];
// What the row shows on a phone instead of the wide-screen text (the accessible names stay).
export const PHONE_LABELS = {'heading-menu': '제목 ▾', 'callout-menu': '강조 상자 ▾', 'mermaid-menu': '도식 ▾', undo: '↶', redo: '↷'};

