// UI-점검1030손질 C2: 옆으로 미는 칩 줄의 가림 끝 처리(공용 부품 하나).
// 칩 줄(공용 filter-chips·category-chips)이 칸보다 길면 가려진 쪽 끝을 흐리게 그려, 칩 글자가 칸 끝에서 뚝 잘려 보이지 않게 한다.
// 이 모듈은 줄의 data-scroll-more 속성('start'·'end')만 바꾼다. 모양(흐림)은 ui-standard.css "UI-점검1030손질" 한 규칙이 그린다.
// 줄을 다시 그릴 때마다 부른 쪽(renderFilterChips·renderCategoryChips)이 다시 부르고, 크기가 바뀌거나 밀면 저절로 다시 잰다. 기기에 저장하지 않는다.
let resize = null;
const bound = new WeakSet();

export function paintScrollEdges(el) {
  if (!el || !el.isConnected) return;
  const max = el.scrollWidth - el.clientWidth, more = [];
  if (max > 1) {
    if (el.scrollLeft > 1) more.push('start');
    if (el.scrollLeft < max - 1) more.push('end');
  }
  const value = more.join(' ');
  if (value) { if (el.dataset.scrollMore !== value) el.dataset.scrollMore = value; }
  else if (el.dataset.scrollMore !== undefined) delete el.dataset.scrollMore;
}

export function watchScrollEdges(el) {
  if (!el) return;
  if (!bound.has(el)) {
    bound.add(el);
    el.addEventListener('scroll', () => paintScrollEdges(el), {passive: true});
    if (typeof ResizeObserver === 'function') {
      resize ||= new ResizeObserver(entries => entries.forEach(entry => paintScrollEdges(entry.target)));
      resize.observe(el);
    }
  }
  paintScrollEdges(el);
  // 처음 그려질 때는 아직 칸 폭이 없을 수 있어 다음 그림 차례에 한 번 더 잰다.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => paintScrollEdges(el));
}
