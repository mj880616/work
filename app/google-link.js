// MULTI-처음쓰는사람 ①(docs/design/new-user-start.md 2-2): 홈 그날 일정·할 일 칸이 읽기에 실패했을 때, 그 까닭이 '구글 연결이 아직 없음'
// 인지 '진짜 고장'인지를 서버 답으로 가른다. 읽기 실패 뒤에만 같은 Edge의 status(쓰기 없음, 소유자 JWT)를 한 번 묻는다 — 연결된 사람(운영자
// 포함)은 읽기가 성공하므로 이 묻기가 일어나지 않고 화면도 그대로다.
// - google-calendar ?action=status: 연결 행이 없으면 {connected:false}.
// - google-tasks ?action=status: 연결이 없으면 {connected:false}, 할 일 권한이 없으면 {needs_reconnect:true}.
// 연결 버튼은 일정 화면·할 일 화면과 같은 흐름이다(같은 Edge의 action=start가 준 주소로 이동). 새 저장소·새 Edge 없음.
const FN = {events:'google-calendar', tasks:'google-tasks'};

// 'none' = 연결한 적 없음, 'reconnect' = 연결은 있으나 권한을 다시 받아야 함, '' = 알 수 없음(진짜 고장으로 둔다).
export function linkFromStatus(kind, data) {
  if (!FN[kind] || !data || typeof data !== 'object') return '';
  if (data.connected === false) return 'none';
  if (kind === 'tasks' && data.needs_reconnect === true) return 'reconnect';
  return '';
}

export async function googleLinkState(kind, rt = window.KPTURuntime) {
  if (!FN[kind] || !rt?.api) return '';
  try { return linkFromStatus(kind, await rt.api(`/functions/v1/${FN[kind]}?action=status`)); } catch { return ''; }
}

const platform = () => /KPTUAndroid/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('native') === 'android' ? 'android' : 'web';

// 구글 연결 화면으로 이동한다. 주소를 받지 못하면 오류를 던진다(부르는 쪽이 한 줄로 알린다).
export async function startGoogleLink(kind, rt = window.KPTURuntime) {
  if (!FN[kind]) throw new Error('kind');
  const extra = kind === 'tasks' ? `&platform=${platform()}` : '';
  const data = await rt.api(`/functions/v1/${FN[kind]}?action=start${extra}`);
  if (!data?.url) throw new Error('연결 주소를 받지 못했어요.');
  location.href = data.url;
}

// 화면 글(명진 11/13: "~하면 ~가 여기 보여요").
export const LINK_TEXT = Object.freeze({
  events:{none:{line:'구글 캘린더를 연결하면 그날 일정이 여기 보여요.', button:'구글 캘린더 연결'}},
  tasks:{
    none:{line:'구글 할 일을 연결하면 할 일이 여기 보여요.', button:'구글 할 일 연결'},
    reconnect:{line:'구글 할 일 권한을 다시 연결하면 할 일이 여기 보여요.', button:'다시 연결'},
  },
});
export const linkText = (kind, link) => LINK_TEXT[kind]?.[link] || null;
