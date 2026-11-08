// PHOTO-메뉴항목통일 · UI-업데이트로보내기 (요청함 11/03 17:04·17:06, S49-9): 사진을 부르는 메뉴의 항목 이름·순서를 이 한 곳에서 읽는다.
// 같은 일을 메뉴마다 다르게 부르던 것('정리함에 넣기'·'업데이트로'·'업데이트')을 '업데이트로 보내기' 하나로, '일기로'를 '일기에 넣기' 하나로 맞췄다.
// 하는 일·저장 길은 그대로다: 업데이트로 보내기 = 정리함 업데이트 만들기(basket-upload.js), 일기에 넣기 = 찍은 날 일기(diary-send.js).
// DOM 없이 읽히는 순수 모듈(시험이 그대로 읽는다). 화면 그리기는 share-menu.js·photos.js·photo-strip.js가 한다.

export const PHOTO_ACT_TEXT = Object.freeze({
  select: '선택',
  star: '별표',
  share: '공유',
  more: '더보기',
  copy: '사진 복사',
  diary: '일기에 넣기',
  basket: '업데이트로 보내기',
  download: '받기',
  native: '다른 앱으로 공유…',
  // PHOTO-정보수정버튼(S49-18): 사진 정보(찍은 시각·위치) 고치기 — 아래 줄·우클릭 메뉴·크게 보기 모두 이 이름 하나.
  info: '정보수정',
  // PHOTO-크게보기메뉴통일(S49-23): 고르기 아래 줄과 크게 보기 아래 줄이 같은 버튼 목록(PHOTO_MENUS.selectBar·viewBar)을 이 이름으로 그린다.
  down: '받기',
  move: '옮기기',
  tag: '앨범',
  untag: '앨범에서 빼기',
  restore: '폰으로 되돌리기',
  rename: '이름',
  edit: '편집',
  detail: '정보',
  delete: '지우기',
});

// 아이콘 줄처럼 칸이 좁은 곳에서 보이는 앞부분. PHOTO-아래줄정돈(S49-34)부터 아래 줄에 [일기]·[업데이트] 단추가 없어 비어 있다(메뉴 안에서는 온이름).
export const PHOTO_ACT_SHORT = Object.freeze({});

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
  basketOpen: '잊지 말기 보기',
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
  context: Object.freeze(['star', 'share', ...SEND_ROWS, 'info']),
  // PHOTO-아래줄정돈(S49-34, 명진 결정 11/04 12:06 'A안'): 아래 줄은 다섯 칸까지(PHOTO_BAR_MAX). 칸 목록은 아래 두 줄, 칸 안 펼침 항목은 PHOTO_BAR_MENUS.
  // 고르기 줄(selectBar)과 크게 보기 줄(viewBar)이 같은 원칙, 우클릭·꾹 누르기 메뉴(context)는 지금처럼 모두 펼친 목록.
  selectBar: Object.freeze(['star', 'share', 'move', 'delete', 'more']),
  viewBar: Object.freeze(['star', 'share', 'edit', 'delete', 'more']),
});
export const PHOTO_BAR_MAX = 5;
// 아래 줄 칸 안 펼침 항목(순서 그대로, 조건에 안 맞는 항목은 빠짐 — 보이는 조건은 photos.js actAvail 한 곳).
// 'detail' = 크게 보기 정보 판 펼치기, 'edit' = 사진 편집(폰 앱), 'copy'·'native'는 공유 메뉴(share-menu.js) 줄, 나머지는 같은 이름 동작(down·diary·basket·move·tag·untag·restore·rename·info).
export const PHOTO_BAR_MENUS = Object.freeze({
  viewBar: Object.freeze({
    share: Object.freeze(['copy', ...SEND_ROWS, 'down', 'native']),
    edit: Object.freeze(['edit', 'info']),
    more: Object.freeze(['detail', 'move', 'tag', 'untag', 'restore', 'rename']),
  }),
  selectBar: Object.freeze({
    share: Object.freeze([...SEND_ROWS, 'down', 'native']),
    more: Object.freeze(['tag', 'untag', 'restore', 'rename', 'info']),
  }),
});
// 아래 줄 칸 안 펼침 항목의 글자(아이콘 없이 글자만). 칸 이름과 달리 '무엇을 하는지' 풀어 쓴 이름. 없으면 PHOTO_ACT_TEXT 이름.
export const PHOTO_BAR_TEXT = Object.freeze({edit: '사진 편집', move: '폴더로 옮기기', tag: '앨범에 넣기', untag: '앨범에서 빼기', detail: '정보'});
export const barItemText = id => PHOTO_BAR_TEXT[id] || PHOTO_ACT_TEXT[id] || id;

// S53-10 FILES-이폰지우기 덧붙임(메뉴 모양 통일): 사진 [폴더] ⋯(원드라이브·폰·구글 드라이브)의 [지우기]는 늘 맨 아래 같은 자리.
// 지금 지울 수 없는 폴더는 빼지 않고 흐리게(aria-disabled) 두고, 누르면 아래 이유·할 일 한 줄(지우지 않음).
export const FOLDER_DELETE_OFF = Object.freeze({
  odTop: '맨 위 폴더는 지울 수 없어요. 안의 폴더를 지워 주세요',
  odLink: '지우려면 원드라이브를 다시 연결해 주세요',
  phoneOld: '폰 폴더를 지우려면 웹2 앱을 새 판으로 올려 주세요',
  phoneTop: 'DCIM·Pictures 같은 맨 위 폴더는 지울 수 없어요. 안의 폴더를 지워 주세요',
  gdLink: '지우려면 구글 드라이브를 다시 연결해 주세요(위 구글 드라이브 아이콘)'
});
// 원드라이브 폴더: top = 사진 맨 위 폴더, can = 원드라이브에 쓸 수 있음. 폰 폴더: ops = 앱이 폴더 일을 앎, trashable = 지울 수 있는 경로(만들기 전 폴더 포함).
export function folderDeleteOff(kind, {top = false, can = true, ops = true, trashable = true} = {}) {
  if (kind === 'od') return top ? 'odTop' : can ? '' : 'odLink';
  if (kind === 'phone') return !ops ? 'phoneOld' : trashable ? '' : 'phoneTop';
  if (kind === 'gd') return can ? '' : 'gdLink';
  return '';
}
