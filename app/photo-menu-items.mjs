// PHOTO-메뉴항목통일 · UI-업데이트로보내기 (요청함 11/03 17:04·17:06, S49-9): 사진을 부르는 메뉴의 항목 이름·순서를 이 한 곳에서 읽는다.
// 같은 일을 메뉴마다 다르게 부르던 것('정리함에 넣기'·'업데이트로'·'업데이트')을 '업데이트로 보내기' 하나로, '일기로'를 '일기에 넣기' 하나로 맞췄다.
// 하는 일·저장 길은 그대로다: 업데이트로 보내기 = 정리함 업데이트 만들기(basket-upload.js), 일기에 넣기 = 찍은 날 일기(diary-send.js).
// DOM 없이 읽히는 순수 모듈(시험이 그대로 읽는다). 화면 그리기는 share-menu.js·photos.js·photo-strip.js가 한다.

export const PHOTO_ACT_TEXT = Object.freeze({
  select: '선택',
  star: '별표',
  share: '공유',
  copy: '사진 복사',
  diary: '일기에 넣기',
  basket: '업데이트로 보내기',
  download: '다운로드',
  native: '다른 앱으로 공유…',
});

// 아이콘 줄(여러 장 고르기 줄)처럼 칸이 좁은 곳에서 보이는 앞부분(같은 이름의 앞). 읽어 주는 이름·마우스 올림 이름은 PHOTO_ACT_TEXT 온이름.
export const PHOTO_ACT_SHORT = Object.freeze({diary: '일기', basket: '업데이트'});

// 보내기 두 줄은 어느 메뉴에서든 이 순서(일기에 넣기 → 업데이트로 보내기).
export const SEND_ROWS = Object.freeze(['diary', 'basket']);

export const SEND_NOTE = Object.freeze({
  basketBusy: '업데이트로 보내는 중…',
  basketDone: '업데이트로 보냈어요',
  basketFail: '업데이트로 보내지 못했어요.',
  diaryBusy: '일기에 넣는 중…',
  diaryDone: '일기에 넣었어요',
  diaryOpen: '일기 보기',
  retry: '다시',
});

// '11.3' 꼴 짧은 날짜(알림 한 줄용). YYYY-MM-DD가 아니면 그대로.
export const shortDay = day => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[1])}.${Number(m[2])}` : String(day || ''); };
// 일기에 넣은 뒤 알림 한 줄: 한 날이면 '11.3 일기에 넣었어요', 여러 날이면 '11.3 · 11.4 일기에 넣었어요'.
export const diaryDoneText = days => `${(days || []).map(shortDay).join(' · ')} 일기에 넣었어요`.trim();
// 업데이트로 보낸 뒤 알림 한 줄(받지 못한 장이 있으면 함께).
export const basketDoneText = (sent, total = sent) => (sent < total ? `${SEND_NOTE.basketDone}(${sent}장, ${total - sent}장은 받지 못함)` : sent > 1 ? `${SEND_NOTE.basketDone}(${sent}장)` : SEND_NOTE.basketDone);

// 고른 뒤 동작이 끝나면 고르기를 풀지(true) 그대로 둘지(false). 규칙(docs/design-decisions.md PHOTO-보낸뒤선택풀기):
// 보내기·옮기기·넣기는 성공하면 풀고, 실패하면 고른 것을 그대로 둔다. 별표·받기처럼 그 자리에서 표시만 바뀌거나 기기로 받는 일은 고른 채 둔다.
export const RELEASE_AFTER = Object.freeze({diary: true, basket: true, move: true, album: true, delete: true, star: false, download: false, share: false});
export const releaseAfter = (act, ok) => !!ok && RELEASE_AFTER[act] === true;

// 사진 메뉴별 항목 표(전수, PR 본문 표와 같다). 메뉴 그리는 쪽이 이 순서로 고른다(조건에 맞지 않는 줄은 빠짐).
//  - viewerShare: 크게 보기 [공유] 넓은 화면 작은 메뉴(share-menu.js). 좁은 화면(폰)은 바로 기기 공유 창.
//  - context: 사진 우클릭(PC)·⋯ 메뉴(photos.js photoMenu)의 보내기 묶음.
//  - selectBar: 여러 장 고르기 아래 줄(photos.js). 폰은 꾹 눌러 고르면 이 줄이 뜬다.
export const PHOTO_MENUS = Object.freeze({
  viewerShare: Object.freeze(['copy', ...SEND_ROWS, 'download', 'native']),
  context: Object.freeze(['star', 'share', ...SEND_ROWS]),
  selectBar: Object.freeze(['star', 'share', 'download', ...SEND_ROWS]),
});
