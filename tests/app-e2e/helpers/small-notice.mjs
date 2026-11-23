// UI-알림창정리: 브라우저 기본 알림창 대신 쓰는 공용 작은 확인창(.kptu-ask)·작은 알림(.kptu-notice, app/small-notice.js)을 시험에서 다루는 도우미.
// answerAsk: 확인창이 뜨기를 기다려 글을 읽고 [확인 쪽](accept) 또는 [취소]를 누른 뒤, 창이 닫힐 때까지 기다린다. 확인창 글을 돌려준다.
export async function answerAsk(page, accept) {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({state: 'visible'});
  const text = (await ask.locator('.kptu-ask-text').textContent()) || '';
  await ask.locator('.kptu-ask-actions button').nth(accept ? 1 : 0).click();
  await ask.waitFor({state: 'detached'});
  return text;
}
// noticeText: 지금 보이는 작은 알림 한 줄(없으면 기다린다).
export async function noticeText(page) {
  const box = page.locator('#kptuNotice:not([hidden]) .kptu-notice-text');
  await box.waitFor({state: 'visible'});
  return (await box.textContent()) || '';
}
// S69-13 UI-확인창누른자리: 지금 뜬 확인창(.kptu-ask)과 기준 칸(누른 단추) 두 사각형 사이 거리(px, 겹치면 0).
// 하단바(.mobile-tabs)가 보이면 확인창 아래 끝이 그 위인지도 함께 돌려준다.
export async function askGap(page, anchor) {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({state: 'visible'});
  const a = await ask.boundingBox(), b = await anchor.boundingBox();
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  const barTop = await page.evaluate(() => { const bar = document.querySelector('.mobile-tabs'); return bar && bar.getClientRects().length && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight; });
  return {gap: Math.round(Math.hypot(dx, dy)), aboveBar: a.y + a.height <= barTop + 0.5, ask: a, anchor: b};
}
