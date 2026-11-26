// 연결 안내 공용 부품(S62-16: TASK-구글할일연결문구 · FILES-구글드라이브아이콘연결전 · PROFILE-없음칸제목, HOME-연결안내한줄아래와 같은 모양).
// 모양: '안내 한 줄 → 그 아래 줄 왼쪽에 버튼 하나'(폭과 상관없이 늘 두 줄). 화면마다 따로 만들지 않고 이 한 곳에서 그린다.
// 연결 글 규칙(사용자 11/15): 한 번도 연결 안 한 사람 = '연결', 연결은 했는데 권한만 빠진 사람 = '다시 연결'. 표기는 '구글', 말투는 '해요'체.
// 모양 CSS는 base-ui.css의 .connect-note 하나. 무엇을 누르는지는 화면마다 속성(attrs)으로 알아본다.

const ESC = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const ATTR_RE = /^data-[a-z0-9-]{1,60}$/;

// 서비스별 글. none = 처음 연결, reconnect = 권한이 빠져 다시 연결.
export const CONNECT_TEXT = Object.freeze({
  tasks:Object.freeze({
    none:Object.freeze({line:'구글 할 일을 연결하면 여기서 같이 볼 수 있어요.', button:'구글 할 일 연결'}),
    reconnect:Object.freeze({line:'구글 할 일 권한이 빠졌어요. 다시 연결하면 여기서 같이 볼 수 있어요.', button:'구글 할 일 다시 연결'}),
  }),
  calendar:Object.freeze({
    none:Object.freeze({line:'구글 캘린더를 연결하면 일정이 여기 보여요.', button:'구글 캘린더 연결'}),
  }),
  gdrive:Object.freeze({
    none:Object.freeze({line:'구글 드라이브 연결 뒤 쓸 수 있어요.', button:'구글 드라이브 연결'}),
    reconnect:Object.freeze({line:'구글 드라이브 권한이 빠졌어요. 다시 연결하면 쓸 수 있어요.', button:'구글 드라이브 다시 연결'}),
  }),
  onedrive:Object.freeze({
    none:Object.freeze({line:'원드라이브 연결 뒤 쓸 수 있어요.', button:'원드라이브 연결'}),
    reconnect:Object.freeze({line:'원드라이브 연결이 풀렸어요. 다시 연결하면 쓸 수 있어요.', button:'원드라이브 다시 연결'}),
  }),
});

// mode: 'none'(처음) | 'reconnect'(권한 빠짐). 모르는 서비스·없는 짝은 null(지어내지 않음).
export function connectText(service, mode = 'none') {
  const s = CONNECT_TEXT[service];
  if (!s) return null;
  return s[mode === 'reconnect' ? 'reconnect' : 'none'] || null;
}

// 안내 한 줄 + 아래 버튼 HTML. attrs: 버튼에 붙일 data-* 속성({'data-gt-connect':''}), boxAttrs: 바깥 칸 data-* 속성.
// 버튼이 여럿이면 buttons: [{label, attrs}] — 아래 줄에 왼쪽부터 나란히. 버튼이 없으면 글 한 줄만(연결할 길이 없는 경우).
// why: 이유 작은 글자(안내 줄 끝), cls: 바깥 칸에 더할 클래스(화면 자리 맞춤용, 모양은 바꾸지 않음).
export function connectNoteHtml({line, button = '', attrs = {}, buttons = null, boxAttrs = {}, role = '', why = '', cls = ''} = {}) {
  const pairs = obj => Object.entries(obj || {}).filter(([k]) => ATTR_RE.test(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const list = (Array.isArray(buttons) ? buttons : button ? [{label:button, attrs}] : []).filter(x => x?.label);
  const one = x => `<button type="button" class="secondary connect-note-btn"${pairs(x.attrs)}>${esc(x.label)}</button>`;
  const btn = list.length > 1 ? `<span class="connect-note-btns">${list.map(one).join('')}</span>` : list.map(one).join('');
  const r = role === 'status' || role === 'alert' ? ` role="${role}"` : '';
  const c = /^[a-z0-9 -]{1,80}$/.test(cls) ? ` ${cls}` : '';
  const w = why ? ` <small class="connect-note-why">${esc(why)}</small>` : '';
  return `<div class="connect-note${c}" data-connect-note${pairs(boxAttrs)}${r}><p class="connect-note-line">${esc(line)}${w}</p>${btn}</div>`;
}

// 서비스·상태로 바로 그리기(글은 CONNECT_TEXT 그대로). line을 주면 안내 줄만 바꾼다(버튼 글은 규칙 그대로).
export function connectNoteFor(service, mode = 'none', {line = '', attrs = {}, boxAttrs = {}, role = '', why = '', cls = ''} = {}) {
  const t = connectText(service, mode);
  if (!t) return '';
  return connectNoteHtml({line:line || t.line, button:t.button, attrs, boxAttrs:{'data-connect-service':service, 'data-connect-mode':mode === 'reconnect' ? 'reconnect' : 'none', ...boxAttrs}, role, why, cls});
}

// S62-36 UI-클라우드연결안내통일(사용자 11/16): 원드라이브·구글 드라이브를 둘 다 쓰는 화면에서 둘 다 연결 전이면
// [파일] 화면과 같은 한 칸 — '연결된 클라우드가 없어요.' 한 줄 + 그 아래 연결 버튼들 한 줄([원드라이브 연결][구글 드라이브 연결]).
// items: [{service:'onedrive'|'gdrive', attrs}] — 연결 안 된 것만 넘긴다(넘긴 순서대로 왼쪽부터). 버튼 글은 CONNECT_TEXT 그대로.
export const CLOUD_NONE_LINE = '연결된 클라우드가 없어요.';
export function cloudNoneHtml(items = [], {boxAttrs = {}, cls = ''} = {}) {
  const buttons = (Array.isArray(items) ? items : []).map(x => ({label:connectText(x?.service, 'none')?.button || '', attrs:x?.attrs || {}})).filter(x => x.label);
  if (!buttons.length) return '';
  return connectNoteHtml({line:CLOUD_NONE_LINE, buttons, boxAttrs:{'data-connect-cloud-none':'', ...boxAttrs}, cls});
}
