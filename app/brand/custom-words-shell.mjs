// APP-기록+이름바꾸기(S67-44): 앱 바탕(index.html에 처음부터 있는 글자)에 '내가 고친 이름'을 한 번 입힌다.
// loader-v2.js가 고친 이름이 있을 때만(brand.mjs CUSTOMIZED), 화면 모듈을 부르기 전·자료를 그리기 전·화면 공개 전에 한 번 부른다.
// 그때 화면에는 index.html 글자뿐이라 사용자가 쓴 글(이름·제목·내용)은 지나가지 않는다. 다시 부르지 않는다(덮어 그리기 없음).
// 바꾸는 것: 태그 사이 글자와 aria-label·alt·title·placeholder 값(빌드의 얼굴 입히기 scripts/brand-face.mjs와 같은 범위). 코드·입력값은 그대로.
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
const ATTRS = ['aria-label', 'alt', 'title', 'placeholder'];

export function applyShellWords(root, word) {
  if (!root || typeof word !== 'function') return 0;
  const doc = root.ownerDocument || root;
  let changed = 0;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode: node => {
      for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        if (SKIP.has(el.tagName) || el.isContentEditable || el.hasAttribute?.('contenteditable')) return 2; // FILTER_REJECT
      }
      return node.nodeValue && node.nodeValue.trim() ? 1 : 3; // FILTER_ACCEPT : FILTER_SKIP
    }
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = word(node.nodeValue);
    if (typeof next === 'string' && next !== node.nodeValue) { node.nodeValue = next; changed += 1; }
  }
  for (const el of root.querySelectorAll(ATTRS.map(name => `[${name}]`).join(','))) {
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value || !value.trim()) continue;
      const next = word(value);
      if (typeof next === 'string' && next !== value) { el.setAttribute(name, next); changed += 1; }
    }
  }
  return changed;
}
