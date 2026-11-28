// S62-22 APP-공유로뉴스보관: 폰 공유 'WORK ON+ 저장' 알림 글자(S68-35: 들어가는 곳은 '저장한 글'). basket-share.js·share-news.js가 함께 쓴다.
export const NEWS_NOTE = Object.freeze({
  busy: '저장한 글에 넣는 중…', done: '저장한 글에 넣었어요', open: '열기', noBody: '본문을 못 가져왔어요(원문 링크로 보기)',
  noUrl: '기사 주소가 없어요', toNote: '노트로 넣기', fail: '저장한 글에 넣지 못했어요', retry: '다시',
  refused: '이 주소는 넣을 수 없어요.', limit: '오늘은 더 넣을 수 없어요. 내일 다시 해 주세요.', unavailable: '이 기사는 넣을 수 없어요.',
});
// 서버(news-feed ?action=save_url) 거절 상태 → 알림 아래 한 줄. 다시 해도 같은 거절이면 [다시]를 두지 않는다('' = 다시 해 볼 만한 실패).
export const saveFailNote = status => status === 400 ? NEWS_NOTE.refused : status === 429 ? NEWS_NOTE.limit : status === 409 ? NEWS_NOTE.unavailable : '';
