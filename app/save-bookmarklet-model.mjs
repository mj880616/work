// S69-BM 저장 버튼(북마클릿): PC 크롬 즐겨찾기 막대의 버튼 한 줄과 저장 창(app/save/)이 함께 쓰는 순수 계산. DOM 직접 조작·네트워크 없음(node --test).
// - 버튼이 넘기는 값은 지금 탭의 글 주소(location.href)와 제목(document.title) 둘뿐이다. 토큰·비밀값·사용자 id는 넣지 않는다.
// - 저장은 저장 창이 이 브라우저의 기존 WORK ON+ 로그인으로 기존 저장한 글 넣기 길(reading-data.js addItem → 표 app_reading_items, owner RLS)을 부른다.
//   원문은 저장한 글 화면이 열릴 때 기존 note-import 길로 받는다(reading.js autoRefetch — 저장 창은 원문 받기를 시작하지 않는다).
import {readingUrl, TITLE_MAX} from './reading-model.mjs';

export const SAVE_WINDOW = 'workonplus_save';
export const SAVE_FEATURES = 'popup,width=420,height=300';
export const TITLE_SEND_MAX = 300;
export const CLOSE_MS = 2500, CANCEL_CLOSE_MS = 1200;

// 앱 뿌리 주소(…/work/app/) → 저장 창 주소(…/work/app/save/).
export const saveAddress = appRoot => new URL('save/', appRoot).href;

// 버튼이 실제로 하는 일. 이 함수의 글자(toString)가 그대로 버튼 한 줄이 된다(시험은 이 함수를 페이지에서 직접 부른다).
// 팝업이 막히면 새 탭으로 연다.
export function openSave(w, s) {
  var t = String(w.document.title || '').slice(0, 300);
  var u = s + '?u=' + encodeURIComponent(w.location.href) + '&t=' + encodeURIComponent(t);
  var p = w.open(u, 'workonplus_save', 'popup,width=420,height=300');
  if (!p) w.open(u, '_blank');
}

// 즐겨찾기 막대에 붙여 넣을 한 줄(javascript:…). saveUrl은 저장 창 주소(로그인한 그 주소와 같은 출처여야 한다).
export function bookmarkletLine(saveUrl) {
  const src = openSave.toString().replace(/\s*\n\s*/g, '');
  return `javascript:(${src})(window,${JSON.stringify(String(saveUrl))});void 0`;
}

// 저장 창 주소의 ?u=·?t= → {ok, url, title} / {ok:false, reason}. http·https로 시작하는 주소만 받는다(http는 https로 바꿔 받음 — 손으로 넣기와 같은 규칙).
export function readSaveParams(search) {
  const p = new URLSearchParams(String(search || ''));
  const raw = String(p.get('u') || '').trim();
  if (!raw) return {ok: false, reason: 'empty'};
  if (!/^https?:\/\//i.test(raw)) return {ok: false, reason: 'scheme'};
  const got = readingUrl(raw);
  if (!got.ok) return {ok: false, reason: 'bad'};
  const title = String(p.get('t') || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return {ok: true, url: got.url, title};
}

// 저장 창 글자(화면에 보이는 것은 여기 한 곳).
export const SAVE_WORDS = Object.freeze({
  busy: '저장하는 중…', done: '저장됨 ✓', dup: '이미 저장됨', cancel: '취소', canceled: '취소했어요', cancelFail: '취소하지 못했어요',
  fail: '저장하지 못했어요', retry: '다시', login: '로그인한 뒤 이어서 저장해요…', noWorkspace: '먼저 앱을 한 번 열어 시작해 주세요',
  empty: '저장할 글 주소를 받지 못했어요', scheme: 'http·https 주소만 저장할 수 있어요', bad: '이 주소는 저장할 수 없어요', framed: '이 창에서는 저장할 수 없어요',
});
export const reasonWord = reason => SAVE_WORDS[reason] || SAVE_WORDS.bad;
