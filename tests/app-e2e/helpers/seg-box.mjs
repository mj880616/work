// UI-보기탭한모양(S52-17): 공용 ⑤ 보기 바꾸기(.ds-seg)는 누르는 범위 44px를 지키려고 바탕 위아래에 투명 여백을 두고,
// 연한 알약 바탕은 그 안쪽(content-box)에만 칠한다. 눈에 보이는 알약의 자리·크기는 이 함수로 잰다(boundingBox 모양 + top·bottom·left·right).
export const segBox = locator => locator.evaluate(el => {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el), t = parseFloat(s.paddingTop) || 0, b = parseFloat(s.paddingBottom) || 0;
  const y = r.top + t, height = r.height - t - b;
  return {x: r.left, y, width: r.width, height, top: y, bottom: y + height, left: r.left, right: r.right};
});
