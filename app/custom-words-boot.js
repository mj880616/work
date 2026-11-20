// APP-기록+이름바꾸기(S67-44): 고친 이름이 있으면 앱 바탕(index.html 글자)에 한 번 입힌다. loader-v2.js가 화면 모듈을 부르기 전에 한 번만 부른다.
// brand.mjs는 고친 이름 약속(loader의 window.__KPTU_CUSTOM_WORDS__)을 기다린 뒤 끝나므로, 이 모듈이 끝나면 이름이 정해져 있다.
// 고친 이름이 없으면(대부분) 아무것도 하지 않는다. 바꾸는 범위와 규칙은 brand/custom-words-shell.mjs.
import {CUSTOMIZED, word} from './brand/brand.mjs';

if (CUSTOMIZED) {
  const {applyShellWords} = await import('./brand/custom-words-shell.mjs');
  applyShellWords(document.body, word);
}
