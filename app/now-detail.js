import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {sendSignal, setMark} from './now-marks.js';
import {deleteMine, dropSaved, DELETE_LABEL, DELETE_BOTH_LABEL, SAVE_LABEL, SAVED_LABEL, SAVED_ARIA} from './now-row-acts.js';
import {readMarkOf, readMemoNote, readBody, readArticleCols, readSentences, readSavedDetail} from './feed-shared.js';
import {createMemoThread} from './memo-thread.js';
import {memosOf} from './memo-model.mjs';
import {memosNow, onMemos} from './memo-store.js';
import {requestNoteDocOpen} from './basket-note-tasks.js';
import {plainText} from './news-clipping-model.mjs';
import {textSizeHtml, textSize} from './text-size.js';
import {textScale} from './text-size-model.mjs';
import {createAnchoredMenu, keepMenus} from './anchored-menu.js';
import {copyText} from './copy-text.js';
import {articleShare, SHARE_LABEL} from './link-share-model.mjs';
import {shareArticleLink} from './link-share.js';
import {iconHtml} from './tree-icons.js';
import {notify, askText} from './small-notice.js';
import {flashDone} from './press-feedback.js';
import {bindSelectZone} from './text-select-bar.js';
import {paintMarks, bindMarks, sourceHighlights, loadHighlights, onHighlights, saveFromSelection, noteFromSelection, revealMark} from './text-highlights.js';
import {detailBody, detailView, detailError, itemKey, RELATED_LABEL, interestHit, needsRead, titlePending, hasMaterial, unreadReason, bodyView, legacyBody, reopenBody, canTranslate, translatedBlocks, translateError, TRANSLATE_FUNCTION, blocksBody, copyArticleText, canHandFill, handInitial, handRequest, handError, HAND_LIMITS, handPhotoKind, handPhotoLine, insertPhotoLine, insertPhotoLines, ownPhotoOf, photoToken, tokensIn, photoFileError, HAND_PHOTOS_MAX, handPhotoCount, bodyFirstUrl, movedUrlValues, textWithUrls, handNoText, handShort, noMaterialLine, SHORT_SUMMARY_TEXT, canRefetch, canRefetchMenu, unreadLead, isNoMaterial, handBodyRequest, HAND_BODY_MAX, sameDetail, savedUsable} from './now-model.mjs';
import {clipboardFiles} from './paste-files.mjs';
// 글 상세 공용 부품(사회운동 글·뉴스 기사 두 쪽이 이 부품 하나를 쓴다). 상세 칸(box)의 유일한 그리기 주인이다.
// S51-14 NEWS-전면개편 P4c(설계 docs/design/news-overhaul.md 맨 앞 D2′ 메모·6.2절, 시안 docs/design/mockups/news-overhaul.html ②·③):
// - 위에서 아래(S52-12 NEWS-원문먼저번역, 시안 docs/design/mockups/news-detail-translate.html): 꼬리 줄(매체·분류·날짜·글쓴이) → 제목 → [원문 전체]
//   (머리 줄 [번역] — 외국어 뉴스 기사만 · 글자 크기 [−][+] 다섯 단계 — 공용 text-size.js, 서버 view_prefs.news_font, 읽을 거리 글 보기와 같은 값) → [요약] → [시사점](주요 문장·나와의 연관은 이 칸 안 접기)
//   → '함께 볼 것'(접기) → [☆ 별표][보관][메모][관심 없음] … [원래 사이트 ↗].
// - [번역]: 누르면 news-feed translate(뉴스 기사) 또는 outside-feed translate(사회운동 영어 소식, S52-36)(로그인·owner·하루 한도·저장은 서버,
//   한 번 번역한 글은 저장본을 바로) 뒤 그 글 줄의 body_ko(뉴스는 body도)를 읽어
//   글자 블록만 한국어로 바꿔 그린다(문단·소제목·인용·사진·캡션 자리는 그대로, now-model.mjs translatedBlocks). 다시 누르면 원문. 번역 중엔 원문 칸에 기다림 표시.
// - 누르면 원문 전체가 바로: 저장 원문(app_feed_bodies 블록 — 문단·소제목·인용·사진·캡션)을 사용자 로그인으로 읽는다(작업공간 소유자 RLS).
//   동시에 요약·시사점 만들기를 시작한다(ai-assist kind now_detail — 서버가 저장 원문을 재료로 먼저 씀). 기다림 표시는 요약·시사점 칸에만,
//   다 되면 그 칸만 채운다(원문 칸은 다시 그리지 않음). 이미 만든 것(app_now_details)은 서버가 바로 돌려준다. 화면은 글 id만 보낸다.
// - 원문이 없는 글(state failed·lead·image_only): 있는 만큼 + 까닭 한 줄 + [원래 사이트 ↗]. 뉴스 기사 중 저장 원문 줄이 아예 없는 옛 글과
//   잠깐의 오류로 못 읽은 줄(state failed + 늦은 답·사이트 오류·예전 robots, now-model.mjs reopenBody)만 '기사 먼저 읽기'(news-feed open, 하루 한도는 서버,
//   원문 칸에 '원문을 읽어 오는 중' 한 줄 — S68-25)
//   뒤 다시 읽고(S51-17 P5, 설계 7.1), 그래도 없으면 예전 저장 글자(사회운동 문장·뉴스 body)를 문단으로. 막힌 사이트·없는 글은 다시 읽지 않는다.
// - 사진: https 주소만, referrerpolicy="no-referrer"·loading="lazy", 글을 열었을 때만 그린다. 안 뜨면 '사진 ↗' 링크.
// - 아래 작은 단추 줄: 사회운동 글은 app_outside_marks(글마다 한 줄), 뉴스는 기존 app_news_items 칸(starred_at·hidden_at). 메모는 노트
//   (app_notes, metadata.outside_post_id|news_item_id). 누를 때마다 환류 기록 한 줄(지금은 app_news_now_signals·app_outside_now_signals). [원래 사이트 ↗] 열기도 기록한다.
// - NEWS-모두에게열기 ③: 위 표들은 공용 글(app_news_articles·app_outside_articles·…_article_bodies·문장) + 내 표시·읽음·반응 표로 바뀌었다(feed-shared.js 한 길).
// - 원문 칸 머리 줄 [복사] ⋯(S52-39 NEWS-원문복사선택, 시안 docs/design/mockups/news-copy-select.html): [복사](공용 칩)는 제목 / 매체·날짜 / 본문 전체(문단 그대로) /
//   원래 주소를 한 번에 클립보드로(번역해서 보는 중이면 한국어 본문, now-model.mjs copyArticleText). ⋯ 작은 메뉴(UI-⋯작은메뉴) = [모두 선택](원문 본문 전체를
//   선택된 상태로 → 폰 기본 메뉴 복사·공유·검색)·[복사]·[공유](폰 공유 창 navigator.share — 제목·주소만, 그 길이 없는 화면에는 [공유]를 두지 않는다).
//   PC 우클릭은 공용 context-menu.js가 이 ⋯를 누른다(글자를 고른 채면 브라우저 기본 메뉴). 복사·선택은 이 화면 안에서만(서버 저장·전송 없음).
// - 원문에서 글을 고르면(끌기·⋯ [모두 선택]) 하단바 위 공용 줄 [밑줄 저장][노트로][복사][공유] ✕(S53-5 NEWS-밑줄모으기, text-select-bar.js).
//   [모두 선택] 뒤에는 폰 기본 메뉴가 뜨지 않아 이 줄이 복사·공유를 맡는다. 저장한 밑줄은 원문 칸을 그린 뒤 노란 바탕으로 칠한다(text-highlights.js paintMarks,
//   번역해서 보는 중에는 칠하지 않음). 밑줄을 누르면 작은 메뉴(메모·노트로·복사·지우기). [밑줄] 탭에서 열면 그 자리로(open의 highlight).
// - 직접 넣기(S67-02 NEWS-직접넣기): 원문을 못 읽은 뉴스 기사는 원문 칸 까닭 줄 끝에 [직접 넣기], 읽은 기사는 원문 ⋯ [수정] — 같은 자리 같은 입력 칸
//   (제목·매체·기자·기사 시각(달력+시각, 비우면 넣은 시각)·본문). 저장은 서버 news-feed hand_fill(운영자 기능 키 작업공간만, 서버가 길이·모양 검사)뿐.
//   저장 뒤 기사 줄을 다시 읽어 줄 주인(onRead)이 목록·머리를 고치고, 원문·요약은 새 본문으로 다시 읽는다(요약 저장본은 서버가 지움). 넣은 값은 글자로만 그린다.
// - [원문 다시 가져오기](S68-43): 원문 칸이 다시 읽을 실패(reopenBody — 늦은 답·사이트 오류·예전 robots)면 까닭 줄 끝에 작은 단추. 누른 사람 요청으로
//   기존 서버 길(뉴스 news-feed open · 사회운동 outside-feed reread — 로그인·기능 키·하루 한도는 서버)을 한 번 부르고 원문 줄을 다시 읽는다.
//   본문이 생기면 요약·시사점을 다시 만든다(서버가 본문보다 오래된 저장본을 버림). 재료가 없는 글은 요약을 만들지 않고 요약 칸에 '원문을 가져오면 요약해요 · 까닭' 한 줄만.
// - S68-49(명진 11/23 12:43 "업데이트 됐는데도 여전히 못 읽음"): 봇 확인(bot_check)도 단추(canRefetch — 열 때 저절로 다시 읽지는 않음), 두 갈래 모두.
//   서버가 실제로 다시 읽고도 못 읽었으면(또는 방금 다시 읽어 'recent') 이 탭에서 그 글 단추를 거두고(같은 글 잦은 재시도 막기),
//   '원래 사이트에서 열기 ↗' + 사람이 채울 길([직접 넣기] — 사회운동 글은 본문 칸만인 [본문 붙여 넣기], 서버 outside-feed hand_body)만 남긴다.
//   요약 422 no_material 판단은 isNoMaterial 하나(서버 error 칸 — 예전 오류 글 비교는 운영 답에서 늘 빗나가 빨간 'HTTP 422'가 보였다).
// - 저장은 모두 서버. 기기 저장 없음. 상세·원문은 이 탭 메모리에만 다시 쓰려고 둔다. 바깥 글자는 모두 esc로 그린다. 로그에 제목·본문을 남기지 않는다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const rt = () => window.KPTURuntime;
const MEMO_COLS = 'id,title,raw_text,metadata,updated_at,doc_type:doc->>type';
const NEWS_ROW_COLS = 'state,body_kind,summary,title,title_ko,publisher,published_at,url,lang,author,manual_at,origin';
const HAND_ROW_COLS = 'title,publisher,author,published_at,url,state';
// 직접 넣기 입력 칸 상태. pics: '[사진 n]' 번호 → {file(올리기 전 사진, 메모리만), view(미리보기 주소), src(저장된 사진 주소)}.
const idleHand = () => ({open: false, busy: false, note: '', init: null, shown: null, pics: new Map(), next: 1, up: ''});
function dropPics(h) { for (const p of h?.pics?.values?.() || []) if (p.file && p.view) URL.revokeObjectURL(p.view); }
const LOAD_FAILED = Symbol('load-failed');
const DETAIL_TIMEOUT_MS = 75000;
const saveFailNote = e => (e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시');

// head: {meta: [글자…], title, origTitle, titleLang, lang, url}. item: {type:'outside'|'news', id}.
export function createNowDetail({box, topics = () => [], onClose, onChanged, onSignal, onRelated, onRead} = {}) {
  let cur = null; // {item, head, body, detail, failed, unread, making, reading, note, marks, memo(옛 노트 메모), busy, tr:{on, busy, note}, hand:{open, busy, note, init, shown}}
  const details = new Map(); // itemKey → 서버 답(이 탭 메모리만)
  const asking = new Map(); // itemKey → 진행 중인 요약 요청(같은 글 요청이 겹쳐 나가지 않게 — S69-01)
  const bodies = new Map(); // itemKey → bodyView 모양(이 탭 메모리만)
  const translations = new Map(); // itemKey → translatedBlocks 답(이 탭 메모리만 — 원본 저장은 서버 body_ko)
  let seq = 0;

  // ---------- 서버 ----------
  // S69-01: 화면 쪽 시간 한도 75초(서버 AI 한 요청 30초·잠깐 막힘 한 번 다시 시도 안쪽). 넘으면 기다림을 멈추고 [다시 만들기].
  const askDetail = item => rt().api('/functions/v1/ai-assist', {method: 'POST', body: detailBody(item), singleFlight: false, timeoutMs: DETAIL_TIMEOUT_MS});
  // NEWS-모두에게열기 ③: 글 내용·본문 블록·문장·번역은 공용 표, 별표·보관·숨김·메모는 내 것(feed-shared.js 한 길). item.id = 공용 글 id.
  const readMarks = item => readMarkOf(item);
  const readMemo = item => readMemoNote(item, MEMO_COLS);
  // 저장 원문 한 줄(없으면 null).
  const readFeedBody = item => readBody(item);
  // 옛 글: 예전 저장 글자.
  async function readLegacyText(item) {
    if (item.type === 'news') {
      const r = await readArticleCols(item, 'body,body_kind');
      return legacyBody(plainText(r?.body).trim(), {lead: r?.body_kind === 'lead'});
    }
    const rows = await readSentences(item.id);
    const text = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.text === 'string').sort((a, b) => a.idx - b.idx).map(r => r.text.trim()).filter(Boolean).join(' ');
    return legacyBody(text);
  }
  const readTranslation = item => readArticleCols(item, item.type === 'news' ? 'body,body_ko' : 'body_ko');
  const readNewsRow = item => readArticleCols(item, NEWS_ROW_COLS);
  const freshened = new Set(); // freshenHead를 이미 부른 기사(화면 메모리)
  const gaveUp = new Set(); // [원문 다시 가져오기]를 서버가 해 보고도 못 읽은 글(이 탭 메모리 — 같은 글 잦은 재시도 막기, S68-49)
  const signal = (item, action) => sendSignal(item, action, onSignal);

  // ---------- 그리기(칸마다 따로 — 요약이 와도 원문 칸은 그대로) ----------
  // S70-40b READ-글보기머리: 이름은 저장한 글과 같은 '원래 페이지'(ui-words.md). 글 머리 첫 줄 오른쪽 ↗ 아이콘(공용 .ds-doc-icon)이 기본 자리,
  // 원문을 못 받은 까닭 줄 끝 글자 링크(…원래 사이트 ↗)는 그 줄 안내라 그대로 둔다.
  // S71-69 SHARE-글공유: 머리 줄 ↗ 옆 [공유] 아이콘(공용 share 그림). 주소가 http·https인 글만.
  const shareIconHtml = h => (articleShare(h) ? `<button type="button" class="ds-doc-icon icon-btn nd-share" data-nd-share title="${SHARE_LABEL}" aria-label="${SHARE_LABEL}">${iconHtml('share')}</button>` : '');
  const siteLink = (label = '원래 사이트 ↗', cls = 'nd-link', name = '원래 사이트') => (cur.head.url ? `<a class="${cls}" data-nd-link href="${esc(cur.head.url)}" target="_blank" rel="noopener noreferrer" title="${esc(name)}" aria-label="${esc(name)} (새 창)">${esc(label)}</a>` : '');
  const langAttr = () => (cur.head.lang && cur.head.lang !== 'ko' ? ` lang="${esc(cur.head.lang)}"` : '');
  const boxHead = (title, note = '') => `<p class="nd-bh"><b>${title}</b>${note ? `<span class="nd-bh-note" role="status">${esc(note)}</span>` : ''}</p>`;
  function sumHtml() {
    // S69: 본문이 짧아 요약하지 않은 글은 그 한 줄만(본문은 원문 칸 [원문 다시 가져오기]로 채운다 — 채워지면 그때 요약).
    if (cur.unread === SHORT_SUMMARY_TEXT) return boxHead('요약') + `<p class="nd-why" data-nd-unread data-nd-short-sum role="status">${esc(SHORT_SUMMARY_TEXT)}</p>`;
    if (cur.unread) return boxHead('요약') + `<p class="nd-why" data-nd-unread role="status">원문을 가져오면 요약해요 · ${esc(cur.unread)} <button type="button" class="nd-act" data-nd-retry>다시</button></p>`;
    if (!cur.detail && cur.failed) return boxHead('요약') + failHtml({text: cur.failed, retry: 'data-nd-retry', label: '다시 만들기'});
    if (!cur.detail) return boxHead('요약', cur.reading ? '기사 가져오는 중' : '만드는 중') + `<div class="nd-wait" data-nd-wait aria-busy="true">${waitHtml({rows: 2})}</div>`;
    const v = detailView(cur.detail);
    return boxHead('요약') + (v.summary ? `<p class="nd-sum">${esc(v.summary)}</p>` : emptyHtml('요약 없음'));
  }
  function impHtml() {
    if (cur.unread || (!cur.detail && cur.failed)) return '';
    if (!cur.detail) return boxHead('시사점', '만드는 중') + `<div class="nd-wait" aria-busy="true">${waitHtml({rows: 2})}</div>`;
    const v = detailView(cur.detail);
    if (v.level === 'basic') return boxHead('시사점') + '<p class="nd-faint">오늘 상세 한도를 넘어 요약까지만 · 내일 열면 채워요</p>' + moreHtml(v);
    const imp = v.implications ? `${v.implications.kptu ? `<p class="nd-imp"><b>공공운수노조 운동</b> ${esc(v.implications.kptu)}</p>` : ''}${v.implications.labor ? `<p class="nd-imp"><b>한국 노동운동</b> ${esc(v.implications.labor)}</p>` : ''}` : emptyHtml('시사점 없음');
    return boxHead('시사점') + imp + moreHtml(v);
  }
  // 시사점 칸 안 접기: 주요 문장·나와의 연관.
  function moreHtml(v) {
    const sents = v.sentences.length ? `<ul class="nd-sents" data-nd-sentences>${v.sentences.map(s => `<li><span class="nd-orig-line"${langAttr()}>${esc(s.orig)}</span>${s.ko ? `<span class="nd-ko">${esc(s.ko)}</span>` : ''}</li>`).join('')}</ul>` : '';
    let rel = '';
    if (v.relevance) rel = `${v.relevance.topics.length ? `<p class="nd-topics">${v.relevance.topics.map(t => `<span class="nd-topic">${esc(t)}</span>`).join('')}</p>` : ''}${v.relevance.reason ? `<p class="nd-reason">${esc(v.relevance.reason)}</p>` : ''}`;
    else if (v.level !== 'basic') rel = `<p class="nd-faint">${topics().length ? '연관 낮음' : '확정한 관심 주제가 없어요 · ⋯ → 관심 주제'}</p>`;
    if (!sents && !rel) return '';
    return `<details class="nd-fold" data-nd-more><summary>주요 문장 · 나와의 연관</summary>${sents ? `<p class="nd-sub">주요 문장</p>${sents}` : ''}${rel ? `<p class="nd-sub">나와의 연관</p><div data-nd-relevance>${rel}</div>` : ''}</details>`;
  }
  function relatedHtml() {
    if (!cur.detail) return '';
    const v = detailView(cur.detail);
    if (!v.related.length) return '';
    return `<details class="nd-fold nd-relfold" data-nd-relatedbox><summary>함께 볼 것 ${v.related.length}</summary><ul class="nd-related">${v.related.map((r, i) => `<li><button type="button" class="nd-rel" data-nd-related="${i}"><span class="nd-rel-kind">${esc(RELATED_LABEL[r.kind])}</span>${esc(r.title)}</button></li>`).join('')}</ul></details>`;
  }
  function blockHtml(b) {
    const own = b.t === 'img' ? ownPhotoOf(b.src) : null;
    if (own) {
      // 내가 올린 사진: 서버(hand_photo)에서 받아 그린다. 받기 전에는 자리만. S68-40: 못 받으면 칸을 감추지 않고 '사진을 불러오지 못함 [다시]'
      // (잠깐의 오류로 사진이 '없어진' 것처럼 보이지 않게 — 사진은 본문에 그대로 있다).
      const cap = b.cap ? `<figcaption>${esc(b.cap)}</figcaption>` : '';
      return `<figure class="nd-fig" data-nd-own-fig><img class="nd-img" data-nd-own="${esc(own.id)}" alt="${esc(b.alt || b.cap || '')}" hidden><p class="nd-faint" data-nd-own-fail role="status" hidden>사진을 불러오지 못함 <button type="button" class="nd-act" data-nd-own-retry>다시</button></p>${cap}</figure>`;
    }
    if (b.t === 'img') {
      const cap = b.cap ? `<figcaption>${esc(b.cap)}</figcaption>` : '';
      return `<figure class="nd-fig"><img class="nd-img" data-nd-img src="${esc(b.src)}" alt="${esc(b.alt || b.cap || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><a class="nd-img-link" data-nd-img-link href="${esc(b.src)}" target="_blank" rel="noopener noreferrer" hidden>사진 ↗</a>${cap}</figure>`;
    }
    if (b.t === 'h') return `<h4 class="nd-bhd">${esc(b.text)}</h4>`;
    if (b.t === 'quote') return `<blockquote>${proseText(b.text)}</blockquote>`;
    return `<p>${proseText(b.text)}</p>`;
  }
  // 문단 글자: 본문 안 http·https 주소는 작은 줄바꿈 링크(S68-39 — 긴 주소가 큰 글자 덩어리로 줄줄이 보이지 않게). 나머지는 글자 그대로(esc).
  function proseText(text) {
    return textWithUrls(text).map(x => (x.url ? `<a class="nd-url" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.text)}</a>` : esc(x.text))).join('');
  }
  // 원문 칸 머리 줄 [번역]: 외국어 뉴스 기사·사회운동 영어 소식에서 글자 블록이 있을 때만. 누른 상태는 aria-pressed.
  function trHtml(b) {
    if (cur.hand.open || !canTranslate(cur.item, cur.head) || !b || b.failedLoad || !b.blocks.some(x => x.t !== 'img')) return '';
    const t = cur.tr;
    return `${t.note ? `<span class="nd-tr-note" data-nd-tr-note role="status">${esc(t.note)}</span>` : ''}<button type="button" class="ds-chip nd-tr" data-nd-translate aria-pressed="${!!t.on}"${t.busy ? ' disabled aria-busy="true"' : ''} aria-label="${t.on ? '원문으로 보기' : '한국어로 번역'}">번역</button>`;
  }
  // [복사]·⋯: 원문을 다 읽었을 때만(기다림·불러오기 실패·번역 중에는 없음).
  const canCopy = b => !!b && !b.failedLoad && !cur.tr.busy && !cur.hand.open;
  const copyHtml = b => (canCopy(b) ? '<button type="button" class="ds-chip nd-copy" data-nd-copy aria-label="원문 복사 — 제목·본문·주소">복사</button>' : '');
  const moreHtmlOb = b => (canCopy(b) ? '<button type="button" class="icon-btn nd-ob-more" data-nd-ob-more aria-haspopup="true" aria-expanded="false" aria-label="원문 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button>' : '');
  // 지금 화면에 보이는 블록(번역해서 보는 중이면 한국어).
  function shownBlocks() {
    const key = itemKey(cur.item), b = bodies.get(key), tv = cur.tr.on ? translations.get(key) : null;
    if (tv) return tv.blocks;
    return b && b.state !== 'failed' ? b.blocks : [];
  }
  function bodyHtml() {
    const key = itemKey(cur.item), b = bodies.get(key);
    const tv = cur.tr.on ? translations.get(key) : null;
    const src = tv ? '한국어 번역' : cur.head.meta?.[0] || '';
    const tr = trHtml(b);
    const head = `<div class="nd-ob"><b>원문 전체</b>${src ? `<span class="nd-ob-src">${esc(src)}</span>` : ''}<span class="nd-ob-r">${copyHtml(b)}${tr}${textSizeHtml()}${moreHtmlOb(b)}</span></div>`;
    let inner;
    if (cur.hand.open) inner = handHtml();
    else if (!b) inner = `<div aria-busy="true">${cur.reading ? '<p class="nd-faint" data-nd-fetching role="status">원문을 읽어 오는 중</p>' : ''}${waitHtml({rows: 4})}</div>`;
    else if (cur.tr.busy) inner = `<div class="nd-wait" data-nd-tr-wait aria-busy="true"><p class="nd-faint" role="status">번역하는 중</p>${waitHtml({rows: 4})}</div>`;
    else if (tv) {
      const why = b.reason ? `<p class="nd-why" data-nd-why role="status">${esc(b.reason)}${cur.head.url ? ` · ${siteLink(b.state === 'lead' ? '나머지는 원래 사이트 ↗' : '원래 사이트 ↗')}` : ''}</p>` : '';
      const note = !tv.aligned ? '<p class="nd-faint" data-nd-tr-loose>문단 나눔이 원문과 달라 사진은 아래에 모았어요</p>' : tv.partial ? '<p class="nd-faint" data-nd-tr-rest>번역은 앞부분까지 · 나머지는 원문 그대로</p>' : '';
      inner = `<div class="nd-prose" lang="ko" data-nd-prose data-nd-translated>${tv.blocks.map(blockHtml).join('')}</div>${note}${why}`;
    }
    else if (b.failedLoad) inner = failHtml({text: '원문을 불러오지 못함', retry: 'data-nd-body-retry'});
    else {
      const hand = canHandFill(cur.item, b) ? ` <button type="button" class="ds-chip nd-hand" data-nd-hand>${cur.item.type === 'outside' ? '본문 붙여 넣기' : '직접 넣기'}</button>` : '';
      // S69-02: 못 읽은 글은 단추가 늘 있다(서버가 다시 읽고도 못 읽었어도 — 그 까닭은 한 줄, 잦은 재시도는 서버 간격·하루 한도가 막는다).
      const note = cur.refetchNote && !cur.refetching ? ` <span class="nd-faint" data-nd-refetch-note>${esc(cur.refetchNote)}</span>` : '';
      const again = (cur.refetching ? ' <span class="nd-faint" data-nd-refetching>원문을 다시 가져오는 중</span>' : b.again ? ' <button type="button" class="ds-chip" data-nd-refetch>원문 다시 가져오기</button>' : '') + note;
      // S68-44: 손으로 넣은 기사인데 본문 글자가 없으면(비움·사진만) 까닭 대신 작은 '본문 없음' 한 줄(주소가 있을 때만 원래 사이트).
      const noText = handNoText(b);
      // S69 READ-첨부본문: 손으로 넣은 본문이 짧으면(마침표 하나·사진만) 한 줄 '본문을 못 가져왔어요 · [원문 다시 가져오기] · 원래 사이트'.
      // 단추는 서버 open again(짧은 손 본문만 원래 주소를 다시 읽어 전문이면 바꿈 — 첨부 PDF·HWP 포함, 손 사진은 앞에 둠).
      const short = !noText && cur.item.type === 'news' && handShort(b);
      const handAgain = cur.item.type === 'news' && cur.head.url && (noText || short)
        ? (cur.refetching ? ' <span class="nd-faint" data-nd-refetching>원문을 다시 가져오는 중</span>' : ' <button type="button" class="ds-chip" data-nd-refetch-hand>원문 다시 가져오기</button>') + note : '';
      const why = noText ? `<div class="nd-why nd-no-text" data-nd-why role="status">${emptyHtml('본문 없음', {attrs: 'data-nd-no-text'})}${handAgain}${cur.head.url ? ` · ${siteLink('원래 사이트 ↗')}` : ''}${hand}</div>`
        : short ? `<p class="nd-why" data-nd-why data-nd-short role="status">본문을 못 가져왔어요${handAgain}${cur.head.url ? ` · ${siteLink('원래 사이트 ↗')}` : ''}</p>`
        : b.reason ? `<p class="nd-why" data-nd-why role="status">${esc(b.reason)}${cur.head.url ? ` · ${siteLink(b.state === 'lead' ? '나머지는 원래 사이트 ↗' : b.state === 'failed' && gaveUp.has(itemKey(cur.item)) ? '원래 사이트에서 열기 ↗' : '원래 사이트 ↗')}` : ''}${again}${hand}</p>` : '';
      const prose = b.blocks.length ? `<div class="nd-prose"${langAttr()} data-nd-prose>${b.blocks.map(blockHtml).join('')}</div>` : '';
      // 다 읽은 글을 ⋯ [원문 다시 가져오기]로 다시 읽는 중·결과 한 줄(까닭 줄이 없는 글만 — 까닭 줄이 있으면 그 줄 끝에 이미 보인다).
      const line = !why && (cur.refetching || note) ? `<p class="nd-faint nd-refetch-line" data-nd-refetch-line role="status">${cur.refetching ? '<span data-nd-refetching>원문을 다시 가져오는 중</span>' : note.trim()}</p>` : '';
      inner = b.state === 'failed' ? why : moveUrlHtml(b) + prose + why + line;
    }
    return head + `<div class="nd-ob-body" data-nd-body-inner>${inner}</div>`;
  }
  // S68-39: 옛 직접 넣기(주소 칸이 없어 본문 첫 줄에 주소를 붙여 넣은 것) — 내가 넣은 손 기사만 작은 한 줄 + [옮기기](같은 hand_fill 저장 길).
  function moveUrlHtml(b) {
    if (cur.item.type !== 'news' || !cur.head?.manual || !cur.head?.mine || !bodyFirstUrl(b.blocks)) return '';
    return `<p class="nd-faint nd-move-url" data-nd-move-url role="status">본문 첫 줄 주소를 원문 주소로 옮길까요? <button type="button" class="ds-chip" data-nd-move-url-go>옮기기</button></p>`;
  }
  // 본문 칸 아래 작은 미리보기 줄: 본문 칸에 '[사진 n]' 줄이 있는 사진만(차례대로). 올리기 전 사진은 이 기기 메모리의 그림, 저장된 사진은 서버 그림.
  function picsHtml(body) {
    const pics = cur.hand.pics;
    if (!pics.size) return '<div class="nd-hand-pics" data-nd-hand-pics hidden></div>';
    const on = new Set(tokensIn(body));
    const one = ([n, p]) => {
      const own = p.src ? ownPhotoOf(p.src) : null;
      const img = p.view ? `<img src="${esc(p.view)}" alt="">` : own ? `<img data-nd-own="${esc(own.id)}" alt="" hidden>` : '';
      return `<figure class="nd-hand-pic" data-nd-hand-pic="${n}"${p.file ? ' data-nd-hand-wait title="저장할 때 올려요"' : ''}${on.has(n) ? '' : ' hidden'}>${img}<figcaption>${esc(photoToken(n))}</figcaption></figure>`;
    };
    return `<div class="nd-hand-pics" data-nd-hand-pics aria-label="넣은 사진"${on.size ? '' : ' hidden'}>${[...pics].map(one).join('')}</div>`;
  }
  // 직접 넣기 입력 칸(원문 칸 안, 같은 자리). 처음 값을 읽는 동안은 기다림.
  function handHtml() {
    const h = cur.hand, v = h.shown || h.init;
    if (!v) return `<div aria-busy="true">${waitHtml({rows: 3})}</div>`;
    const dis = h.busy ? ' disabled' : '';
    // 사회운동 글(S68-49): 본문 칸만(제목·매체·사진은 수집한 그대로). 원래 사이트에서 복사한 글을 붙여 넣는다.
    if (cur.item.type === 'outside') return `<form class="nd-hand-form" data-nd-hand-form aria-label="본문 붙여 넣기"><div class="nd-hand-f nd-hand-body"><div class="nd-hand-bh"><label for="ndHandBody">본문</label>${cur.head.url ? `<span class="nd-hand-tools">${siteLink('원래 사이트에서 열기 ↗')}</span>` : ''}</div><textarea id="ndHandBody" data-nd-hand-in="body" rows="8" maxlength="${HAND_BODY_MAX}" placeholder="원래 사이트에서 본문을 복사해 붙여 넣어요"${dis}>${esc(v.body)}</textarea></div>
<div class="nd-memo-row">${h.note ? `<span class="nd-faint" data-nd-hand-note role="status">${esc(h.note)}</span>` : ''}<button type="button" class="secondary" data-nd-hand-cancel${dis}>취소</button><button type="submit" class="secondary"${h.busy ? ' disabled aria-busy="true"' : ''}>저장</button></div></form>`;
    const field = (key, label, attrs = '') => `<label class="nd-hand-f"><span>${label}</span><input type="text" data-nd-hand-in="${key}" value="${esc(v[key])}" maxlength="${HAND_LIMITS[key]}" autocomplete="off"${attrs}${dis}></label>`;
    return `<form class="nd-hand-form" data-nd-hand-form aria-label="기사 직접 넣기">${field('title', '제목')}${field('url', '원문 주소', ' inputmode="url" placeholder="https://…" spellcheck="false"')}<div class="nd-hand-row">${field('publisher', '매체')}${field('author', '기자')}</div>
<label class="nd-hand-f"><span>기사 시각</span><input type="datetime-local" data-nd-hand-in="at" value="${esc(v.at)}"${dis}></label>
<div class="nd-hand-f nd-hand-body"><div class="nd-hand-bh"><label for="ndHandBody">본문</label><span class="nd-hand-tools"><button type="button" class="ds-chip nd-hand-photo" data-nd-hand-pick title="폰·PC의 사진을 선택해 커서 자리에 넣어요(여러 장). 복사한 사진은 본문 칸에 붙여 넣어도 돼요."${dis}>사진</button><button type="button" class="ds-chip nd-hand-photo" data-nd-hand-photo title="사진 주소를 붙여 넣으면 커서 자리에 한 줄로 들어가요. 주소 바로 다음 줄을 '사진:'으로 시작하면 사진 설명이 돼요."${dis}>사진 주소 넣기</button></span><input type="file" data-nd-hand-file accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></div><textarea id="ndHandBody" data-nd-hand-in="body" rows="8" maxlength="${HAND_LIMITS.body}"${dis}>${esc(v.body)}</textarea>${picsHtml(v.body)}</div>
<div class="nd-memo-row">${h.up ? `<span class="nd-faint" data-nd-hand-up role="status">${esc(h.up)}</span>` : h.note ? `<span class="nd-faint" data-nd-hand-note role="status">${esc(h.note)}</span>` : ''}<button type="button" class="secondary" data-nd-hand-cancel${dis}>취소</button><button type="submit" class="secondary"${h.busy ? ' disabled aria-busy="true"' : ''}>저장</button></div></form>`;
  }
  // S69-03(명진 11/24 06:43·06:48): 아래 줄 단추는 모두 공용 ④ 칩(button.ds-chip) 한 모양 — 눌림은 공용 칩의 aria-pressed 색.
  // 저장 단추는 저장한 글이면 '저장됨 ✓'(눌림), 누르면 저장한 글에서 삭제(5초 [되돌리기], dropSaved). [관심 없음]은 읽을 거리 추천 흐름의 환류라
  // 저장한 글에서 연 글(open의 from 'saved')에는 그리지 않는다.
  function actsHtml() {
    const m = cur.marks || {};
    const busy = cur.busy ? ' disabled' : '';
    const one = (attrs, label) => `<button type="button" class="ds-chip" ${attrs}${busy}>${esc(label)}</button>`;
    const btn = (act, on, label, onLabel) => one(`data-nd-act="${act}" aria-pressed="${!!on}"`, on ? onLabel : label);
    // S69-94 NOTE-메모통일: 메모는 글 아래 메모 칸(memo-thread.js, 노트와 같은 부품). 이 칩은 그 칸으로 내려가 쓰기 칸에 초점(메모 수).
    const n = memosOf(memosNow(), cur.item.type, cur.item.id).length;
    const memo = one('data-nd-memo-go', n ? `메모 ${n}` : '메모');
    // S67-11 NEWS-보관빼기: 내가 넣은 기사(공유·손으로 넣은 것, head.mine)는 [삭제] — 내 목록 어디에도 안 보이게(공용 기사 행은 그대로), 5초 [되돌리기].
    // S68-34: 저장해 둔 글이면 저장 해제와 겹치지 않게 기사 자체 삭제는 '기사 삭제'.
    const del = cur.item.type === 'news' && cur.head?.mine ? one('data-nd-delete', m.star ? DELETE_BOTH_LABEL : DELETE_LABEL) : '';
    const star = m.star ? one(`data-nd-act="star" aria-pressed="true" aria-label="${SAVED_ARIA}" title="${SAVED_ARIA}"`, SAVED_LABEL) : btn('star', false, SAVE_LABEL, SAVED_LABEL);
    const dismiss = cur.from === 'saved' ? '' : btn('dismiss', m.dismiss, '관심 없음', '관심 없음 ✓');
    return `${star}${memo}${dismiss}${del}${cur.note ? `<span class="nd-faint" role="status">${esc(cur.note)}</span>` : ''}`;
  }
  // S69-94: 예전에 [메모]로 남긴 메모(노트 한 장, metadata.news_item_id|outside_post_id)는 지우지 않고 메모 칸 위에 한 줄로 보인다(고치기는 그 노트에서).
  function oldMemoHtml() {
    if (!cur.memo) return '';
    // S69 보드잠금가림 전수: 메모 노트를 잠근 노트 폴더로 옮겼고 아직 안 풀었으면 메모 글 대신 '잠김'. 판정은 feature-lock.js 한 곳.
    if (window.KPTUFeatureLock?.noteHidden?.(cur.memo)) return `<p class="nd-memo-text" data-nd-memo-locked data-lock-here="notes"><span class="nd-memo-label">노트 메모</span>잠김 <button type="button" class="row-act lk-open">풀기</button></p>`;
    return cur.memo.raw_text ? `<p class="nd-memo-text" data-nd-memo-text><span class="nd-memo-label">노트 메모</span>${esc(cur.memo.raw_text)} <button type="button" class="row-act" data-nd-oldmemo-open>노트에서 보기</button></p>` : '';
  }
  // 글 아래 메모 칸(이 칸의 그리기 주인은 memo-thread.js). 메모를 남기거나 지우면 아래 줄의 [메모 n]과 [메모] 탭(껍데기)을 맞춘다.
  const memoThread = createMemoThread({onChange: () => { if (!cur) return; signal(cur.item, 'memo'); onChanged?.(cur.item, 'memo', true); paintActs(); }});
  onMemos(() => { if (cur && box?.isConnected) { const a = part('[data-nd-acts]'); if (a) a.innerHTML = actsHtml(); } });
  const attachMemos = () => { if (cur) memoThread.attach(part('[data-nd-memos]'), {type: cur.item.type, id: cur.item.id, title: cur.head?.title || ''}); };
  const part = sel => box?.querySelector(`[data-nd="${CSS.escape(itemKey(cur.item))}"] ${sel}`);
  function paintAi() {
    if (!cur) return;
    const s = part('[data-nd-summary]'), i = part('[data-nd-implications]'), r = part('[data-nd-relslot]');
    if (s) s.innerHTML = sumHtml();
    if (i) { const html = impHtml(); i.innerHTML = html; i.hidden = !html; }
    if (r) r.innerHTML = relatedHtml();
  }
  // MENU-자리나머지: 원문 ⋯ 메뉴를 연 채 원문 칸·상세가 다시 그려져도(원문 읽기 끝·번역·글자 크기) 열린 메뉴는 새 ⋯에 붙고, ⋯가 없어지면 닫힌다(공용 keepMenus).
  var ndMenus = []; // 메뉴는 아래에서 만든다
  const keepOb = paintNow => keepMenus(ndMenus, {attrs: ['data-nd-ob-more'], root: box || document}, paintNow);
  function paintBody() { keepOb(() => { const el = cur && part('[data-nd-body]'); if (el) { el.innerHTML = bodyHtml(); marksNow(); fillOwn(el); } }); }
  // 저장한 밑줄 칠하기(원문 그대로 볼 때만). [밑줄] 탭에서 연 밑줄이 칠해지면 그 자리로 한 번 옮긴다.
  function marksNow() {
    const z = cur && !cur.tr.on ? part('[data-nd-prose]') : null;
    if (!z) return;
    paintMarks(z, sourceHighlights(cur.item.type, cur.item.id));
    if (cur.reveal && revealMark(z, cur.reveal)) cur.reveal = null;
  }
  function paintActs() {
    if (!cur) return;
    const a = part('[data-nd-acts]'), m = part('[data-nd-memo]');
    if (a) a.innerHTML = actsHtml();
    if (m) m.innerHTML = oldMemoHtml();
    attachMemos();
  }
  function paint() { keepOb(paintNow); }
  window.addEventListener('kptu:feature-lock-changed', () => paintActs()); // 메모 노트 잠금이 풀리거나 다시 잠기면 메모 칸만 다시
  function paintNow() {
    if (!box) return;
    if (!cur) { box.innerHTML = '<p class="nd-empty" data-nd-empty>왼쪽 목록에서 글을 선택하세요</p>'; return; }
    const h = cur.head;
    const hit = interestHit([h.title, h.origTitle], topics());
    const imp = impHtml();
    box.innerHTML = `<article class="nd" data-nd="${esc(itemKey(cur.item))}" data-text-size-target data-text-size="${textSize()}" style="--txs:${textScale(textSize())}" aria-label="글 상세">
<div class="ds-doc-top nd-top"><button type="button" class="nd-back" data-nd-close aria-label="목록으로"><span aria-hidden="true">‹</span></button><p class="ds-doc-meta nd-meta">${h.meta.filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('')}${h.manual ? '<span class="nd-hand-mark" data-nd-manual>직접 넣음</span>' : ''}${hit ? `<span class="now-hit">${esc(hit)}</span>` : ''}</p>${h.url ? `<span class="ds-doc-icons">${shareIconHtml(h)}${siteLink('↗', 'ds-doc-icon nd-link nd-site', '원래 페이지')}</span>` : ''}</div>
<h3 class="ds-doc-title nd-title" tabindex="-1"${h.titleLang ? ` lang="${esc(h.titleLang)}"` : ''}>${esc(h.title)}</h3>${h.origTitle ? `<p class="nd-orig" lang="${esc(h.lang || 'en')}">${esc(h.origTitle)}</p>` : ''}
<section class="nd-box nd-orig-box" data-nd-body aria-label="원문 전체">${bodyHtml()}</section>
<section class="nd-box" data-nd-summary aria-label="요약">${sumHtml()}</section>
<section class="nd-box" data-nd-implications aria-label="시사점"${imp ? '' : ' hidden'}>${imp}</section>
<div data-nd-relslot>${relatedHtml()}</div>
<div class="nd-acts" data-nd-acts role="group" aria-label="이 글 표시">${actsHtml()}</div><div data-nd-memo>${oldMemoHtml()}</div><section class="memo-th nd-memos" data-nd-memos aria-label="메모"></section></article>`;
    marksNow();
    attachMemos();
    // S68-40: 상세 전체를 다시 그리면(같은 글 다시 열기·머리 고침 setHead·관심 주제 바뀜) 원문 칸도 새로 그려진다. 내가 올린 사진은
    // 그린 뒤 받아 넣어야 보이므로(받기 전 hidden) 원문 칸만 다시 그릴 때(paintBody)처럼 여기서도 채운다 — 빠지면 사진이 '없어진' 것처럼 보였다.
    const body = part('[data-nd-body]');
    if (body) fillOwn(body);
  }

  // ---------- 열기 ----------
  // 원문: 저장 원문 → (뉴스 기사에 저장 원문 줄이 없거나 잠깐의 오류로 못 읽은 줄이면 기사 먼저 읽기 뒤 다시) → 예전 저장 글자. 답: {hadRow, pre:{ok,why}}.
  async function loadBody(item, my) {
    const key = itemKey(item);
    // S68-40: 저장 원문 읽기가 실패(잠깐의 오류)하면 한 번 더 읽고, 그래도 못 읽으면 [다시]. '줄이 없음'과 같은 길(예전 저장 글자)로 가지 않는다 —
    // 예전 저장 글자는 글만 있어 손으로 넣은 사진 등이 빠진 본문이 '진짜 본문'처럼 보였다. 줄이 정말 없을 때(null)만 예전 저장 글자.
    let row = await readBodyRow(item);
    if (my !== seq) return {stale: true};
    if (row === LOAD_FAILED) { bodies.set(key, {failedLoad: true}); paintBody(); return {hadRow: false}; }
    // 저장 원문 줄이 있으면 그것을 그린다. 뉴스 기사에서 그 줄이 잠깐의 오류(state failed — 늦은 답·사이트 오류)면 아래 '기사 먼저 읽기'로 한 번 다시 읽는다.
    if (row && !(item.type === 'news' && reopenBody(row))) { bodies.set(key, viewOf(row, item.type)); paintBody(); if (item.type === 'news') void freshenHead(item); return {hadRow: true}; }
    let pre = {ok: true};
    if (item.type === 'news') {
      pre = await readFirst(item, my, !!row, !row).catch(() => ({ok: true}));
      if (my !== seq || pre.stale) return {stale: true};
      row = await readBodyRow(item);
      if (my !== seq) return {stale: true};
      if (row === LOAD_FAILED) { bodies.set(key, {failedLoad: true}); paintBody(); return {hadRow: false, pre}; }
      if (row) { bodies.set(key, viewOf(row, item.type)); paintBody(); return {hadRow: true, pre}; }
    }
    let legacy;
    try { legacy = await readLegacyText(item); } catch { legacy = {failedLoad: true}; }
    if (my !== seq) return {stale: true};
    if (legacy.state === 'failed' && pre && !pre.ok && pre.why) legacy = {...legacy, reason: pre.why};
    bodies.set(key, legacyView(legacy)); paintBody();
    return {hadRow: false, pre};
  }
  // 저장 원문 줄 → 그릴 모양. 다시 읽을 실패(reopenBody)면 [원문 다시 가져오기]를 단다(again).
  // S68-49: 봇 확인도 단추(canRefetch). 열 때 저절로 다시 읽는 것은 여전히 reopenBody(뉴스 — 늦은 답·사이트 오류·예전 robots)뿐.
  // S69-02: 저장 원문 줄이 없는 옛 글(legacy)도 못 읽은 모양(lead·failed)이면 단추(뉴스·사회운동 서버 길 모두 줄이 없으면 읽는다).
  const viewOf = (row, type) => { const v = bodyView(row) || legacyBody(''); return canRefetch(row, type) ? {...v, again: true} : v; };
  const legacyView = v => (!v?.failedLoad && (v?.state === 'lead' || v?.state === 'failed') ? {...v, again: true} : v);
  // 저장 원문 한 줄: 줄 · null(정말 없음) · LOAD_FAILED(두 번 읽어도 오류).
  async function readBodyRow(item) {
    for (let i = 0; i < 2; i++) { try { return await readFeedBody(item); } catch { /* 한 번 더 */ } }
    return LOAD_FAILED;
  }
  // 저장 원문 줄이 없는 옛 뉴스 기사: 본문·요약이 아직 없으면 그 기사 하나를 먼저 읽는다(news-feed open). 읽지 못하면 AI를 부르지 않는다.
  // again: 저장 원문 줄이 다시 읽을 실패(reopenBody — 늦은 답·사이트 오류·S68-25 robots)라 요약이 있어도 그 한 쪽을 읽는다. 이 글 하나만(목록은 읽지 않음).
  // noRow(S69-02): 저장 원문 줄이 아예 없다 — 피드 소개(리드)만 있고 글 쪽을 한 번도 읽지 않은 기사(수집 때 본문을 읽지 않는 매체 — 조선일보 등)면 열 때 한 번 읽는다(unreadLead).
  async function readFirst(item, my, again = false, noRow = false) {
    const row0 = await readNewsRow(item);
    if (!row0 || !(again || needsRead(row0) || titlePending(row0) || (noRow && unreadLead(row0)))) return {ok: true};
    cur.reading = true; paintAi(); paintBody();
    let status = '';
    try { status = (await rt().api('/functions/v1/news-feed?action=open', {method: 'POST', body: {id: item.id}, singleFlight: false, timeoutMs: 90000}))?.status || ''; } catch (e) { status = e?.status === 429 ? 'daily_limit' : 'error'; }
    if (my !== seq) return {ok: true, stale: true};
    cur.reading = false;
    if (!bodies.has(itemKey(item))) paintBody();
    const row = (await readNewsRow(item)) || row0;
    if (my !== seq) return {ok: true, stale: true};
    onRead?.(item, row);
    return hasMaterial(row) ? {ok: true} : {ok: false, why: unreadReason(status, row.state)};
  }
  // [원문 다시 가져오기](S68-43): 이 글 하나만 서버가 다시 읽게 하고(뉴스 open · 사회운동 reread) 원문 줄을 다시 읽는다. 본문이 생기면 요약·시사점을 새로.
  // S69-02: again — ⋯ 메뉴에서 누름(다 읽은 글도 한 번 더 읽어, 더 긴 전문이면 서버가 바꿈). 까닭 줄 단추는 예전 몸통({id}) 그대로.
  const bodySig = v => (v ? `${v.state}:${(v.blocks || []).length}:${(v.blocks || []).reduce((n, x) => n + (x.text || x.src || '').length, 0)}` : '');
  async function refetchBody(again = false) {
    const c = cur;
    if (!c || c.refetching) return;
    const item = c.item, key = itemKey(item), my = seq, before = bodySig(bodies.get(key));
    // 사회운동 reread는 실패 본문만 다시 읽으므로 앞부분(lead) 글은 까닭 줄 단추도 again으로(서버가 더 긴 전문일 때만 바꿈).
    if (item.type === 'outside' && (bodies.get(key)?.state || 'failed') !== 'failed') again = true;
    c.refetching = true; c.refetchNote = ''; paintBody();
    const path = item.type === 'news' ? 'news-feed?action=open' : 'outside-feed?action=reread';
    let status = '';
    try { status = (await rt().api(`/functions/v1/${path}`, {method: 'POST', body: again ? {id: item.id, again: true} : {id: item.id}, singleFlight: false, timeoutMs: 90000}))?.status || ''; } catch (e) { status = e?.status === 429 ? 'daily_limit' : 'error'; }
    if (my !== seq || cur !== c) return;
    const row = await readBodyRow(item);
    if (my !== seq || cur !== c) return;
    c.refetching = false;
    if (row && row !== LOAD_FAILED) bodies.set(key, viewOf(row, item.type));
    else if (row === null && item.type === 'news') { try { const lg = await readLegacyText(item); if (my === seq && cur === c) bodies.set(key, legacyView(lg)); } catch { /* 그대로 */ } }
    if (my !== seq || cur !== c) return;
    const b = bodies.get(key);
    // 새 본문이 생겼을 때만(실패 → 본문, 앞부분 → 전문, 전문 → 더 긴 전문). 같은 본문이면 바뀐 것이 없다(요약을 다시 만들지 않음, S68-52).
    if (b && b.state !== 'failed' && bodySig(b) !== before) {
      details.delete(key); asking.delete(key); c.detail = null; c.failed = ''; c.unread = '';
      paintBody(); paintAi();
      if (item.type === 'news') { const nr = await readNewsRow(item).catch(() => null); if (nr && my === seq && cur === c) onRead?.(item, nr); }
      makeDetail(item, my);
      return;
    }
    // 바뀐 것이 없으면 까닭 한 줄만(단추는 그대로 — S69-02). 서버가 다시 읽고도 못 읽었거나 방금 다시 읽었으면(recent) 원래 사이트 링크를 '원래 사이트에서 열기'로(gaveUp).
    if (status === 'daily_limit' || status === 'error') c.refetchNote = unreadReason(status, '');
    else if (status === 'original_only') c.refetchNote = '원래 사이트에서 보는 글이에요';
    else if (status === 'same' || (b && b.state === 'ok')) c.refetchNote = '다시 읽어도 더 긴 본문이 없어요';
    else { gaveUp.add(key); c.refetchNote = status === 'recent' ? '조금 전에 다시 읽어 봤어요 · 원래 사이트에서 볼 수 있어요' : '다시 읽어도 사이트가 본문을 주지 않아요'; }
    paintBody();
  }
  // S63-11: 본문은 이미 저장돼 있는데 기사 줄이 아직 '읽기 전'(제목 없음)이면 서버 열기(news-feed open)를 한 번 불러 제목을 채운다.
  // 다 되면 onRead로 줄 주인(목록·상세 머리)이 새 제목을 그린다. 원문 칸·AI 칸은 건드리지 않는다. 같은 기사는 이 화면에서 한 번만.
  async function freshenHead(item) {
    const key = itemKey(item);
    if (freshened.has(key)) return;
    freshened.add(key);
    let row0 = null;
    try { row0 = await readNewsRow(item); } catch { return; }
    if (!titlePending(row0)) return;
    try { await rt().api('/functions/v1/news-feed?action=open', {method: 'POST', body: {id: item.id}, singleFlight: false, timeoutMs: 90000}); } catch { return; }
    let row = null;
    try { row = await readNewsRow(item); } catch { return; }
    if (row) onRead?.(item, row);
  }
  // 요약·시사점 서버 요청: 같은 글에 이미 나간 요청이 있으면 그것을 같이 기다린다(다른 글을 열었다 돌아와도 새로 보내지 않음, S69-01).
  // 답은 화면이 그 글을 떠났어도 이 탭 메모리에 둔다(다시 열면 바로).
  function fetchDetail(item) {
    const key = itemKey(item);
    let p = asking.get(key);
    if (!p) {
      p = askDetail(item).then(r => {
        if (!r?.detail) throw new Error('shape');
        if (asking.get(key) === p) details.set(key, r.detail); // 그사이 본문을 다시 가져와 새로 묻는 중이면 옛 답은 넣지 않는다
        return r.detail;
      }).finally(() => { if (asking.get(key) === p) asking.delete(key); });
      asking.set(key, p);
    }
    return p;
  }
  async function makeDetail(item, my) {
    const key = itemKey(item);
    try {
      const d = await fetchDetail(item);
      if (my !== seq) return;
      // 저장본을 이미 그렸고 서버 답도 같은 것이면 다시 그리지 않는다(깜빡임 없음).
      const same = sameDetail(cur.detail, d);
      cur.detail = d; cur.failed = ''; cur.reading = false;
      if (same) return;
    } catch (e) {
      if (my !== seq) return;
      cur.reading = false;
      // S68-44: 손으로 넣은 기사에 본문 글자가 없으면(비움·사진만) 요약을 만들지 않는다 — '만드는 중'에 머물지 않고 '본문 없음' 한 줄.
      // S69: 본문 글자가 짧으면(마침표 하나 등) '본문이 짧아 요약하지 않았어요'(noMaterialLine — 엉뚱한 요약을 보이지 않음).
      if (isNoMaterial(e)) { cur.detail = null; cur.unread = noMaterialLine(bodies.get(key), unreadReason('', 'pending')); }
      else if (cur.detail) return; // 저장본을 보이는 중: 잠깐의 오류는 저장본 그대로
      else cur.failed = detailError(e);
    }
    paintAi();
  }
  // 열자마자: 내 저장본(요약·시사점이 다 있는 것)이 있으면 서버 답을 기다리지 않고 바로 그린다(S69-01). 서버 확인은 뒤에서 이어진다.
  async function showSaved(item, my) {
    let row = null;
    try { row = await readSavedDetail(item); } catch { return; }
    if (my !== seq || !cur || cur.detail || cur.failed || cur.unread || !savedUsable(row)) return;
    cur.detail = row;
    paintAi();
  }
  async function load(item) {
    const my = ++seq, key = itemKey(item);
    const have = details.get(key);
    // S69-01: 이 탭에서 이미 받은 요약은 바로 그린다. 예전에는 넣기만 하고 그리지 않아, 다시 연 글의 요약 칸이 '만드는 중'에 멈춰 있었다(요청도 안 나감 = 무한 기다림).
    if (have) { cur.detail = have; paintAi(); }
    Promise.allSettled([readMarks(item), readMemo(item)]).then(([marks, memo]) => {
      if (my !== seq) return;
      if (marks.status === 'fulfilled') cur.marks = marks.value;
      if (memo.status === 'fulfilled') cur.memo = memo.value;
      paintActs();
    });
    if (!have) void showSaved(item, my);
    // 사회운동 글: 원문 읽기와 요약 만들기를 함께 시작. 뉴스 기사: 저장 원문 줄이 있으면 바로, 없는 옛 글만 먼저 읽은 뒤.
    const needBody = !bodies.has(key);
    if (item.type === 'outside' || have) {
      if (!have) makeDetail(item, my);
      if (needBody) loadBody(item, my);
      return;
    }
    if (!needBody) { makeDetail(item, my); return; }
    let got;
    try { got = await loadBody(item, my); } catch { got = {}; } // 원문 칸 오류가 요약 칸을 '만드는 중'에 묶지 않게
    if (my !== seq || got.stale) return;
    if (got.pre && !got.pre.ok) { cur.unread = got.pre.why; paintAi(); return; }
    makeDetail(item, my);
  }
  // from: 어디서 열었나 — 'saved'면 저장한 글에서 연 글(아래 줄에 [관심 없음] 없음). 같은 글을 다시 열면 새 값으로.
  function open(item, head, {highlight = null, from = ''} = {}) {
    if (!item || !head) return;
    const same = cur && itemKey(cur.item) === itemKey(item);
    if (!same) dropPics(cur?.hand);
    if (!same) cur = {item, head, detail: null, failed: '', unread: '', reading: false, note: '', marks: null, memo: null, busy: false, tr: {on: false, busy: false, note: ''}, hand: idleHand()};
    else cur.head = head;
    cur.reveal = highlight;
    cur.from = from;
    paint();
    void loadHighlights().catch(() => {});
    box?.querySelector('.nd-title')?.focus({preventScroll: true});
    if (!same || cur.failed || cur.unread) { cur.failed = ''; cur.unread = ''; if (same) paintAi(); load(item); }
  }
  function close() { seq++; cur = null; paint(); }

  // ---------- 누르기 ----------
  async function toggle(act) {
    if (!cur || cur.busy) return;
    if (act === 'star' && cur.marks?.star) { unsave(); return; }
    const c = cur, item = c.item, m = c.marks || {}, on = !m[act];
    c.busy = true; c.note = ''; paintActs();
    try {
      await setMark(item, act, on);
      c.marks = {...m, [act]: on};
      signal(item, on ? act : 'un' + act);
      onChanged?.(item, act, on);
    } catch (e) { c.note = saveFailNote(e); }
    c.busy = false;
    if (cur === c) { paintActs(); box?.querySelector(`[data-nd-act="${act}"]`)?.focus({preventScroll: true}); }
  }
  // [저장됨 ✓] 누르기 = 저장한 글에서 삭제. 줄 ★·밀기와 같은 dropSaved(알림 5초 [되돌리기] — 원래 저장 시각·폴더로).
  async function unsave() {
    const c = cur;
    c.busy = true; c.note = ''; paintActs();
    const mark = on => {
      c.marks = {...(c.marks || {}), star: on};
      onChanged?.(c.item, 'star', on);
      if (cur === c && !c.busy) paintActs();
    };
    try {
      await dropSaved(c.item, {changed: (item, kind, on) => { if (kind === 'save') mark(on); }});
      onSignal?.();
    } catch (e) { c.note = saveFailNote(e); }
    c.busy = false;
    if (cur === c) { paintActs(); box?.querySelector('[data-nd-act="star"]')?.focus({preventScroll: true}); }
  }
  async function removeCur() {
    if (!cur || cur.busy) return;
    const c = cur;
    c.busy = true; c.note = ''; paintActs();
    try {
      await deleteMine(c.item, {changed: (item, kind, on) => onChanged?.(item, 'delete', on)});
      c.busy = false;
      if (cur === c) onClose?.();
      return;
    } catch (e) { c.note = saveFailNote(e); }
    c.busy = false;
    if (cur === c) paintActs();
  }
  // [번역]: 번역본이 있으면 켜고 끄기만. 없으면 서버 translate(저장본이면 바로 stored) → 줄 읽기 → 블록에 넣기.
  async function toggleTranslate() {
    const c = cur;
    if (!c || c.tr.busy || !canTranslate(c.item, c.head)) return;
    const key = itemKey(c.item);
    if (c.tr.on || translations.has(key)) { c.tr.on = !c.tr.on; c.tr.note = ''; paintBody(); focusTr(); return; }
    c.tr.busy = true; c.tr.note = ''; paintBody();
    try {
      await rt().api(`/functions/v1/${TRANSLATE_FUNCTION[c.item.type]}?action=translate`, {method: 'POST', body: {id: c.item.id}, singleFlight: false, timeoutMs: 130000});
      const row = await readTranslation(c.item);
      const b = bodies.get(key);
      const tv = translatedBlocks(b?.blocks, c.item.type === 'news' ? row?.body : blocksBody(b?.blocks), row?.body_ko);
      if (!tv) throw Object.assign(new Error('NOTHING_TO_TRANSLATE'), {status: 0});
      translations.set(key, tv);
      c.tr.on = true;
    } catch (e) { c.tr.note = translateError(e); }
    c.tr.busy = false;
    if (cur === c) { paintBody(); focusTr(); }
  }
  // [직접 넣기]·⋯ [수정]: 기사 줄(서버)의 지금 값 + 지금 원문 글자로 입력 칸을 채운다. 번역해서 보던 중이면 원문으로 돌린다.
  // move: [옮기기](S68-39) — 처음 값에서 본문 첫 줄 주소를 원문 주소 칸으로 옮긴 값을 칸에 넣고 바로 같은 저장 길(saveHand)로 보낸다.
  //   서버가 거절하면 칸은 열린 채 까닭 한 줄(옮긴 값 그대로), 첫 줄이 주소가 아니게 됐으면 칸만 연다.
  async function openHand(move = false) {
    const c = cur;
    if (!c || c.hand.open) return;
    if (c.item.type === 'outside') {
      if (move) return;
      c.tr.on = false; c.tr.note = '';
      dropPics(c.hand); c.hand = {...idleHand(), open: true, init: {body: ''}};
      paintBody();
      part('[data-nd-hand-in="body"]')?.focus({preventScroll: true});
      return;
    }
    if (c.item.type !== 'news') return;
    c.tr.on = false; c.tr.note = '';
    dropPics(c.hand); c.hand = {...idleHand(), open: true};
    paintBody();
    let row = null;
    try { row = await readArticleCols(c.item, HAND_ROW_COLS); } catch { row = null; }
    if (cur !== c || !c.hand.open) return;
    const b = bodies.get(itemKey(c.item));
    const blocks = b && b.state !== 'failed' && !b.failedLoad ? b.blocks : [];
    c.hand.init = handInitial(row || {url: c.head.url}, blocks);
    for (const p of c.hand.init.photos || []) c.hand.pics.set(p.n, {src: p.src});
    c.hand.next = (c.hand.init.photos?.length || 0) + 1;
    const moved = move ? movedUrlValues(c.hand.init) : null;
    if (moved) c.hand.shown = moved;
    paintBody();
    if (moved) { const form = part('[data-nd-hand-form]'); if (form) { await saveHand(form); return; } }
    part('[data-nd-hand-in="title"]')?.focus({preventScroll: true});
  }
  function closeHand() {
    if (!cur || !cur.hand.open || cur.hand.busy) return;
    dropPics(cur.hand); cur.hand = idleHand();
    paintBody();
    part('[data-nd-hand]')?.focus({preventScroll: true});
  }
  async function saveHand(form) {
    const c = cur;
    if (!c || !c.hand.open || c.hand.busy || !c.hand.init) return;
    if (c.item.type === 'outside') { await saveHandBody(c, form); return; }
    const values = handValues(form);
    const srcs = () => new Map([...c.hand.pics].filter(([n]) => tokensIn(values.body).includes(n)).map(([n, p]) => [n, p.src || '']));
    let req = handRequest(c.item.id, values, c.hand.init, srcs());
    c.hand.shown = values;
    if (req.error) { c.hand.note = req.error; paintHand(); return; }
    c.hand.busy = true; c.hand.note = ''; paintHand();
    // 본문 칸에 남아 있는 '[사진 n]' 중 아직 안 올린 사진을 한 장씩 서버로(실패하면 멈추고 입력한 글은 그대로).
    const waiting = tokensIn(values.body).filter(n => c.hand.pics.get(n)?.file && !c.hand.pics.get(n).src);
    for (let i = 0; i < waiting.length; i++) {
      const p = c.hand.pics.get(waiting[i]);
      c.hand.up = `사진 올리는 중 ${i + 1}/${waiting.length}`; if (cur === c) paintHand();
      try { p.src = await putPhoto(c.item.id, p.file); }
      catch (e) {
        c.hand.busy = false; c.hand.up = ''; c.hand.note = `${photoToken(waiting[i])} · ${handError(e)}`;
        if (cur === c) paintHand();
        return;
      }
      if (cur !== c || !c.hand.open) return;
    }
    c.hand.up = '';
    if (waiting.length) req = handRequest(c.item.id, values, c.hand.init, srcs());
    if (req.error) { c.hand.busy = false; c.hand.note = req.error; paintHand(); return; }
    try {
      await rt().api('/functions/v1/news-feed?action=hand_fill', {method: 'POST', body: req.body, singleFlight: false, timeoutMs: 30000});
    } catch (e) {
      c.hand.busy = false; c.hand.note = handError(e);
      if (cur === c) paintHand();
      return;
    }
    if (cur !== c) return;
    // 새 값으로 다시: 원문·번역·요약은 이 탭 메모리에서 버리고(서버 요약 저장본은 서버가 지움) 기사 줄을 다시 읽어 줄 주인이 목록·머리를 고친다.
    const key = itemKey(c.item);
    bodies.delete(key); translations.delete(key); details.delete(key);
    dropPics(c.hand); c.hand = idleHand();
    c.detail = null; c.failed = ''; c.unread = '';
    let row = null;
    try { row = await readNewsRow(c.item); } catch { row = null; }
    if (cur !== c) return;
    if (row) onRead?.(c.item, row);
    // S69 READ-제목하나: 이 기사에 이어진 저장한 글 줄의 제목 사본도 같은 제목으로(목록·검색·홈·밑줄 출처가 그 사본을 읽는다). 실패해도 목록을 열 때 다시 맞춘다.
    if (row?.title) void import('./reading-data.js').then(m => m.syncNewsTitle(c.item.id, row.title)).then(n => { if (n) window.KPTUReading?.refresh?.(); }).catch(() => {});
    paint();
    notify('저장했어요', {record: false});
    load(c.item);
  }
  // 사회운동 [본문 붙여 넣기](S68-49): 서버 outside-feed hand_body(글 id·본문 글자만). 저장되면 원문·요약을 새 본문으로 다시 읽는다.
  async function saveHandBody(c, form) {
    const values = handValues(form);
    c.hand.shown = values;
    const req = handBodyRequest(c.item.id, values.body);
    if (req.error) { c.hand.note = req.error; paintHand(); return; }
    c.hand.busy = true; c.hand.note = ''; paintHand();
    try {
      await rt().api('/functions/v1/outside-feed?action=hand_body', {method: 'POST', body: req.body, singleFlight: false, timeoutMs: 30000});
    } catch (e) {
      c.hand.busy = false; c.hand.note = e?.status === 409 ? '이미 원문을 읽은 글이에요' : handError(e);
      if (cur === c) paintHand();
      return;
    }
    if (cur !== c) return;
    const key = itemKey(c.item);
    bodies.delete(key); translations.delete(key); details.delete(key); gaveUp.delete(key);
    c.hand = idleHand(); c.detail = null; c.failed = ''; c.unread = ''; c.refetchNote = '';
    paint();
    notify('저장했어요', {record: false});
    load(c.item);
  }
  // [사진 주소 넣기](S67-05): 작은 글 입력창에 붙여 넣은 사진 주소를 본문 칸 커서 자리에 한 줄로. 그림 파일 끝이 아닌 주소는 이 기기에서 사진으로 열리는지 보고 '#사진'을 붙인다.
  // 사진으로 볼지는 서버가 다시 판정한다(https만·포트 없음·20장까지). 사진은 리퍼러 없이 띄운다(본문 사진과 같음).
  async function addHandPhoto(form) {
    const c = cur;
    const area = form?.querySelector('[data-nd-hand-in="body"]');
    if (!c || !c.hand.open || c.hand.busy || !c.hand.init || !area) return;
    const at = area.selectionStart ?? area.value.length;
    const button = form.querySelector('[data-nd-hand-photo]');
    const asked = await askText(button, {text: '사진 주소', placeholder: 'https://…', ok: '넣기', max: 2100});
    if (cur !== c || !c.hand.open || asked === null) return;
    const text = String(asked).trim();
    if (!text) return;
    const kind = handPhotoKind(text);
    const say = note => { c.hand.shown = handValues(form); c.hand.note = note; paintHand(); };
    if (!kind) { say('https 사진 주소만 넣을 수 있어요'); return; }
    if (kind === 'plain' && !(await opensAsPhoto(text))) { if (cur === c) say('사진으로 열리지 않는 주소예요'); return; }
    if (cur !== c || !c.hand.open) return;
    const next = insertPhotoLine(area.value, at, handPhotoLine(text));
    area.value = next.value;
    area.focus({preventScroll: true});
    area.setSelectionRange(next.caret, next.caret);
    if (c.hand.note) { c.hand.shown = handValues(form); c.hand.note = ''; paintHand(); }
  }
  function opensAsPhoto(src) {
    return new Promise(resolve => {
      const img = new Image();
      const done = ok => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok); };
      const timer = setTimeout(() => done(false), 8000);
      img.referrerPolicy = 'no-referrer';
      img.onload = () => done(img.naturalWidth > 0);
      img.onerror = () => done(false);
      img.src = src;
    });
  }
  // ---- 내가 올린 사진(S67-06): 붙여넣기·고르기·끌어다 놓기 → '[사진 n]' 줄, 저장 때 서버로 ----
  function addPics(form, files) {
    const c = cur, area = form?.querySelector('[data-nd-hand-in="body"]');
    if (!c || !c.hand.open || c.hand.busy || !c.hand.init || !area || !files.length) return;
    if (c.item.type !== 'news') return; // 사회운동 [본문 붙여 넣기]는 글자만(S68-49) — 사진은 받지 않는다
    const say = note => { c.hand.shown = handValues(form); c.hand.note = note; paintHand(); };
    const bad = files.map(photoFileError).find(Boolean);
    const good = files.filter(f => !photoFileError(f));
    const body = area.value;
    const have = handPhotoCount(body) + tokensIn(body).filter(n => c.hand.pics.has(n)).length;
    if (have + good.length > HAND_PHOTOS_MAX) { say(`사진은 ${HAND_PHOTOS_MAX}장까지`); return; }
    if (!good.length) { say(bad); return; }
    const lines = good.map(file => { const n = c.hand.next++; c.hand.pics.set(n, {file, view: URL.createObjectURL(file), src: ''}); return photoToken(n); });
    const at = area.selectionStart ?? area.value.length;
    const next = insertPhotoLines(area.value, at, lines);
    // 칸을 다시 그리지 않고 글자만 바꾼다(사진과 함께 붙여 넣은 글자는 브라우저가 이어서 커서 자리에 넣는다).
    area.value = next.value;
    area.focus({preventScroll: true});
    area.setSelectionRange(next.caret, next.caret);
    const strip = area.parentElement?.querySelector('[data-nd-hand-pics]');
    if (strip) { strip.outerHTML = picsHtml(area.value); fillOwn(area.parentElement); }
    if (bad || c.hand.note) say(bad || '');
  }
  async function putPhoto(id, file) {
    const r = rt();
    if (typeof r?.session?.ensure === 'function' && !(await r.session.ensure())) throw Object.assign(new Error('UNAUTHORIZED'), {status: 401});
    const token = r?.session?.read?.()?.access_token;
    if (!token || !r?.config?.url) throw Object.assign(new Error('UNAUTHORIZED'), {status: 401});
    const fd = new FormData();
    fd.append('id', id);
    fd.append('file', file, file.name || 'photo');
    let res;
    try { res = await fetch(`${r.config.url}/functions/v1/news-feed?action=hand_photo_put`, {method: 'POST', cache: 'no-store', headers: {apikey: r.config.key, Authorization: 'Bearer ' + token}, body: fd, signal: AbortSignal.timeout(90000)}); }
    catch { throw new Error('NETWORK'); }
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok || typeof d.src !== 'string' || !ownPhotoOf(d.src)) throw Object.assign(new Error(String(d?.error || 'UPLOAD_FAILED')), {status: res.ok ? 502 : res.status});
    return d.src;
  }
  // 내가 올린 사진 받기: 서버 hand_photo(로그인·그 기사 본문에 있는 사진만) → 이 탭 메모리의 그림 주소.
  const ownViews = new Map(); // `${기사 id}:${파일 id}` → Promise<그림 주소>
  function ownView(articleId, fileId) {
    const key = `${articleId}:${fileId}`;
    if (ownViews.has(key)) return ownViews.get(key);
    const flight = (async () => {
      const r = rt();
      if (typeof r?.session?.ensure === 'function' && !(await r.session.ensure())) throw new Error('session');
      const token = r?.session?.read?.()?.access_token;
      if (!token || !r?.config?.url) throw new Error('session');
      const res = await fetch(`${r.config.url}/functions/v1/news-feed?action=hand_photo`, {method: 'POST', cache: 'no-store', headers: {apikey: r.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({id: articleId, file: fileId, size: 'large'}), signal: AbortSignal.timeout(45000)});
      if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) throw new Error('photo');
      return URL.createObjectURL(await res.blob());
    })();
    ownViews.set(key, flight);
    flight.catch(() => { if (ownViews.get(key) === flight) ownViews.delete(key); });
    return flight;
  }
  // S68-40: 받기가 한 번 실패하면 잠깐 뒤 한 번 더. 그래도 못 받으면 본문 사진 칸은 '사진을 불러오지 못함 [다시]'(감추지 않음).
  // 입력 칸 미리보기 줄(실패 줄 없음)은 예전처럼 그 그림만 감춘다.
  const OWN_RETRY_MS = 1500;
  function fillOwn(root) {
    const c = cur;
    if (!c || c.item.type !== 'news') return;
    for (const img of root.querySelectorAll('img[data-nd-own]')) fillOwnImg(c, img, 1);
  }
  function fillOwnImg(c, img, again) {
    const fig = img.closest('figure'), fail = fig?.querySelector('[data-nd-own-fail]');
    if (fail) fail.hidden = true;
    const failed = () => {
      if (!img.isConnected || cur !== c) return;
      if (again > 0) { setTimeout(() => { if (img.isConnected && cur === c) fillOwnImg(c, img, again - 1); }, OWN_RETRY_MS); return; }
      img.hidden = true;
      if (fail) fail.hidden = false; else if (fig) fig.hidden = true;
    };
    ownView(c.item.id, img.dataset.ndOwn).then(url => {
      if (!img.isConnected) return;
      img.onerror = () => { forgetOwn(c.item.id, img.dataset.ndOwn, url); failed(); };
      img.src = url; img.hidden = false;
    }, failed);
  }
  // 받아 둔 그림 주소가 더는 안 열리면(이 탭에서 풀린 주소 등) 기억을 지워 다음 받기가 서버에서 새로 받게 한다.
  function forgetOwn(articleId, fileId, url) {
    const key = `${articleId}:${fileId}`, flight = ownViews.get(key);
    if (!flight) return;
    flight.then(u => { if (u === url && ownViews.get(key) === flight) { ownViews.delete(key); URL.revokeObjectURL(u); } }, () => {});
  }
  function handValues(form) {
    const val = k => form.querySelector(`[data-nd-hand-in="${k}"]`)?.value ?? '';
    return {title: val('title'), url: val('url'), publisher: val('publisher'), author: val('author'), at: val('at'), body: val('body')};
  }
  // 입력 칸 다시 그리기(사람이 넣은 값 shown 그대로, 알림 줄·누름 막기만 바뀜). 알림이 있으면 저장 단추에 초점을 둔다(화면 읽기 프로그램은 role=status로 읽음).
  function paintHand() {
    paintBody();
    if (cur?.hand.note) part('[data-nd-hand-form] button[type="submit"]')?.focus({preventScroll: true});
  }
  // [복사]: 제목 / 매체·날짜 / 본문 / 주소. 누른 칩이 잠깐 ✓, 위쪽 작은 알림 '복사했어요'.
  async function copyArticle(button = null) {
    if (!cur) return;
    const text = copyArticleText(cur.head, shownBlocks());
    const ok = text ? await copyText(text) : false;
    if (ok && button?.isConnected) flashDone(button);
    notify(ok ? '복사했어요 · 제목·본문·주소' : '복사하지 못했어요. 다시 눌러 주세요.', {error: !ok, record: false});
  }
  // [모두 선택]: 원문 본문 전체를 선택된 상태로(폰은 그 위에 기본 메뉴 복사·공유·검색).
  function selectAll() {
    const prose = cur && part('[data-nd-prose]');
    const sel = window.getSelection?.();
    if (!prose || !sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(prose);
    sel.addRange(range);
  }
  // S71-69 SHARE-글공유: 머리 줄 [공유] 아이콘·원문 ⋯ [공유] = 제목 + 원래 주소(link-share.js — 폰 공유 창 · PC 복사). 주소가 http·https인 글만.
  const canShare = () => !!(cur && articleShare(cur.head));
  // S69-02: ⋯ [원문 다시 가져오기] — 원문 칸이 그려진 글(불러오기 실패·손 본문·다시 읽는 중이 아닌 것). 뉴스·사회운동 모두.
  const canMenuRefetch = () => { const b = cur && bodies.get(itemKey(cur.item)); return !!b && !b.failedLoad && !b.hand && canRefetchMenu(b) && !cur.refetching && !cur.hand?.open && (cur.item.type === 'news' || cur.item.type === 'outside'); };
  async function shareArticle() {
    if (!canShare()) return;
    await shareArticleLink(cur.head);
  }
  const obMenu = createAnchoredMenu({id: 'ndObMenu', className: 'topline-add-menu os-menu nd-ob-menu', label: '원문 메뉴', historyKey: 'kptuNowDetailMenu', key: () => (cur ? itemKey(cur.item) : ''),
    canOpen: () => !!cur,
    render: () => `${part('[data-nd-prose]') ? '<button type="button" class="row-act" data-nd-menu="select">모두 선택</button>' : ''}<button type="button" class="row-act" data-nd-menu="copy">복사</button>${canShare() ? `<button type="button" class="row-act" data-nd-menu="share">${SHARE_LABEL}</button>` : ''}${canMenuRefetch() ? '<button type="button" class="row-act" data-nd-menu="refetch">원문 다시 가져오기</button>' : ''}${cur?.item.type === 'news' ? '<button type="button" class="row-act" data-nd-menu="hand">수정</button>' : ''}`,
    onAction: (button, active) => {
      if (!cur || active.id !== itemKey(cur.item)) return;
      const a = button.dataset.ndMenu;
      if (a === 'select') selectAll(); else if (a === 'copy') void copyArticle(part('[data-nd-copy]')); else if (a === 'share') void shareArticle(); else if (a === 'hand') void openHand(); else if (a === 'refetch') void refetchBody(true);
    }});
  ndMenus = [obMenu];
  // 고른 글 줄(text-select-bar.js): 이 상세의 원문 칸([data-nd-prose])에서 고른 글만. 출처 = 지금 연 글.
  const sourceNow = () => (cur ? {type: cur.item.type, id: cur.item.id, title: cur.head.title, media: cur.head.meta?.[0] || '', date: cur.head.at || null, url: cur.head.url || ''} : null);
  bindSelectZone(box, {zone: '[data-nd-prose]', source: sourceNow, onSave: saveFromSelection, onNote: noteFromSelection});
  bindMarks(box);
  onHighlights(() => marksNow());
  const focusTr = () => box?.querySelector('[data-nd-translate]')?.focus({preventScroll: true});
  box?.addEventListener('click', event => {
    const a = event.target.closest('a[data-nd-link]');
    if (a && cur) { signal(cur.item, 'open'); return; }
    const b = event.target.closest('button');
    if (!b || !box.contains(b) || !cur) return;
    if (b.matches('[data-nd-close]')) { onClose?.(); return; }
    if (b.matches('[data-nd-translate]')) { toggleTranslate(); return; }
    if (b.matches('[data-nd-copy]')) { void copyArticle(b); return; }
    if (b.matches('[data-nd-ob-more]')) { obMenu.open(b); return; }
    if (b.matches('[data-nd-hand]')) { void openHand(); return; }
    if (b.matches('[data-nd-move-url-go]')) { void openHand(true); return; }
    if (b.matches('[data-nd-hand-cancel]')) { closeHand(); return; }
    if (b.matches('[data-nd-hand-pick]')) { b.closest('[data-nd-hand-form]')?.querySelector('[data-nd-hand-file]')?.click(); return; }
    if (b.matches('[data-nd-hand-photo]')) { void addHandPhoto(b.closest('[data-nd-hand-form]')); return; }
    if (b.matches('[data-nd-own-retry]')) { const img = b.closest('figure')?.querySelector('img[data-nd-own]'); if (img) fillOwnImg(cur, img, 0); return; }
    if (b.matches('[data-nd-refetch]')) { void refetchBody(); return; }
    if (b.matches('[data-nd-refetch-hand]')) { void refetchBody(true); return; }
    if (b.matches('[data-nd-body-retry]')) { bodies.delete(itemKey(cur.item)); paintBody(); loadBody(cur.item, seq); return; }
    if (b.matches('[data-nd-retry]')) { cur.failed = ''; cur.unread = ''; paintAi(); load(cur.item); return; }
    if (b.matches('[data-nd-memo-go]')) { const t = part('[data-nd-memos] [data-cm-text]'); part('[data-nd-memos]')?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); t?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nd-oldmemo-open]')) { if (cur?.memo?.id) { requestNoteDocOpen(cur.memo.id); window.KPTURouter?.go?.('basket', {source: 'delegated'}); } return; }
    if (b.matches('[data-nd-delete]')) { removeCur(); return; }
    if (b.matches('[data-nd-share]')) { void shareArticle(); return; }
    if (b.matches('[data-nd-act]')) { toggle(b.dataset.ndAct); return; }
    if (b.matches('[data-nd-related]')) { const r = detailView(cur.detail).related[Number(b.dataset.ndRelated)]; if (r) onRelated?.(r); }
  });
  // 사진이 안 뜨면(사이트가 막음·사라짐) 그 자리에 '사진 ↗' 링크만.
  box?.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('[data-nd-img]')) return;
    img.hidden = true;
    const link = img.parentElement?.querySelector('[data-nd-img-link]');
    if (link) link.hidden = false;
  }, true);
  // 본문 칸: 복사한 사진 붙여넣기(글자와 함께면 글자도 그대로), 끌어다 놓기, [사진]으로 고른 파일, 고칠 때마다 미리보기 줄 맞추기.
  box?.addEventListener('paste', event => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || !area.matches('[data-nd-hand-in="body"]') || !cur?.hand.open || cur.hand.busy) return;
    const files = clipboardFiles(event.clipboardData);
    if (!files.length) return;
    if (!(event.clipboardData?.getData?.('text/plain') || '')) event.preventDefault();
    addPics(area.closest('[data-nd-hand-form]'), files);
  });
  box?.addEventListener('dragover', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-nd-hand-in="body"]') && [...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
  });
  box?.addEventListener('drop', event => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || !area.matches('[data-nd-hand-in="body"]')) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addPics(area.closest('[data-nd-hand-form]'), files);
  });
  box?.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-nd-hand-file]')) return;
    const files = [...(input.files || [])];
    input.value = '';
    addPics(input.closest('[data-nd-hand-form]'), files);
  });
  box?.addEventListener('input', event => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || !area.matches('[data-nd-hand-in="body"]') || !cur?.hand.pics.size) return;
    const on = new Set(tokensIn(area.value)), strip = area.parentElement?.querySelector('[data-nd-hand-pics]');
    for (const fig of strip?.querySelectorAll('[data-nd-hand-pic]') || []) fig.hidden = !on.has(Number(fig.dataset.ndHandPic));
    if (strip) strip.hidden = !on.size;
  });
  box?.addEventListener('submit', event => {
    if (event.target.matches('[data-nd-hand-form]')) { event.preventDefault(); void saveHand(event.target); }
  });
  // 서버 기억 값이 늦게 오면(첫 로딩) 그 값으로.
  paint();
  // S69 저장한 글 ⋯ [수정](명진 11/24 "목록에서 ... 안에 수정 버튼도"): 지금 연 뉴스 기사의 ⋯ [수정] 창을 바로 연다(같은 openHand — 새 창 없음).
  // 본문을 아직 못 읽었으면 저장 원문 줄을 먼저 읽어(사진·글 그대로 칸에 채우게) 연다. 뉴스 기사가 아니면 false.
  async function edit() {
    const c = cur;
    if (!c || c.item.type !== 'news') return false;
    const key = itemKey(c.item);
    if (!bodies.has(key)) {
      const row = await readBodyRow(c.item).catch(() => LOAD_FAILED);
      if (cur !== c) return false;
      if (row && row !== LOAD_FAILED && !bodies.has(key)) bodies.set(key, viewOf(row, c.item.type));
    }
    await openHand();
    return cur === c && !!c.hand.open;
  }
  return {open, close, paint, edit, setHead: head => { if (cur && head) { cur.head = head; paint(); } }, head: () => (cur ? cur.head : null), current: () => (cur ? cur.item : null), reset: () => { details.clear(); bodies.clear(); translations.clear(); freshened.clear(); for (const f of ownViews.values()) f.then(u => URL.revokeObjectURL(u), () => {}); ownViews.clear(); close(); }};
}
