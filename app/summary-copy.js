// 요약 복사 공용 부품: 작은 [복사] 아이콘 버튼 글자 틀과, 누르면 클립보드에 넣고 "복사했어요"를 잠깐 보이는 도우미.
// 복사 도우미는 copy-text.js 하나를 쓴다. 글 만들기는 summary-copy-model.mjs(순수 규칙).
import {copyText} from './copy-text.js';

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.3A1.3 1.3 0 0 0 2 3.3v5.9a1.3 1.3 0 0 0 1.3 1.3h.2"/></svg>';

// attrs: 화면마다 누름을 알아보는 속성(예: 'data-cf-copy'). 모양은 base-ui.css의 .copy-mini 하나.
export const copyButtonHtml = (attrs, label = '요약 복사') => `<button type="button" class="copy-mini" ${attrs} aria-label="${label}" title="${label}">${ICON}</button>`;

export const COPY_DONE = '복사했어요';
export const COPY_FAIL = '복사하지 못했어요. 다시 눌러 주세요.';

// say: 화면의 알림 줄에 글을 쓰는 함수, current: 지금 알림 줄 글(내가 쓴 글일 때만 지운다).
export async function copySummary(text, {say, current}) {
  const ok = text ? await copyText(text) : false, msg = ok ? COPY_DONE : COPY_FAIL;
  say(msg);
  setTimeout(() => { if (current() === msg) say(''); }, 2500);
  return ok;
}
