// SEARCH-결과원문으로(S71-15, 명진 11/26 15:34 "두 번째 결과를 내가 클릭하면은 그 결과에 해당하는 원문으로 가야 되는데 안 가더라고"):
// 전체 검색 결과를 눌러 연 원문 자리에서 찾은 낱말을 칠한다. 이 모듈이 'kptu-found' 칠의 유일한 주인이다.
//  - 판정은 화면 찾기와 같은 공용 판정(find-match-model.mjs — 띄어쓰기 무시·초성·오타, 비슷한 말)이다. 따로 만들지 않는다.
//  - 글은 바꾸지 않는다(CSS Custom Highlight로 칠만). 칠을 못 하는 브라우저는 자리 맞추기만 한다.
//  - 화면을 옮기면(kptu:view-changed) 지운다. 저장하는 것 없음.
import {compileFind, markRanges} from './find-match-model.mjs';

const NAME = 'kptu-found';
const canHighlight = () => typeof window.Highlight === 'function' && !!window.CSS?.highlights;

// host 안 글자에서 words(검색 낱말들)·also(비슷한 말)로 맞은 곳을 칠한다. 맞은 곳 수를 돌려준다.
export function markFound(host, words, {also = []} = {}) {
  clearFound();
  const text = (Array.isArray(words) ? words : [words]).map(w => String(w ?? '').trim()).filter(Boolean).join(' ');
  if (!host || !text) return 0;
  const find = compileFind(text, {also});
  if (find.empty) return 0;
  const ranges = [];
  const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    for (const [a, b] of markRanges(node.data, find)) {
      const range = new Range();
      range.setStart(node, a); range.setEnd(node, Math.min(b, node.data.length));
      ranges.push(range);
    }
  }
  if (canHighlight() && ranges.length) window.CSS.highlights.set(NAME, new window.Highlight(...ranges));
  return ranges.length;
}
export function clearFound() { if (canHighlight()) window.CSS.highlights.delete(NAME); }
// 지금 칠해 둔 조각 글자(시험·접근성 확인용).
export const foundTexts = () => canHighlight() ? [...(window.CSS.highlights.get(NAME) || [])].map(r => r.toString()) : [];

// 결과를 눌러 연 뒤(조직 기록 밖의 종류): 맨 위에 열린 창(상세·편집 창)이 있으면 그 안, 없으면 그 화면(#<view>View) 안에서 찾은 낱말을 칠하고
// 첫 곳이 보이게 맞춘다. 원문이 늦게 그려지는 화면을 위해 잠깐(기본 2.5초) 다시 본다. 칠한 곳 수를 돌려준다.
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const wait = ms => new Promise(r => setTimeout(r, ms));
function topLayer() {
  const open = [...document.querySelectorAll('.modal:not(.hidden), dialog[open], [role="dialog"][aria-modal="true"]')]
    .filter(n => n.checkVisibility?.() ?? n.offsetParent !== null);
  return open.at(-1) || null;
}
export async function revealFound(words, {also = [], view = '', timeoutMs = 2500} = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await frame();
    const root = topLayer() || (view ? document.getElementById(`${view}View`) : null);
    if (root && markFound(root, words, {also})) {
      const first = canHighlight() ? [...(window.CSS.highlights.get(NAME) || [])][0] : null;
      first?.startContainer?.parentElement?.scrollIntoView?.({block: 'nearest'});
      return true;
    }
    await wait(150);
  }
  return false;
}

window.addEventListener('kptu:view-changed', clearFound);
