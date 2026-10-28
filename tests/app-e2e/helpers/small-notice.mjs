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
