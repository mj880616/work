// S71-69 SHARE-글공유 ①: 기사 [공유] 하나의 입구(읽을 거리 글 보기·줄 메뉴·밀기, 저장한 글 글 보기·줄 메뉴·밀기가 모두 이것을 부른다).
// 계산은 link-share-model.mjs. 폰(좁은 화면)은 기기 공유 창(navigator.share)으로 '제목 + 원래 주소', PC·넓은 화면·공유 창이 없는 곳은 복사 + '복사했어요'.
// 넓은 화면 기준은 사진 [공유]와 같은 link-share-model.mjs WIDE_SHARE_QUERY(761px~). 사용자가 누를 때만 부른다(다른 일과 자동으로 잇지 않음).
import {articleShare, shareWay, nativeData, wideShare, SHARE_NOTE} from './link-share-model.mjs';
import {copyText} from './copy-text.js';
import {notify} from './small-notice.js';

// 돌려주는 값: 'shared' · 'cancel'(공유 창을 닫음) · 'copied' · 'failed' · 'none'(주소 없음).
export async function shareArticleLink(article, {nav = globalThis.navigator, wide = wideShare(), copy = copyText, say = (text, opts) => notify(text, {record: false, ...opts})} = {}) {
  const d = articleShare(article || {});
  if (!d) { say(SHARE_NOTE.noUrl, {error: true}); return 'none'; }
  if (shareWay({wide, canNative: typeof nav?.share === 'function'}) === 'native') {
    try { await nav.share(nativeData(d)); return 'shared'; }
    catch (e) {
      if (e?.name === 'AbortError') return 'cancel';
      // 공유 창이 막혔으면(누른 효력이 끝남 등) 복사로 이어 준다.
    }
  }
  const ok = await copy(d.text).catch(() => false);
  say(ok ? SHARE_NOTE.copied : SHARE_NOTE.copyFail, {error: !ok});
  return ok ? 'copied' : 'failed';
}
