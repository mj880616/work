// 연결 안내 공용 부품(S62-16: TASK-구글할일연결문구 · FILES-구글드라이브아이콘연결전 · PROFILE-없음칸제목, HOME-연결안내한줄아래와 같은 모양).
// 모양: '안내 한 줄 → 그 아래 줄 왼쪽에 버튼 하나'(폭과 상관없이 늘 두 줄). 화면마다 따로 만들지 않고 이 한 곳에서 그린다.
// 연결 글 규칙(명진 11/15): 한 번도 연결 안 한 사람 = '연결', 연결은 했는데 권한만 빠진 사람 = '다시 연결'. 표기는 '구글', 말투는 '해요'체.
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
// button이 비면 글 한 줄만(연결할 길이 없는 경우).
export function connectNoteHtml({line, button = '', attrs = {}, boxAttrs = {}, role = ''} = {}) {
  const pairs = obj => Object.entries(obj || {}).filter(([k]) => ATTR_RE.test(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const btn = button ? `<button type="button" class="secondary connect-note-btn"${pairs(attrs)}>${esc(button)}</button>` : '';
  const r = role === 'status' || role === 'alert' ? ` role="${role}"` : '';
  return `<div class="connect-note" data-connect-note${pairs(boxAttrs)}${r}><p class="connect-note-line">${esc(line)}</p>${btn}</div>`;
}

// 서비스·상태로 바로 그리기(글은 CONNECT_TEXT 그대로). line을 주면 안내 줄만 바꾼다(버튼 글은 규칙 그대로).
export function connectNoteFor(service, mode = 'none', {line = '', attrs = {}, boxAttrs = {}, role = ''} = {}) {
  const t = connectText(service, mode);
  if (!t) return '';
  return connectNoteHtml({line:line || t.line, button:t.button, attrs, boxAttrs:{'data-connect-service':service, 'data-connect-mode':mode === 'reconnect' ? 'reconnect' : 'none', ...boxAttrs}, role});
}
