// S62-22 APP-공유로뉴스보관: 폰 공유 창 'WORK ON+ 저장'(S68-35, 옛 'News 보관')으로 받은 기사 주소 하나를 서버(news-feed ?action=save_url)에 보내 저장한 글에 넣는다.
// 보내는 것은 주소 하나(+ 공유 창 제목 한 줄)뿐 — 서버가 로그인·작업공간을 정하고 공개 본문만 읽어 넣는다(같은 기사는 한 줄, 바로 보관). 창 없이 위쪽 작은 알림 한 줄:
// '저장한 글에 넣었어요 [열기]'(본문을 못 뽑았으면 '본문을 못 가져왔어요(원문 링크로 보기)'), 실패면 '저장한 글에 넣지 못했어요 [다시]'.
// [열기] = News [보관] 탭 + 그 기사 상세(news-request.mjs, 노트 '보관한 글'과 같은 길). 발송·공유·삭제로 이어지는 흐름은 없다. 기기 저장 없음.
import {notify} from './small-notice.js';
import {requestNewsOpen} from './news-request.mjs';
import {openOnScreen} from './source-open.js';
import {NEWS_NOTE, saveFailNote} from './share-news-words.mjs';

export const SAVED_MS = 6000, FAILED_MS = 20000, WORKING_MS = 120000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// title: 공유 창이 넘긴 기사 제목(S67-10, share-intake-model.mjs shareArticleTitle). 원문을 못 읽었을 때만 서버가 제목으로 쓴다. 비면 보내지 않는다.
export async function saveSharedNews(url, {title = '', isCurrent = () => true} = {}) {
  const working = notify(NEWS_NOTE.busy, {ms: WORKING_MS, record: false});
  let out = null, status = 0, failed = false;
  try { out = await window.KPTURuntime.api('/functions/v1/news-feed?action=save_url', {method: 'POST', body: title ? {url, title} : {url}, singleFlight: false, timeoutMs: 90000}); }
  catch (e) { failed = true; status = e?.status || 0; }
  working.close();
  if (!isCurrent()) return null;
  if (failed || !out?.ok || !UUID.test(String(out.id || ''))) {
    const note = saveFailNote(status);
    notify(NEWS_NOTE.fail, {error: true, ms: FAILED_MS, note, actions: note ? [] : [{label: NEWS_NOTE.retry, run: ({close}) => { close(); void saveSharedNews(url, {title, isCurrent}); }}]});
    return null;
  }
  window.KPTUOutside?.refresh?.();
  const id = out.id;
  notify(NEWS_NOTE.done, {ms: SAVED_MS, note: out.status === 'no_body' ? NEWS_NOTE.noBody : '',
    actions: [{label: NEWS_NOTE.open, run: ({close}) => { close(); if (requestNewsOpen({type: 'news', id})) void openOnScreen('outside'); }}]});
  return id;
}
