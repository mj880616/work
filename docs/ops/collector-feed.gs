/**
 * Web2 수집 보내기 — 통화 부분 (CALL-통화메뉴 3-가)
 *
 * 하는 일: 1시간마다 새 통화 전사 txt와 그 통화 분석 파일(검토__…md)을 찾아 Web2 서버(collector-feed)로 한 건씩 보낸다.
 *   - 개인 번호·연락처 목록(스크립트 속성 CALL_FEED_PERSONAL_LIST)에 있는 통화도 다른 통화처럼 분석 파일을 기다려 요약·전문까지 보낸다.
 *     다만 분석이 업무라고 해도 개인으로 바꿔 보내므로 서버는 개인 통화함에만 저장한다(업무 통화함에는 들어가지 않는다).
 *   - 개인·애매 통화(분석 v3.5가 요약을 남김)도 요약·전문까지 보낸다. 서버가 개인 통화함에 저장하고 업무 기록에는 쓰지 않는다.
 *     요약이 없는 옛 개인 기록은 서버가 개수만 센다.
 *   - 분석이 아직 없으면 기다린다(3일 넘게 없으면 건너뛴다).
 *   - 지난 개인·애매 통화 다시 보내기(1회용 callFeed_resendPersonal)는 진행 위치를 따로(CALL_FEED_RESEND_STATE) 둔다.
 *   - 어디까지 보냈는지는 이 스크립트의 스크립트 속성(CALL_FEED_STATE)에만 적는다. Drive 파일은 고치지 않는다.
 *     분석 파일의 status, Drive 파일 설명도 건드리지 않는다(Q13).
 *   - 시험 모드(기본 켬): 아무것도 보내지 않고 개수만 실행 로그에 적는다. 어디까지 보냈는지도 바꾸지 않는다.
 * 텔레그램 부분(3-나)은 아래쪽 "텔레그램 보내기" 구간(tgFeed…)에 있다. 같은 프로젝트·같은 비밀값을 쓴다.
 *
 * 설치 안내: docs/ops/collector-feed-setup.md
 * 설계: docs/design/call-telegram-feed.md 3.3·6절, 서버: supabase/functions/collector-feed/handler.ts
 *
 * 비밀값·개인 목록은 이 코드에 넣지 않는다. "프로젝트 설정 → 스크립트 속성"에만 둔다.
 * 기존 전사·분석 스크립트와 이름이 겹치지 않도록 함수·설정 이름은 모두 callFeed로 시작한다.
 */

// ── 여기 한 칸만 채운다 (따옴표는 그대로 두고 안쪽만 바꾼다) ─────────────────
// 통화녹음 폴더: Drive에서 "통화녹음" 폴더(안에 원본·전사 폴더가 있는 폴더)를 열었을 때 주소창 /folders/ 뒤 글자.
// 기존 전사 스크립트의 PIPELINES 첫 줄 rootFolderId와 같은 값이다.
var CALL_FEED_CALL_ROOT_FOLDER = '여기에_통화녹음_폴더_주소_끝부분';
// ─────────────────────────────────────────────────────────────────────

// Web2 받는 입구(공개 주소, 비밀값 아님)
var CALL_FEED_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/collector-feed';
var CALL_FEED_SECRET_KEY = 'COLLECTOR_FEED_SECRET';
var CALL_FEED_SECRET_HEADER = 'x-collector-feed-secret';
var CALL_FEED_LIST_KEY = 'CALL_FEED_PERSONAL_LIST';   // 개인 번호·연락처 이름 목록(쉼표 또는 줄바꿈으로 구분)
var CALL_FEED_TEST_KEY = 'CALL_FEED_TEST_MODE';       // 없거나 '켬'이면 시험 모드. '끔'일 때만 실제로 보낸다
var CALL_FEED_STATE_KEY = 'CALL_FEED_STATE';          // 어디까지 보냈는지(JSON)
var CALL_FEED_RESEND_KEY = 'CALL_FEED_RESEND_STATE';  // 개인 통화 다시 보내기(1회용)의 진행 위치. CALL_FEED_STATE와 따로 둔다
var CALL_FEED_TRANSCRIPT_FOLDER = '전사';             // 기존 전사·분석 스크립트와 같은 이름
var CALL_FEED_ANALYSIS_FOLDERS = ['검토대기', '검토완료'];
var CALL_FEED_RESEND_MAX = 20;                        // 다시 보내기 한 번에 서버로 보낼 수(CALL_FEED_MAX_PER_RUN과 같은 크기)
var CALL_FEED_MAX_PER_RUN = 20;                       // 서버 하루 상한(통화 요청 200건, 업무·개인 합산) 안에서 한 번에 보낼 수
var CALL_FEED_TIME_LIMIT_MS = 4.5 * 60 * 1000;        // 앱 스크립트 6분 제한 전에 멈춘다
var CALL_FEED_WAIT_ANALYSIS_MS = 72 * 3600 * 1000;    // 분석을 기다리는 시간(분석 스크립트가 OpenAI 요청 한도로 반나절 넘게 쉬는 경우가 있어 3일)
var CALL_FEED_MAX_PENDING = 50;                       // 분석 대기 목록 크기 상한(넘치면 오래된 것부터 넘김)
var CALL_FEED_MAX_ATTEMPTS = 3;                       // 서버·연결 실패를 다시 보내는 횟수
// 서버 상한(collector-feed handler.ts·call-analysis.ts와 같은 값)
var CALL_FEED_ANALYSIS_MAX_BYTES = 64 * 1024;
var CALL_FEED_TOTAL_MAX_BYTES = 204800;
var CALL_FEED_MAX_PAST_DAYS = 92;
var CALL_FEED_RECENT_DAYS = 7;   // 녹음 날짜가 이보다 오래된 통화는 보내지 않고 넘긴다(명진 결정 10/25: 최근 일주일과 앞으로만)
var CALL_FEED_KST_MS = 9 * 3600 * 1000;
// 멈춤 알림(OPS-수집멈춤알림): 실행이 끝날 때마다 "보내기가 잘 되고 있나"를 Web2 점검 신호 입구로 알린다. 시각·닫힌 상태 글자만 보내고, 실패해도 보내기는 영향 없다.
var FEED_REPORT_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=heartbeat';   // 공개 주소, 비밀값 아님
var FEED_REPORT_SECRET_KEY = 'COLLECTOR_HEARTBEAT_SECRET';   // 점검 신호 스크립트와 같은 값을 이 프로젝트의 스크립트 속성에도 한 번 넣는다. 없으면 알리지 않고 넘어간다
var FEED_REPORT_FAIL_RUNS = 3;                               // 서버·연결 실패가 이만큼 이어지면 '실패 이어짐'으로 알린다

// ── 손으로 [실행]하는 함수 ───────────────────────────────────────────────

/**
 * 처음 한 번: 최근 일주일(한국 날짜 기준 7일 전 0시)부터 보낸다고 적는다. 그보다 오래된 녹음은 보내지 않는다(명진 결정 10/25).
 * 이미 적혀 있으면 바꾸지 않는다(이미 쓰던 설치는 아래 callFeed_run이 설치 전 일주일 구간을 한 번 따로 보충한다). 시험 모드도 켠 상태로 둔다.
 */
function callFeed_setup() {
  var props = PropertiesService.getScriptProperties();
  var state = callFeed_loadState_();
  if (state.since) {
    Logger.log('이미 시작 시각이 있습니다: ' + state.since + ' (바꾸지 않았습니다)');
  } else {
    state.since = new Date(callFeedRecentStartMs(Date.now())).toISOString();
    state.backfillChecked = true;   // 처음 설치는 시작 시각 자체가 일주일 전이라 따로 보충할 구간이 없다
    callFeed_saveState_(state);
    Logger.log('시작 시각을 적었습니다: ' + state.since + ' — 최근 일주일 안의 통화부터 봅니다.');
  }
  if (!props.getProperty(CALL_FEED_TEST_KEY)) props.setProperty(CALL_FEED_TEST_KEY, '켬');
  callFeed_check();
}

/** 시험 모드에서만: 시작 시각을 24시간 전으로 당긴 뒤 한 번 돌려 최근 하루치 통화 개수를 바로 본다(보내지 않음). 시험 모드를 끄면 이 하루치도 함께 보낸다. */
function callFeed_testLastDay() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CALL_FEED_TEST_KEY) === '끔') throw new Error('시험 모드가 꺼져 있어 시작 시각을 당기지 않습니다. callFeed_testModeOn을 먼저 실행하세요.');
  var state = callFeed_loadState_();
  state.since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  callFeed_saveState_(state);
  Logger.log('시작 시각을 24시간 전으로 당겼습니다: ' + state.since);
  callFeed_run();
}

/** 설정 확인: 폴더·비밀값·목록이 제대로 들어갔는지 본다(값은 로그에 찍지 않는다). */
function callFeed_check() {
  var props = PropertiesService.getScriptProperties();
  var secretLength = (props.getProperty(CALL_FEED_SECRET_KEY) || '').length;   // 길이만 본다. 값은 쓰지 않는다
  var list = callFeedParseList(props.getProperty(CALL_FEED_LIST_KEY) || '');
  var folders = callFeed_folders_();
  Logger.log([
    '전사 폴더: 찾음',
    '분석 폴더: ' + folders.analysis.length + '개 찾음(' + CALL_FEED_ANALYSIS_FOLDERS.join('·') + ')',
    '비밀값: ' + (secretLength >= 32 ? '있음' : '없음 또는 너무 짧음 — 안내 2단계'),
    '개인 목록: 번호 ' + list.numbers.length + '개, 이름 ' + list.names.length + '개',
    '시험 모드: ' + (callFeed_testMode_() ? '켬(보내지 않음)' : '끔(실제로 보냄)'),
    '시작 시각: ' + (callFeed_loadState_().since || '없음 — callFeed_setup을 먼저 실행'),
    '자동 실행 트리거: ' + feedTriggerSummary_(['callFeed_run'], '1시간 트리거(callFeed_run)가 없습니다 — callFeed_installHourlyTrigger를 실행하세요'),
    '마지막 실행: ' + tgFeedLastRunText(callFeed_loadState_().lastRun),
    feedReportCheckText_(callFeed_loadState_().stall),
  ].join('\n'));
}

/** 시험 모드 끄기: 다음 실행부터 실제로 보낸다. */
function callFeed_testModeOff() {
  PropertiesService.getScriptProperties().setProperty(CALL_FEED_TEST_KEY, '끔');
  Logger.log('시험 모드를 껐습니다. 다음 실행부터 Web2로 보냅니다.');
}

/** 시험 모드 다시 켜기: 보내기를 멈추고 개수만 센다. */
function callFeed_testModeOn() {
  PropertiesService.getScriptProperties().setProperty(CALL_FEED_TEST_KEY, '켬');
  Logger.log('시험 모드를 켰습니다. 보내지 않고 개수만 셉니다.');
}

/** 처음 한 번: 1시간마다 callFeed_run을 부르는 트리거를 만든다(있던 같은 트리거는 지우고 하나만 둔다). */
function callFeed_installHourlyTrigger() {
  callFeed_removeTrigger();
  ScriptApp.newTrigger('callFeed_run').timeBased().everyHours(1).create();
  Logger.log('1시간 트리거를 만들었습니다.');
}

/** 멈추기·되돌리기: 이 스크립트의 통화 보내기 트리거만 지운다(전사·분석 트리거는 건드리지 않는다). */
function callFeed_removeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'callFeed_run') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('지운 통화 보내기 트리거: ' + removed + '개');
}

/**
 * 비밀값을 잃어버렸을 때만: 새 비밀값을 만들어 스크립트 속성에 넣는다(있으면 바꾸지 않는다).
 * 그 뒤 Supabase Secrets의 COLLECTOR_FEED_SECRET도 같은 값으로 바꿔야 한다. 값은 로그에 찍지 않는다.
 */
function callFeed_makeSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CALL_FEED_SECRET_KEY)) { Logger.log('비밀값이 이미 있습니다. 바꾸지 않았습니다.'); return; }
  props.setProperty(CALL_FEED_SECRET_KEY, (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('새 비밀값을 스크립트 속성에 넣었습니다(값은 로그에 남기지 않음). Supabase에도 같은 값을 넣으세요.');
}

/**
 * 1회용 — 지난 개인·애매 통화 다시 보내기 (CALL-개인통화함 3단계).
 * 개인 통화함이 생기기 전에는 개인·애매 통화의 내용이 서버에 가지 않았다(개수만). 최근 7일 녹음 중 분석(v3.5)이 개인·애매 요약을 가진 통화를
 * 이 함수가 한 번 더 보내 개인 통화함에 채운다. 서버는 원본 고유키로 중복을 막으므로 이미 개인 통화함·업무 통화함에 있는 통화는 '이미 있음'으로 끝난다.
 * - 보내는 통화: 녹음 날짜가 최근 7일 안, 분석 파일이 있고, 구분이 개인·애매(또는 개인 번호 목록 통화)이며, 핵심요약이 실제로 있는 것만.
 *   업무 통화·요약 없는 옛 기록(서버가 개수만 다시 세어 숫자가 늘어남)·분석이 아직 없는 통화는 보내지 않는다(분석이 생기면 평소 보내기가 보낸다).
 * - 진행 위치는 CALL_FEED_STATE가 아니라 CALL_FEED_RESEND_STATE에만 적는다. 평소 보내기(callFeed_run)의 앞으로만 가는 진행 위치는 건드리지 않는다.
 * - 한 번에 CALL_FEED_RESEND_MAX건까지 보내고 멈춘다. 멈췄으면 다시 [실행]하면 이어서 한다. '끝까지 봄'이 나오면 끝이다.
 * - 시험 모드(기본 켬)에서는 보내지 않고 보낼 개수만 로그에 적고 진행 위치도 적지 않는다. 시험 모드를 끈 뒤에 실행해야 실제로 보낸다.
 */
function callFeed_resendPersonal() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var test = callFeed_testMode_();
  var secret = props.getProperty(CALL_FEED_SECRET_KEY) || '';
  if (!test && secret.length < 32) throw new Error('스크립트 속성에 ' + CALL_FEED_SECRET_KEY + '가 없습니다. 안내 2단계를 먼저 하세요.');
  var list = callFeedParseList(props.getProperty(CALL_FEED_LIST_KEY) || '');
  var folders = callFeed_folders_();
  var nowMs = Date.now();
  var recentStart = callFeedRecentStartMs(nowMs);
  var from = Math.max(callFeed_loadResend_().from, recentStart);
  var tally = { looked: 0, wanted: 0, sent: 0, saved: 0, duplicate: 0, noAnalysis: 0, notWanted: 0, old: 0, skipped: 0, personal: 0, unsure: 0 };
  var stop = '', cursor = from;
  var files = callFeed_newTranscripts_(folders.transcript, from);
  for (var i = 0; i < files.length; i++) {
    if (Date.now() - started > CALL_FEED_TIME_LIMIT_MS) { stop = '시간 제한'; break; }
    if (!test && tally.sent >= CALL_FEED_RESEND_MAX) { stop = '한 번에 보낼 수 도달'; break; }
    var file = files[i].file, created = files[i].created, id = file.getId(), info = callFeedTranscriptName(file.getName());
    tally.looked++;
    if (callFeedTooOld(info.day || callFeedKstDay(created), nowMs)) { tally.old++; cursor = created; continue; }
    var analysis = callFeed_findAnalysis_(folders.analysis, file.getName(), id);
    if (!analysis) { tally.noAnalysis++; cursor = created; continue; }
    var analysisMd = analysis.getBlob().getDataAsString('UTF-8');
    var isList = callFeedIsPersonal(info.contact, list);
    var want = callFeedResendWanted(analysisMd, isList);
    if (!want) { tally.notWanted++; cursor = created; continue; }
    tally.wanted++;
    var body = callFeedBuildCallBody({ ref: id, analysisMd: analysisMd, transcript: file.getBlob().getDataAsString('UTF-8'), driveUrl: file.getUrl(), contact: info.contact, recordedAt: info.datetime, forcePersonal: isList });
    if (!body) { tally.skipped++; cursor = created; continue; }
    if (test) { tally.sent++; if (want === '애매') tally.unsure++; else tally.personal++; cursor = created; continue; }
    var res = callFeed_post_('call', body, secret);
    var verdict = callFeedVerdict(res.code);
    if (verdict === 'ok') {
      var out = res.json || {};
      tally.sent++;
      if (out.duplicate) tally.duplicate++; else if (out.boxed) tally.saved += out.boxed; else tally.skipped++;
      if (want === '애매') tally.unsure++; else tally.personal++;
      cursor = created;
    } else if (verdict === 'auth') {
      callFeed_saveResend_(cursor);
      throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
    } else if (verdict === 'limit') {
      stop = '서버 하루 상한(429) — 내일 다시 실행하면 이어서 보냄';
      break;
    } else if (verdict === 'drop') {
      tally.skipped++; cursor = created;
      Logger.log('서버가 거절해 넘김(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
    } else {
      stop = '서버·연결 실패(HTTP ' + res.code + ') — 다시 실행하면 같은 통화부터 이어서 보냄';
      break;
    }
  }
  if (!test) callFeed_saveResend_(cursor);
  Logger.log([
    (test ? '[시험 모드 — 보내지 않음] ' : '') + '지난 개인·애매 통화 다시 보내기: 전사 ' + tally.looked + '건 확인',
    (test ? '보낼 것: ' : '보냄: ') + tally.sent + ' (개인 ' + tally.personal + ' · 애매 ' + tally.unsure + ')' + (test ? '' : ' · 개인 통화함에 새로 저장 ' + tally.saved + ' · 이미 있음 ' + tally.duplicate),
    '보내지 않음: 업무·요약 없음 ' + tally.notWanted + ' · 분석 아직 없음 ' + tally.noAnalysis + (tally.old ? ' · 일주일 넘은 옛 녹음 ' + tally.old : '') + (tally.skipped ? ' · 넘김 ' + tally.skipped : ''),
    stop ? '멈춘 이유: ' + stop + (test ? '' : ' (다시 [실행]하면 이어서 합니다)') : '끝까지 봄',
  ].join('\n'));
}

/** 다시 보내기를 처음부터 다시 하고 싶을 때만: 진행 위치를 지운다(서버가 중복을 막으므로 다시 해도 같은 통화는 '이미 있음'). */
function callFeed_resendReset() {
  PropertiesService.getScriptProperties().deleteProperty(CALL_FEED_RESEND_KEY);
  Logger.log('다시 보내기 진행 위치를 지웠습니다. 다음 실행은 최근 7일 처음부터 봅니다.');
}

function callFeed_loadResend_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CALL_FEED_RESEND_KEY);
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  var from = Number(s.from);
  return { from: isFinite(from) && from > 0 ? from : 0 };
}

/** 진행 위치는 앞으로만 간다(저장된 값보다 작은 값은 쓰지 않는다). */
function callFeed_saveResend_(cursorMs) {
  var prev = callFeed_loadResend_().from;
  PropertiesService.getScriptProperties().setProperty(CALL_FEED_RESEND_KEY, JSON.stringify({ from: Math.max(prev, cursorMs) }));
}

// ── 1시간 트리거가 부르는 함수 ─────────────────────────────────────────

function callFeed_run() { feedGuard_('call', callFeed_runCore_); }

function callFeed_runCore_() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var test = callFeed_testMode_();
  var secret = props.getProperty(CALL_FEED_SECRET_KEY) || '';
  if (!test && secret.length < 32) throw new Error('스크립트 속성에 ' + CALL_FEED_SECRET_KEY + '가 없습니다. 안내 2단계를 먼저 하세요.');
  var state = callFeed_loadState_();
  if (!state.since) throw new Error('시작 시각이 없습니다. callFeed_setup을 먼저 한 번 실행하세요.');
  var list = callFeedParseList(props.getProperty(CALL_FEED_LIST_KEY) || '');
  var folders = callFeed_folders_();
  var nowMs = Date.now();
  var tally = { noClass: 0, personalList: 0, boxed: 0, sent: 0, work: 0, personal: 0, unsure: 0, failed: 0, duplicate: 0, waiting: 0, skipped: 0, retry: 0 };
  var skipDays = test ? {} : state.skips;   // 시험 모드에서는 상태를 바꾸지 않는다
  var pending = test ? callFeedPendingClean(state.pending) : state.pending;   // 분석을 기다리는 통화 목록(시험 모드에서는 저장하지 않는다)
  var cursor = Date.parse(state.since);
  var stop = '', kind = '';

  // 보충 구간(한 번만): 예전 설치는 '설치한 시각 뒤에 만들어진 전사만' 봤기 때문에, 설치 전에 만들어졌지만 녹음이 최근 일주일 안인
  // 통화(분석은 나중에 끝남)가 빠져 있었다. [일주일 전 0시, 지금까지의 시작 시각] 구간을 따로 한 번 훑는다.
  // 그 뒤(시작 시각 이후)는 이미 훑었으므로 겹치지 않아 개인 목록 개수가 두 번 세어지지 않는다.
  var recentStart = callFeedRecentStartMs(nowMs);
  if (!state.backfillChecked) {
    state.backfillChecked = true;
    state.backfill = cursor > recentStart ? { from: recentStart, to: cursor } : null;
  }
  var backfill = state.backfill;

  // 한 통화를 처리한다. 'done' = 끝남(보냄·거름·넘김), 'wait' = 분석 대기, 'stop' = 이번 실행을 멈춤(실패·상한·시간)
  function handle(file, created) {
    var id = file.getId(), name = file.getName();
    var info = callFeedTranscriptName(name);
    var day = info.day || callFeedKstDay(created);

    // 0단계: 녹음 날짜가 최근 일주일보다 오래된 통화는 분석을 기다리지 않고 넘긴다(옛 녹음을 한꺼번에 올린 경우)
    if (callFeedTooOld(day, nowMs)) { tally.old = (tally.old || 0) + 1; return 'done'; }

    // 1단계: 개인 번호·연락처 목록에 든 통화는 내용까지 보내되 개인으로 고정한다(분석이 업무라고 해도 개인 통화함으로 간다)
    var isList = callFeedIsPersonal(info.contact, list);

    var analysis = callFeed_findAnalysis_(folders.analysis, name, id);
    var decision = callFeedPendingDecision({ created: created }, nowMs, !!analysis);
    if (decision === 'wait') return 'wait';
    if (decision === 'expire') {
      if (isList) {   // 분석이 끝내 안 생긴 목록 통화는 예전처럼 날짜별 개수만 센다
        tally.personalList++;
        if (!test) skipDays[day] = (skipDays[day] || 0) + 1;
        return 'done';
      }
      tally.skipped++;   // 분석이 끝내 안 생긴 통화(수동 처리 등)는 넘긴다
      return 'done';
    }
    if (isList) tally.personalList++;
    var analysisMd = analysis.getBlob().getDataAsString('UTF-8');
    var transcript = file.getBlob().getDataAsString('UTF-8');
    var body = callFeedBuildCallBody({ ref: id, analysisMd: analysisMd, transcript: transcript, driveUrl: file.getUrl(), contact: info.contact, recordedAt: info.datetime, forcePersonal: isList });
    if (!body) { tally.skipped++; return 'done'; }   // 분석 파일이 너무 큼

    if (test) {
      var cls = isList && callFeedClass(analysisMd) !== '실패' ? '개인' : callFeedClass(analysisMd);
      if (cls === '실패') tally.failed++; else if (cls === '업무') tally.work++; else if (cls === '개인') tally.personal++; else if (cls === '애매') tally.unsure++; else tally.noClass++;
      tally.sent++;
      return 'done';
    }

    var res = callFeed_post_('call', body, secret);
    var verdict = callFeedVerdict(res.code);
    if (verdict === 'ok') {
      var out = res.json || {};
      if (out.duplicate) tally.duplicate++;
      tally.work += out.kept || 0; tally.personal += out.personal || 0; tally.unsure += out.unsure || 0; tally.failed += out.failed || 0;
      tally.boxed += out.boxed || 0;
      tally.sent++;
      delete state.attempts[id];
      return 'done';
    } else if (verdict === 'auth') {
      callFeed_saveProgress_(state, cursor, skipDays, pending, backfill);
      throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
    } else if (verdict === 'limit') {
      stop = '서버 하루 상한(429) — 다음 실행에서 이어 보냄';
      kind = feedKindPick(kind, feedLimitKind(res.json && res.json.error));
      return 'stop';
    } else if (verdict === 'drop') {
      tally.skipped++;   // 고쳐도 다시 될 일이 없는 거절(400·413). 넘긴다
      Logger.log('서버가 거절해 넘김(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
      return 'done';
    }
    state.attempts[id] = (state.attempts[id] || 0) + 1;
    tally.retry++;
    if (state.attempts[id] >= CALL_FEED_MAX_ATTEMPTS) {
      Logger.log(CALL_FEED_MAX_ATTEMPTS + '번 실패해 넘김(HTTP ' + res.code + ')');
      delete state.attempts[id];
      tally.skipped++;
      return 'done';
    }
    stop = '서버·연결 실패(HTTP ' + res.code + ') — 다음 실행에서 다시 보냄';
    kind = feedKindPick(kind, 'bad');
    return 'stop';
  }

  function overLimit() {
    if (Date.now() - started > CALL_FEED_TIME_LIMIT_MS) { stop = '시간 제한'; return true; }
    if (!test && tally.sent + tally.retry >= CALL_FEED_MAX_PER_RUN) { stop = '한 번에 보낼 수 도달'; return true; }
    return false;
  }

  // 1) 먼저 대기 목록을 본다: 분석이 생겼으면 보내고 빼며, 3일이 지났으면 넘김으로 세고 뺀다.
  var stillPending = [], pendingChecked = pending.length;
  for (var p = 0; p < pending.length; p++) {
    if (stop || overLimit()) { stillPending.push(pending[p]); continue; }
    var pf = null;
    try { pf = DriveApp.getFileById(pending[p].id); if (pf.isTrashed()) pf = null; } catch (e) { pf = null; }
    if (!pf) { tally.skipped++; continue; }   // 파일이 없어짐(지움)
    var pr = handle(pf, pending[p].created);
    if (pr === 'wait') {
      tally.waiting++;
      stillPending.push({ id: pending[p].id, created: pending[p].created, tries: (pending[p].tries || 0) + 1 });
    } else if (pr === 'stop') {
      stillPending.push(pending[p]);
    }
  }
  pending = stillPending;

  // 대기 목록에 이미 있는 통화는 위 1)에서 봤으므로 아래 훑기에서 다시 보지 않는다.
  var pendingIds = {};
  pending.forEach(function (e) { pendingIds[e.id] = true; });
  var seenNow = 0;

  // 2) 보충 구간(위 설명). 만든 순서대로 보내고, 멈추면 어디까지 봤는지(from)를 적어 다음 실행에서 이어 한다.
  if (!stop && backfill) {
    var bfiles = callFeed_newTranscripts_(folders.transcript, backfill.from, backfill.to);
    var bdone = true;
    for (var b = 0; b < bfiles.length; b++) {
      if (pendingIds[bfiles[b].file.getId()]) { backfill.from = bfiles[b].created; continue; }
      if (overLimit()) { bdone = false; break; }
      var br = handle(bfiles[b].file, bfiles[b].created);
      if (br === 'stop') { bdone = false; break; }
      if (br === 'wait') {
        tally.waiting++;
        pending.push({ id: bfiles[b].file.getId(), created: bfiles[b].created, tries: 1 });
      }
      seenNow++;
      backfill.from = bfiles[b].created;
    }
    if (bdone) backfill = null;
  }

  // 3) 새 통화. 분석이 아직 없는 통화는 대기 목록에 넣고 진행 위치를 지나 뒤의 통화를 계속 본다.
  var files = [];
  if (!stop) files = callFeed_newTranscripts_(folders.transcript, cursor);
  for (var i = 0; i < files.length; i++) {
    if (overLimit()) break;
    var r = handle(files[i].file, files[i].created);
    if (r === 'stop') break;
    if (r === 'wait') {
      tally.waiting++;
      pending.push({ id: files[i].file.getId(), created: files[i].created, tries: 1 });
    }
    cursor = files[i].created;
  }

  // 대기 목록이 너무 길면 가장 오래된 것부터 넘김으로 처리한다.
  var trimmed = callFeedPendingTrim(pending, CALL_FEED_MAX_PENDING);
  pending = trimmed.keep;
  tally.skipped += trimmed.dropped.length;

  var rep = feedStallNext(state.stall, { test: test, kind: kind, sent: tally.sent > 0 }, Date.now());
  if (!test) state.stall = { bad: rep.bad, sentAt: rep.sentAt, base: rep.base };

  // 개인 목록으로 거른 수: 날짜마다 한 번씩 보낸다. 실패하면 남겨 두었다가 다음 실행에서 보낸다.
  if (!test) {
    Object.keys(skipDays).sort().forEach(function (d) {
      if (!callFeedDayInRange(d, nowMs)) { delete skipDays[d]; return; }
      var r2 = callFeed_post_('call_skip', { day: d, personal: Math.min(skipDays[d], 500), short: 0 }, secret);
      if (r2.code === 200) delete skipDays[d];
      else if (r2.code === 400) delete skipDays[d];
    });
    state.lastRun = tgFeedLastRun(Date.now(), stop, tally.sent, tally.work + tally.personal + tally.unsure, tally.skipped + tally.failed);
    callFeed_saveProgress_(state, cursor, skipDays, pending, backfill);
  }

  Logger.log([
    (test ? '[시험 모드 — 보내지 않음] ' : '') + '전사 ' + (files.length + seenNow) + '건 확인' + (backfill ? '(설치 전 일주일 구간 보충 중)' : '') + (pendingChecked ? ' · 대기 목록 ' + pendingChecked + '건 다시 봄' : ''),
    '개인 번호 목록 통화: ' + tally.personalList + '(내용까지 개인 통화함으로)',
    (test ? '보낼 것: ' : '보냄: ') + tally.sent + ' (업무 ' + tally.work + ' · 개인 ' + tally.personal + ' · 애매 ' + tally.unsure +
      (test ? ' · 구분 없음(옛 분석·비어 있음) ' + tally.noClass + ' · 분석 실패 ' + tally.failed : ' · 개인 통화함에 저장 ' + tally.boxed + ' · 판정 실패 ' + tally.failed + ' · 이미 있음 ' + tally.duplicate) + ')',
    '분석 대기: ' + tally.waiting + (tally.waiting ? '건(건너뛰고 계속)' : '') + ' · 대기 목록: ' + pending.length + '건 · 넘김: ' + tally.skipped + (tally.old ? ' · 일주일 넘은 옛 녹음 넘김: ' + tally.old : '') + (tally.retry ? ' · 다시 보낼 것: ' + tally.retry : ''),
    stop ? '멈춘 이유: ' + stop : '끝까지 봄',
  ].join('\n'));
  return { source: 'call_send', lastAt: rep.lastAt, state: rep.state };
}

// ── Apps Script 도우미 (고칠 필요 없음) ─────────────────────────────────

function callFeed_testMode_() {
  return PropertiesService.getScriptProperties().getProperty(CALL_FEED_TEST_KEY) !== '끔';
}

function callFeed_loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CALL_FEED_STATE_KEY);
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  var bf = s.backfill && isFinite(Number(s.backfill.from)) && isFinite(Number(s.backfill.to)) ? { from: Number(s.backfill.from), to: Number(s.backfill.to) } : null;
  return { since: typeof s.since === 'string' ? s.since : '', backfillChecked: s.backfillChecked === true, backfill: bf, attempts: s.attempts || {}, skips: s.skips || {}, pending: callFeedPendingClean(s.pending), lastRun: tgFeedLastRunClean(s.lastRun), stall: feedStallClean(s.stall) };
}

function callFeed_saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(CALL_FEED_STATE_KEY, JSON.stringify(state));
}

function callFeed_saveProgress_(state, cursorMs, skipDays, pending, backfill) {
  state.since = new Date(Math.max(cursorMs, Date.parse(state.since) || 0)).toISOString();
  state.backfill = backfill || null;
  state.skips = skipDays;
  state.pending = pending || [];
  callFeed_saveState_(state);
}

/** 기존 분석 스크립트와 같은 방법으로 폴더를 찾는다: 통화녹음/전사, 그리고 통화녹음의 상위 폴더 아래 검토대기·검토완료. */
function callFeed_folders_() {
  if (!CALL_FEED_CALL_ROOT_FOLDER || CALL_FEED_CALL_ROOT_FOLDER.indexOf('여기에_') === 0) throw new Error('코드 맨 위 통화녹음 폴더 칸을 채우세요.');
  var root = DriveApp.getFolderById(CALL_FEED_CALL_ROOT_FOLDER);
  var transcript = callFeed_onlyChild_(root, CALL_FEED_TRANSCRIPT_FOLDER);
  if (!transcript) throw new Error('통화녹음 폴더 안에 "' + CALL_FEED_TRANSCRIPT_FOLDER + '" 폴더가 없습니다. 폴더 칸을 확인하세요.');
  var parents = root.getParents();
  if (!parents.hasNext()) throw new Error('통화녹음 폴더의 상위 폴더를 찾지 못했습니다.');
  var parent = parents.next();
  var analysis = [];
  CALL_FEED_ANALYSIS_FOLDERS.forEach(function (n) { var f = callFeed_onlyChild_(parent, n); if (f) analysis.push(f); });
  if (!analysis.length) throw new Error('검토대기·검토완료 폴더를 찾지 못했습니다.');
  return { transcript: transcript, analysis: analysis };
}

function callFeed_onlyChild_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (!it.hasNext()) return null;
  var first = it.next();
  if (it.hasNext()) throw new Error('같은 이름의 폴더가 2개 이상입니다: ' + name);
  return first;
}

/** 시작 시각 뒤(untilMs가 있으면 그 시각까지)에 만들어진 txt 전사만, 만든 순서대로. */
function callFeed_newTranscripts_(folder, sinceMs, untilMs) {
  // 검색은 고친 시각으로 좁히고(새로 만든 파일은 그 뒤에 고친 것이기도 함), 만든 시각은 아래에서 다시 거른다.
  var q = 'trashed = false and modifiedDate > "' + Utilities.formatDate(new Date(sinceMs), 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + '"';
  var it = folder.searchFiles(q), out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.txt$/i.test(f.getName()) && f.getMimeType() !== 'text/plain') continue;
    var created = f.getDateCreated().getTime();
    if (created > sinceMs && (!untilMs || created <= untilMs)) out.push({ file: f, created: created });
  }
  out.sort(function (a, b) { return a.created - b.created; });
  return out;
}

/** 분석 파일을 정확한 이름으로 찾는다(기존 분석 스크립트 analysisOutputName_ 규칙, callFeedAnalysisName). */
function callFeed_findAnalysis_(folders, transcriptName, transcriptId) {
  var name = callFeedAnalysisName(transcriptName, transcriptId);
  for (var i = 0; i < folders.length; i++) {
    var it = folders[i].getFilesByName(name);
    while (it.hasNext()) {
      var f = it.next();
      if (!f.isTrashed()) return f;
    }
  }
  return null;
}

function callFeed_post_(action, body, secret) {
  var headers = {};
  headers[CALL_FEED_SECRET_HEADER] = secret;
  try {
    var res = UrlFetchApp.fetch(CALL_FEED_URL + '?action=' + action, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    var json = null;
    try { json = JSON.parse(res.getContentText()); } catch (e) { json = null; }
    return { code: res.getResponseCode(), json: json };
  } catch (e) {
    return { code: 0, json: null };   // 연결 실패
  }
}

// ── 순수 함수 (네트워크·Drive 없음, tests/security/collector-feed-gas.test.mjs가 시험) ──────────

function callFeedNfc(s) { return String(s == null ? '' : s).normalize('NFC'); }

/** 번호처럼 보이는 글(숫자·+·-·빈칸·괄호만)이면 숫자만 남긴다. +82는 0으로 바꾼다. 아니면 null. */
function callFeedNormalizeNumber(value) {
  var s = callFeedNfc(value).trim();
  if (!s || !/^[\d\s+().-]+$/.test(s)) return null;
  var d = s.replace(/\D/g, '');
  if (/^82\d{8,11}$/.test(d) && s.indexOf('+') >= 0) d = '0' + d.slice(2);
  else if (/^0082\d{8,11}$/.test(d)) d = '0' + d.slice(4);
  return d.length >= 3 ? d : null;
}

/** 이름: NFC, 앞뒤 빈칸 제거, 가운데 빈칸 하나로. */
function callFeedNormalizeName(value) {
  return callFeedNfc(value).replace(/\s+/g, ' ').trim();
}

/** 스크립트 속성의 목록 글을 번호·이름으로 나눈다. 쉼표·세미콜론·줄바꿈으로 구분. */
function callFeedParseList(text) {
  var numbers = [], names = [];
  callFeedNfc(text).split(/[,;\n\r]+/).forEach(function (item) {
    var n = callFeedNormalizeNumber(item);
    if (n) { if (numbers.indexOf(n) < 0) numbers.push(n); return; }
    var name = callFeedNormalizeName(item);
    if (name && names.indexOf(name) < 0) names.push(name);
  });
  return { numbers: numbers, names: names };
}

/** 전사 파일 이름 `통화 <번호 또는 연락처 이름>_<YYMMDD>_<HHMMSS>.txt`에서 연락처와 날짜(한국 날짜). */
function callFeedTranscriptName(name) {
  var m = /^통화\s+(.+?)_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:\.txt)?$/i.exec(callFeedNfc(name).trim());
  if (!m) return { contact: null, day: null, datetime: null };
  var mo = Number(m[3]), d = Number(m[4]);
  var day = mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? '20' + m[2] + '-' + m[3] + '-' + m[4] : null;
  return { contact: m[1], day: day, datetime: day ? day + ' ' + m[5] + ':' + m[6] + ':' + m[7] : null };
}

/** 연락처(번호 또는 이름)가 개인 목록에 있나. 번호는 숫자만, 이름은 글자 그대로 비교한다. */
function callFeedIsPersonal(contact, list) {
  if (!contact || !list) return false;
  var n = callFeedNormalizeNumber(contact);
  if (n) return list.numbers.indexOf(n) >= 0;
  return list.names.indexOf(callFeedNormalizeName(contact)) >= 0;
}

/** 기존 분석 스크립트의 파일 이름: '검토__' + (전사 이름에서 .txt 빼고 금지 글자 바꾼 앞 90자) + '__SRC_' + 전사 id + '.md'. */
function callFeedAnalysisName(transcriptName, transcriptId) {
  var base = String(transcriptName || '').replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90);
  return '검토__' + base + '__SRC_' + transcriptId + '.md';
}

function callFeedKstDay(ms) { return new Date(ms + CALL_FEED_KST_MS).toISOString().slice(0, 10); }

/** 녹음 날짜(한국 날짜)가 최근 CALL_FEED_RECENT_DAYS일보다 오래됐나. 날짜를 못 읽으면 오래된 것으로 보지 않는다. */
function callFeedTooOld(day, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return false;
  var today = callFeedKstDay(nowMs);
  var oldest = new Date(Date.parse(today + 'T00:00:00Z') - CALL_FEED_RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  return day < oldest;
}

/** 최근 일주일 구간이 시작되는 시각(밀리초): 한국 날짜로 오늘에서 CALL_FEED_RECENT_DAYS일 전 0시. callFeedTooOld와 같은 기준이다. */
function callFeedRecentStartMs(nowMs) {
  var oldest = new Date(Date.parse(callFeedKstDay(nowMs) + 'T00:00:00Z') - CALL_FEED_RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  return Date.parse(oldest + 'T00:00:00+09:00');
}

/** 서버가 받는 날짜 범위(오늘부터 92일 전까지)인가. */
function callFeedDayInRange(day, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return false;
  var today = callFeedKstDay(nowMs);
  var oldest = new Date(Date.parse(today + 'T00:00:00Z') - CALL_FEED_MAX_PAST_DAYS * 86400000).toISOString().slice(0, 10);
  return day <= today && day >= oldest;
}

function callFeedBytes(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** UTF-8 바이트 수가 max를 넘지 않게 글자 경계에서 자른다. */
function callFeedCapBytes(s, max) {
  if (callFeedBytes(s) <= max) return s;
  var out = '', used = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i), ch = s[i], n;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { ch = s[i] + s[i + 1]; n = 4; }
    else n = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    if (used + n > max) break;
    out += ch; used += n;
    if (ch.length === 2) i++;
  }
  return out;
}

/** 분석 파일 앞머리(--- 사이)의 key: value. 따옴표 한 겹을 벗긴다. */
function callFeedFrontmatter(md) {
  var lines = String(md || '').replace(/^﻿/, '').split(/\r?\n/);
  var meta = {};
  if (!lines.length || lines[0].trim() !== '---') return meta;
  for (var i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    var m = /^([A-Za-z_][A-Za-z0-9_]{0,40})\s*:\s*(.*)$/.exec(lines[i]);
    if (!m || meta.hasOwnProperty(m[1])) continue;
    var v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) v = v.slice(1, -1);
    meta[m[1]] = v;
  }
  return meta;
}

/**
 * 분석 파일의 구분: '업무' | '개인' | '애매' | '구분없음' | '실패'. 기준은 명진의 통화 분석 v3.2(2026-10-24 명진 결정), v3.5(개인·애매도 요약을 남김)이다.
 * - is_work_related: true → '업무'. false 또는 status: "개인"(개인 기록 파일) → '개인'.
 * - status: "애매" → '애매'(v3.3 이후, 요약이 파일에 있다. 서버가 개인 통화함에 '확인할 통화'로 저장한다).
 * - 그 밖에 칸이 없거나 비어 있음(옛 3.1 파일) → '구분없음'(요약·전문은 보내지 않고 서버가 개수로만 센다).
 * - 분석 스크립트가 남긴 "분석실패" 기록은 '실패'.
 */
function callFeedClass(md) {
  var meta = callFeedFrontmatter(md);
  var status = String(meta.status || '').replace(/\s/g, '');
  if (status === '분석실패') return '실패';
  var flag = String(meta.is_work_related || '').trim().toLowerCase();
  if (status === '개인' || flag === 'false') return '개인';
  if (status === '애매') return '애매';
  if (flag === 'true') return '업무';
  return '구분없음';
}

/**
 * 구분 없음(옛 3.1 파일 등)·분석 실패 통화에 보낼 앞머리: 서버가 개수를 세는 데 필요한 칸만(이름·요약·전사는 보내지 않는다).
 * forcedClass가 '개인'이면(개인 번호 목록 통화인데 분석에 요약이 없는 경우) 개인으로 센다.
 * 녹음 시각이 없으면 전사 파일 이름의 날짜·시각(fallbackDatetime)을 쓴다(서버가 그 날짜에 센다).
 * 분석 스크립트가 남긴 "분석실패" 기록은 버전 칸을 빼서 서버가 판정 실패로 세게 한다.
 */
var CALL_FEED_MIN_KEYS = ['analysis_version', 'source_txt_id', 'recording_datetime', 'is_work_related'];
function callFeedMinimalAnalysis(md, fallbackDatetime, forcedClass) {
  var meta = callFeedFrontmatter(md), lines = ['---'];
  if (!meta.recording_datetime && fallbackDatetime) meta.recording_datetime = fallbackDatetime;
  var cls = forcedClass || callFeedClass(md);
  if (cls === '개인') meta.is_work_related = 'false'; else delete meta.is_work_related;
  CALL_FEED_MIN_KEYS.forEach(function (k) {
    if (cls === '실패' && k === 'analysis_version') return;
    if (meta.hasOwnProperty(k)) lines.push(k + ': "' + String(meta[k]).replace(/["\\\r\n]/g, ' ') + '"');
  });
  lines.push('---');
  return lines.join('\n');
}

/**
 * 개인 번호 목록 통화의 분석 앞머리를 개인으로 고친다: status와 is_work_related 줄만 바꾸고(없으면 더함) 나머지는 그대로 둔다.
 * 서버는 같은 이름 칸의 첫 줄을 읽으므로 기존 줄을 지우고 새 줄을 더한다. 앞머리가 없는 글은 그대로 돌려준다.
 */
function callFeedForcePersonal(md) {
  var lines = String(md == null ? '' : md).replace(/^﻿/, '').split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') return String(md);
  var end = -1;
  for (var i = 1; i < lines.length; i++) { if (lines[i].trim() === '---') { end = i; break; } }
  if (end < 0) return String(md);
  var kept = [];
  for (var j = 1; j < end; j++) { if (!/^(status|is_work_related)\s*:/.test(lines[j])) kept.push(lines[j]); }
  kept.push('status: "개인"', 'is_work_related: false');
  return ['---'].concat(kept, ['---'], lines.slice(end + 1)).join('\n');
}

/** 글 안에 `화자0`(0번 화자)이 있나. 설계는 화자1부터라, 0이 있으면 0번부터 매긴 것으로 본다. */
function callFeedHasSpeakerZero(text) { return /화자\s?0(?!\d)/.test(String(text == null ? '' : text)); }

/** `화자N`(N은 한두 자리 숫자)의 번호를 모두 1씩 올린다: 화자0 → 화자1, 화자1 → 화자2. 번호 앞 공백은 그대로 둔다. */
function callFeedShiftSpeakers(text) {
  return String(text == null ? '' : text).replace(/화자(\s?)(\d{1,2})(?!\d)/g, function (m, sp, n) { return '화자' + sp + (Number(n) + 1); });
}

/**
 * 서버 POST ?action=call 몸통 {ref, analysis_md, transcript, drive_url}(handler.ts parseCallBody와 같은 칸만).
 * - 분석이 업무·개인·애매이면 분석 전체와 전사를 보낸다. 전사는 고치지 않고 그대로 보낸다
 *   (화자 구분은 전사 스크립트가 직접 `나:`/상대 표기로 쓰게 요청함 방에 요청한다. 서버가 줄 모양으로 알아본다).
 *   서버는 업무를 업무 통화함에, 개인·애매를 요약이 있을 때 개인 통화함에 저장한다(요약 없는 옛 개인 기록은 개수만).
 * - input.forcePersonal(개인 번호 목록 통화): 분석 구분과 상관없이 개인으로 고쳐 보낸다. 분석 실패 기록은 그대로 둔다.
 * - 구분 없음(옛 3.1)·분석 실패는 앞머리 몇 칸만 보내고 전사는 빈 글로 보낸다(서버는 개수만 센다).
 * - 분석 파일이 64 KB를 넘으면 null(보내지 않음). 합계 200 KB를 넘으면 전사를 자른다.
 */
function callFeedBuildCallBody(input) {
  var analysisMd = callFeedNfc(input.analysisMd);
  var rawTranscript = callFeedNfc(input.transcript);
  // 분석 쪽이 화자를 0번부터 매겨 보내는 경우(`화자0`, `화자1`…) 화면은 화자1부터 되도록 분석·전사의 번호를 함께 하나씩 올린다.
  if (callFeedHasSpeakerZero(analysisMd + '\n' + rawTranscript)) {
    analysisMd = callFeedShiftSpeakers(analysisMd);
    rawTranscript = callFeedShiftSpeakers(rawTranscript);
  }
  if (!analysisMd.trim() || callFeedBytes(analysisMd) > CALL_FEED_ANALYSIS_MAX_BYTES) return null;
  var body;
  var cls = callFeedClass(analysisMd);
  var forced = input.forcePersonal === true && cls !== '실패';
  if (forced) {
    cls = '개인';
    analysisMd = callFeedForcePersonal(analysisMd);
  }
  if (cls !== '업무' && cls !== '개인' && cls !== '애매') {
    body = { ref: String(input.ref), analysis_md: callFeedMinimalAnalysis(analysisMd, input.recordedAt, forced ? '개인' : ''), transcript: '' };
  } else {
    var transcript = callFeedCapBytes(rawTranscript.trim(), CALL_FEED_TOTAL_MAX_BYTES - callFeedBytes(analysisMd));
    body = { ref: String(input.ref), analysis_md: analysisMd, transcript: transcript };
  }
  var url = input.driveUrl;
  if (typeof url === 'string' && url.length <= 500 && /^https:\/\/(drive|docs)\.google\.com\/[^\s\u0000-\u001f\u007f]*$/.test(url)) body.drive_url = url;
  return body;
}

/**
 * 분석 파일 본문에 핵심요약 절이 있고 "없음"류가 아닌 줄이 하나라도 있나(서버 call-analysis.ts의 sections·bullets와 같은 기준의 간단판).
 * 서버는 요약 없는 개인 기록을 개인 통화함에 저장하지 않고 날짜별 개수만 올리므로, 다시 보내기는 요약이 있는 것만 보낸다.
 */
function callFeedHasSummary(md) {
  var lines = String(md == null ? '' : md).replace(/^﻿/, '').split(/\r?\n/), i = 0, inSummary = false;
  if (lines.length && lines[0].trim() === '---') { for (i = 1; i < lines.length; i++) { if (lines[i].trim() === '---') { i++; break; } } } else i = 0;
  for (; i < lines.length; i++) {
    var h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]) || /^\s*\*\*([^*]{1,40})\*\*\s*:?\s*$/.exec(lines[i]);
    if (h) { inSummary = callFeedNfc(h[1]).replace(/\*\*|__/g, '').replace(/^\s*\d+\s*[.)]\s*/, '').replace(/[\s·‧・\/:：()（）\[\]]/g, '').indexOf('핵심요약') === 0; continue; }
    if (!inSummary) continue;
    var t = lines[i].replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s*/, '').trim();
    if (t && !/^(없음|해당\s*없음|특이\s*사항\s*없음|n\/?a|-|—|확인\s*불가|확인\s*필요|미상|불명|(장기적으로\s*남길\s*)?핵심\s*요약\s*없음)\.?$/i.test(t)) return true;
  }
  return false;
}

/** 다시 보내기 대상인가: '개인' | '애매'(보냄) 또는 ''(보내지 않음). 개인 번호 목록 통화는 개인으로 본다. 업무·구분 없음·분석 실패·요약 없음은 보내지 않는다. */
function callFeedResendWanted(md, isList) {
  var cls = callFeedClass(md);
  if (cls === '실패' || !callFeedHasSummary(md)) return '';
  if (isList) return '개인';
  return cls === '개인' || cls === '애매' ? cls : '';
}

/** 서버 응답 코드 → 할 일. ok: 다음으로, auth: 멈추고 알림, limit: 다음 실행, drop: 넘김, retry: 다음 실행에 다시. */
/** 상태에서 읽은 대기 목록을 정리한다: {id, created, tries}만 남기고, 같은 id는 하나로, 만든 시각 순으로. */
function callFeedPendingClean(raw) {
  var seen = {}, out = [];
  (Array.isArray(raw) ? raw : []).forEach(function (e) {
    if (!e || typeof e.id !== 'string' || !e.id || seen[e.id]) return;
    var created = Number(e.created);
    if (!isFinite(created) || created <= 0) return;
    seen[e.id] = true;
    out.push({ id: e.id, created: created, tries: Math.max(0, Math.floor(Number(e.tries)) || 0) });
  });
  out.sort(function (a, b) { return a.created - b.created; });
  return out;
}

/** 대기 목록이 max건을 넘으면 가장 오래된 것부터 dropped(넘김)로 나눈다. */
function callFeedPendingTrim(list, max) {
  var clean = callFeedPendingClean(list);
  var over = Math.max(0, clean.length - max);
  return { keep: clean.slice(over), dropped: clean.slice(0, over) };
}

/** 대기 중인 통화 한 건의 다음 행동: 분석이 있으면 'send', 없고 기다릴 시간이 지났으면 'expire', 아니면 'wait'. */
function callFeedPendingDecision(entry, nowMs, hasAnalysis) {
  if (hasAnalysis) return 'send';
  return nowMs - entry.created >= CALL_FEED_WAIT_ANALYSIS_MS ? 'expire' : 'wait';
}

function callFeedVerdict(code) {
  if (code === 200) return 'ok';
  if (code === 401) return 'auth';
  if (code === 429) return 'limit';
  if (code === 400 || code === 413) return 'drop';
  return 'retry';
}

// ═══════════════════════════════════════════════════════════════════════
// 텔레그램 보내기 (TG-소식메뉴 3-나)
//
// 하는 일: 매시(한국 7~23시) 텔레그램 새 메시지를 방별·날짜별로 묶어 Web2 서버(collector-feed ?action=telegram)로 보낸다(TG-1시간수집, 10/28).
//   - 허용 목록(스크립트 속성 TG_FEED_ROOMS)에 적은 업무방 폴더만 읽는다. 목록에 없는 방(개인 수집 포함)은 열지 않는다.
//   - 오늘 날짜도 보낸다. 같은 메시지는 한 번만 보낸다(방별 보낸 가장 큰 메시지 번호 m). 하루가 끝난 날은 다음 날 첫 실행이 남은 것을 보내고 끝낸 날(doneDay)로 적는다.
//   - 한 번에 4.5분 안에서 멈추고, 남은 일은 10분 뒤 이어 하기 트리거가 이어서 한다(한 번 실행에 5번까지). 못 한 것은 다음 매시 실행이 이어 한다.
//   - 읽기(TG-소식멈춤 2단계): 방마다 못 보낸 날을 최대 3일씩 묶어 파일 목록을 Drive REST로 한 번 받고, 내용은 50개씩 UrlFetchApp.fetchAll로 병렬로 읽는다.
//     방 순서는 가장 오래된 못 보낸 날이 앞선 방부터(날짜 우선). 읽기 전에 파일 수로 시간을 가늠해 안 들어가면 읽지 않고 미룬 뒤 다음 실행에서 그 방을 맨 먼저 읽는다.
//     하루 URL 호출(목록+내용)은 상한(기본 15000, 스크립트 속성 TG_FEED_FETCH_BUDGET)을 넘기 전에 멈춘다. 날짜 판정은 메시지 안 날짜다.
//   - 어디까지 보냈는지는 스크립트 속성(TG_FEED_STATE)에만 적는다. Drive 파일(원문·검토후보·telegram_ai_review_state_v2)은 읽기만 하고 고치지 않는다(Q9).
//   - 시험 모드(기본 켬): 서버로 보내지 않고 방·날짜별 개수만 실행 로그에 적는다. 어디까지 보냈는지도 바꾸지 않는다.
//   - 보내는 이(sender_id)는 방·날짜마다 A, B, C 같은 임시 이름으로 바꿔 보낸다. 실제 값(번호)은 서버로 가지 않는다.
//   - 이름표(TG-발언자이름 3단계): 열쇠(스크립트 속성 TG_FEED_SENDER_KEY)가 있으면 라벨마다 {label, key(번호를 열쇠로 섞은 고정 해시), name, self}를 몸통의 senders로 함께 보낸다.
//     name·self는 수집기가 sender_name·sender_is_self 칸을 적었을 때만 있다. 열쇠가 없으면 senders를 보내지 않는다. 번호·이름·key는 로그에 남기지 않는다.
//   - 1시간마다(TG-1시간수집, 명진 10/28 결정): 트리거가 매시 tgFeed_run을 부른다. 한국 시각 0~7시(TG_FEED_QUIET_FROM~TG_FEED_QUIET_UNTIL)는 쉬고,
//     그 사이 쌓인 메시지는 7시 실행에서 한 번에 보낸다. 오늘(한국)도 보내되, 방마다 이미 보낸 가장 큰 메시지 번호(방 상태 m)보다 큰 새 메시지만 보낸다.
//     하루가 끝난 날은 다음 날 첫 실행이 남은 새 메시지를 보내고 그 날을 끝낸 날로 적는다(서버가 그 묶음에서 그날 요약을 모인 소식 전체로 다시 쓴다).
//     보낸 이 라벨(A, B …)은 매번 그날 전체 메시지로 정하므로 시간이 달라도 같은 사람은 같은 라벨이다(그래서 그날 파일은 매번 다시 읽는다).
// 통화 부분(callFeed…)과 같은 프로젝트·같은 비밀값(COLLECTOR_FEED_SECRET)을 쓴다. 이름은 모두 tgFeed로 시작한다.
// ═══════════════════════════════════════════════════════════════════════

// ── 여기 한 칸만 채운다 ───────────────────────────────────────────────
// 텔레그램 수집 폴더: Drive에서 `원문` 폴더가 들어 있는 수집 폴더를 열었을 때 주소창 /folders/ 뒤 글자.
var TG_FEED_ROOT_FOLDER = '여기에_텔레그램_수집_폴더_주소_끝부분';
// ─────────────────────────────────────────────────────────────────────

var TG_FEED_RAW_FOLDER = '원문';
var TG_FEED_MESSAGES_FOLDER = 'messages';
var TG_FEED_ROOMS_KEY = 'TG_FEED_ROOMS';        // 허용 업무방 목록(방 이름, 방 폴더 이름 전체, 또는 맨 앞 방 번호. 쉼표·줄바꿈으로 구분)
var TG_FEED_ROOMS_EXCLUDE_KEY = 'TG_FEED_ROOMS_EXCLUDE'; // TG_FEED_ROOMS가 `*`(모든 방)일 때 뺄 방 목록(방 이름·폴더 이름·방 번호, 쉼표·줄바꿈 구분)
var TG_FEED_TEST_KEY = 'TG_FEED_TEST_MODE';     // 없거나 '켬'이면 시험 모드. '끔'일 때만 실제로 보낸다
var TG_FEED_SENDER_KEY = 'TG_FEED_SENDER_KEY';  // 보낸 사람 번호를 해시로 바꿀 때 섞는 열쇠(tgFeed_initSenderKey가 만든다). 바꾸면 같은 사람이 새 사람으로 생기므로 한 번 정하면 바꾸지 않는다
var TG_FEED_SENDERS_MAX = 40;                   // 서버가 받는 senders 최대 인원(handler.ts SENDERS_MAX)
var TG_FEED_SENDER_NAME_CHARS = 40;             // 서버가 받는 이름 최대 글자
var TG_FEED_STATE_KEY = 'TG_FEED_STATE';        // 어디까지 보냈는지(JSON)
var TG_FEED_REWIND_KEY = 'TG_FEED_REWIND_DAY';  // tgFeed_rewind가 읽는 1회용 날짜(YYYY-MM-DD). 쓰고 나면 지운다
var TG_FEED_STATE_MAX_BYTES = 9000;             // 앱 스크립트 속성 한 칸 상한(약 9 KB). 방이 늘어 넘으면 저장이 실패해 진행이 멈춘다
var TG_FEED_TIME_LIMIT_MS = 4.5 * 60 * 1000;    // 앱 스크립트 6분 제한 전에 새 일을 시작하지 않는다
var TG_FEED_SEND_EXTRA_MS = 45 * 1000;         // 이미 읽은 방은 시간 한도 뒤에도 이만큼 더 보낸다(읽고 나서 보내지 못해 버리는 일을 줄임)
var TG_FEED_FIRST_EXTRA_MS = 30 * 1000;         // 첫 방은 읽기를 이만큼 더 길게 쓴다
var TG_FEED_CONTINUE_MS = 10 * 60 * 1000;       // 이어 하기 트리거 간격
var TG_FEED_MAX_CHAIN = 5;                      // 매시 실행 한 번에서 이어 하기를 부르는 최대 횟수(다음 매시 실행이 다시 0부터 센다)
var TG_FEED_QUIET_FROM = 0;                     // 한국 시각 이 시부터(포함)
var TG_FEED_QUIET_UNTIL = 7;                    // 이 시 전까지(제외) 쉰다. 쉬는 동안 온 메시지는 7시 실행에서 한 번에 보낸다
var TG_FEED_WINDOW_DAYS = 3;                    // 그 날 메시지 파일은 그 날 0시부터 3일 안에 고쳐진 것으로 본다(수집이 하루 늦어도 잡힘)
var TG_FEED_MAX_MESSAGES = 300;                 // 서버 한 묶음 상한(TG_LIMITS.messages)
var TG_FEED_MAX_CHARS = 4000;                   // 서버 메시지 글자 상한(TG_LIMITS.messageChars)
var TG_FEED_MAX_BODY_BYTES = 200 * 1024;        // 서버 몸통 상한 240 KB보다 작게 쪼갠다
var TG_FEED_MAX_TOTAL = 5000;                   // 서버가 받는 하루 메시지 수 상한
var TG_FEED_MAX_ATTEMPTS = 3;                   // 한 묶음을 다시 보내는 횟수(서버 attempt 1~3과 같다)
var TG_FEED_RECENT_DAYS = 7;                    // 처음 설치할 때(또는 예전 설치를 한 번 보충할 때) 오늘에서 이만큼 전 날짜부터 보낸다
var TG_FEED_DAYS_PER_VISIT = 3;                 // 한 방을 한 번 찾아가서 읽는 날 수 상한(여러 날을 한 번에 읽어 같은 파일을 날마다 다시 읽지 않는다). 다음 방은 가장 오래된 못 보낸 날이 앞선 순서
var TG_FEED_NARROW_DAYS = 2;                    // 첫 방이 한 번 실행 시간에 안 들어갈 때 하루씩 읽는 범위(그 날 0시부터 이 일수)
var TG_FEED_FETCH_BATCH = 50;                   // 파일 내용을 한 번에 병렬로 받는 개수(UrlFetchApp.fetchAll)
var TG_FEED_FETCH_ROUNDS = 3;                   // 일시 오류 파일을 다시 받는 횟수(처음 포함)
var TG_FEED_UNREAD_MAX_RATE = 0.02;             // 끝내 못 읽은 파일이 이 비율(최소 3개)을 넘으면 그 방은 이번에 건너뛰고 다음 실행에서 다시 읽는다
var TG_FEED_ASSUMED_RATE = 40;                  // 속도를 재기 전에 가정하는 초당 읽기 파일 수(보수적)
var TG_FEED_FETCH_BUDGET_KEY = 'TG_FEED_FETCH_BUDGET';   // 하루 URL 호출 상한을 바꿀 때 쓰는 스크립트 속성(숫자)
var TG_FEED_FETCH_BUDGET_DEFAULT = 15000;       // 개인 계정 하루 URL 호출 한도 20,000보다 낮게(다른 스크립트·묶음 보내기 몫을 남김). 업무용(Workspace) 계정이면 속성으로 올린다
var TG_FEED_DIRS_CACHE_KEY = 'TG_FEED_DIRS';    // 방·월 폴더 ID 기억(CacheService)
var TG_FEED_SENDERS_BACK_DAYS_KEY = 'TG_FEED_SENDERS_BACK_DAYS';     // 이름표 소급 보내기(tgFeed_backfillSenders)가 볼 지난 날 수(숫자, 기본 14)
var TG_FEED_SENDERS_BACK_DAYS_DEFAULT = 14;
var TG_FEED_SENDERS_BACK_STATE_KEY = 'TG_FEED_SENDERS_BACK_STATE';   // 소급 보내기 진행 위치(JSON). TG_FEED_STATE와 따로 둔다
var TG_FEED_SENDERS_BACK_BUDGET_KEY = 'TG_FEED_SENDERS_BACK_BUDGET'; // 소급 보내기 하루 URL 호출 상한(숫자). 매시 보내기 몫(TG_FEED_FETCH_BUDGET)과 따로 센다
var TG_FEED_SENDERS_BACK_BUDGET_DEFAULT = 4000;
var TG_FEED_MAX_PARTS_PER_RUN = 30;             // 한 번 실행에 보낼 묶음 수 상한(묶음마다 서버가 AI 요약을 부른다). 넘으면 10분 뒤 이어 하기로 나눈다

// ── 손으로 [실행]하는 함수 ───────────────────────────────────────────────

/**
 * 처음 한 번: 보낸 사람 번호를 해시로 바꿀 열쇠를 만들어 스크립트 속성 TG_FEED_SENDER_KEY에 넣는다.
 * 이미 있으면 덮어쓰지 않는다. 값은 로그에 찍지 않는다. 열쇠를 바꾸면 같은 사람이 새 사람으로 생기므로 한 번만 만든다.
 * 열쇠가 없으면 tgFeed_run은 senders(이름표)를 보내지 않고 지금처럼 소식만 보낸다.
 */
function tgFeed_initSenderKey() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(TG_FEED_SENDER_KEY)) { Logger.log('보낸 사람 열쇠가 이미 있습니다. 바꾸지 않았습니다.'); return; }
  props.setProperty(TG_FEED_SENDER_KEY, (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('보낸 사람 열쇠를 스크립트 속성에 넣었습니다(값은 로그에 남기지 않음). 이 값을 따로 안전하게 메모해 두세요.');
}

/**
 * 처음 한 번: 오늘(한국 날짜)에서 7일 전 날짜부터 보낸다고 적는다(하루가 끝난 날만). 그 전 날짜는 보내지 않는다.
 * 이미 적혀 있으면 바꾸지 않는다(이미 쓰던 설치는 아래 tgFeed_run이 시작 날짜 앞 일주일 구간을 한 번 따로 보충한다). 시험 모드도 켠 상태로 둔다.
 */
function tgFeed_setup() {
  var props = PropertiesService.getScriptProperties();
  var state = tgFeed_loadState_();
  if (state.startDay) {
    Logger.log('이미 시작 날짜가 있습니다: ' + state.startDay + ' (바꾸지 않았습니다)');
  } else {
    state.startDay = tgFeedAddDays(callFeedKstDay(Date.now()), -TG_FEED_RECENT_DAYS);
    state.backChecked = true;   // 처음 설치는 시작 날짜 자체가 일주일 전이라 따로 보충할 구간이 없다
    tgFeed_saveState_(state);
    Logger.log('시작 날짜를 적었습니다: ' + state.startDay + ' — 이 날짜부터(하루가 끝난 날만) 보냅니다.');
  }
  if (!props.getProperty(TG_FEED_TEST_KEY)) props.setProperty(TG_FEED_TEST_KEY, '켬');
  tgFeed_check();
}

/** 시험 모드에서만: 시작 날짜를 어제(한국)로 당긴 뒤 한 번 돌려 어제 하루치 메시지 개수를 바로 본다(보내지 않음). 시험 모드를 끄면 어제치도 함께 보낸다. */
function tgFeed_testLastDay() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(TG_FEED_TEST_KEY) === '끔') throw new Error('시험 모드가 꺼져 있어 시작 날짜를 당기지 않습니다. tgFeed_testModeOn을 먼저 실행하세요.');
  var state = tgFeed_loadState_();
  state.startDay = tgFeedAddDays(callFeedKstDay(Date.now()), -1);
  tgFeed_saveState_(state);
  Logger.log('시작 날짜를 어제로 당겼습니다: ' + state.startDay);
  tgFeed_run();
}

/** 설정 확인: 폴더·비밀값·허용 방이 제대로 들어갔는지 본다(값은 로그에 찍지 않는다). */
function tgFeed_check() {
  var props = PropertiesService.getScriptProperties();
  var nowDay = callFeedKstDay(Date.now());
  var secretLength = (props.getProperty(CALL_FEED_SECRET_KEY) || '').length;   // 길이만 본다
  var wanted = tgFeedParseRooms(props.getProperty(TG_FEED_ROOMS_KEY) || '');
  var found = tgFeed_rooms_(wanted);
  var state = tgFeed_loadState_();
  Logger.log([
    '원문 폴더: 찾음',
    '허용 방: 적은 것 ' + wanted.length + '개 중 ' + found.rooms.length + '개 찾음' + (found.missing.length ? ' — 못 찾은 것: ' + found.missing.join(' / ') : ''),
    '비밀값: ' + (secretLength >= 32 ? '있음' : '없음 또는 너무 짧음 — 안내 2단계'),
    '시험 모드: ' + (tgFeed_testMode_() ? '켬(보내지 않음)' : '끔(실제로 보냄)'),
    '시작 날짜: ' + (state.startDay || '없음 — tgFeed_setup을 먼저 실행'),
    '자동 실행 트리거: ' + feedTriggerSummary_(['tgFeed_run', 'tgFeed_continue'], '매시(tgFeed_run)가 없습니다 — tgFeed_installHourlyTrigger를 실행하세요'),
    tgFeedProgressText(tgFeedProgress(state, found.rooms.map(function (r) { return r.key; }), nowDay), nowDay),
    tgFeedRemainingText(tgFeedRemaining(state, found.rooms.map(function (r) { return r.key; }), nowDay)),
    '오늘 URL 호출: ' + (state.fetch.d === nowDay ? state.fetch.n : 0) + ' / ' + tgFeed_fetchBudget_() + ' (파일 읽기·목록, 한국 날짜 기준)',
    '마지막 실행: ' + tgFeedLastRunText(state.lastRun),
    feedReportCheckText_(state.stall),
    '진행 기록 크기: ' + JSON.stringify(tgFeedCompactState(state)).length + ' / ' + TG_FEED_STATE_MAX_BYTES + '바이트' + (JSON.stringify(tgFeedCompactState(state)).length > TG_FEED_STATE_MAX_BYTES * 0.8 ? ' — 한도에 가깝습니다(방이 더 늘면 저장이 실패해 멈춥니다)' : ''),
  ].join('\n'));
}

/**
 * 빠진 날 다시 보내기(1회용): 스크립트 속성 TG_FEED_REWIND_DAY에 날짜(예: 2026-10-25)를 적고 이 함수를 [실행]한다.
 * 방마다 "끝낸 날"을 그 날 하루 전으로 되돌린다(앞으로만 당기지 않고, 이미 더 앞이면 그대로). 최근 7일 안·어제까지만 받는다.
 * 같은 방·같은 날 묶음은 서버가 중복으로 알아보고 다시 저장하지 않는다(다만 서버 하루 상한에는 센다).
 * 주의(TG-1시간수집): 1시간마다 나눠 보낸 날은 되돌려 다시 보내면 묶음 모양이 달라져 같은 소식이 두 번 생길 수 있다. 정말 빠진 날에만 쓴다.
 * 되돌린 뒤 tgFeed_run을 [실행]하면 그 날부터 다시 보낸다. 날짜 속성은 쓰고 나면 지운다.
 */
function tgFeed_rewind() {
  var props = PropertiesService.getScriptProperties();
  var day = (props.getProperty(TG_FEED_REWIND_KEY) || '').trim();
  var state = tgFeed_loadState_();
  var res = tgFeedRewind(state, day, callFeedKstDay(Date.now()));
  if (res.error) throw new Error(res.error);
  tgFeed_saveState_(res.state);
  props.deleteProperty(TG_FEED_REWIND_KEY);
  Logger.log('끝낸 날을 ' + tgFeedAddDays(day, -1) + '로 되돌린 방: ' + res.changed + '개. 이제 tgFeed_run을 실행하면 ' + day + '부터 다시 보냅니다.' +
    (tgFeed_testMode_() ? ' (시험 모드가 켜져 있어 보내지는 않고 개수만 셉니다)' : ''));
}

/**
 * 이름표 소급 보내기(1회용, TG-발언자이름 설계 3.3절 방법 나): 지난 N일(스크립트 속성 TG_FEED_SENDERS_BACK_DAYS, 기본 14일, 오늘은 뺌)의
 * 방·날마다 Drive 메시지를 다시 읽어, 평소와 같은 규칙(그날 전체 순서로 A, B, C …)으로 이름표 {label, key, name, self}만 만들어
 * 서버 ?action=telegram_senders로 보낸다. 메시지·글은 보내지 않으므로 소식이 새로 생기지 않고 AI 비용도 들지 않는다(tgFeed_rewind와 다름).
 * - 시험 모드(TG_FEED_TEST_MODE)가 켜져 있으면 보내지 않고 건수만 센다. 진행 위치도 적지 않는다(시간이 모자라면 앞쪽 방만 센다).
 * - 6분 제한 전에 멈추고 진행 위치를 저장한다. 다시 [실행]하면 이어서 한다. 다 끝나면 "끝"이라고 적는다(처음부터 다시: tgFeed_backfillSendersReset).
 * - 매시 보내기(tgFeed_run)와 같은 잠금을 쓰므로 동시에 돌지 않는다. 진행 기록(TG_FEED_STATE)은 건드리지 않는다.
 * - 로그에는 건수만 적는다(방 이름·사람 이름·번호·key 없음).
 */
function tgFeed_backfillSenders() {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('다른 텔레그램 보내기가 돌고 있어 이번에는 건너뜁니다. 잠시 뒤 다시 실행하세요.'); return; }
  try {
    var props = PropertiesService.getScriptProperties();
    var test = tgFeed_testMode_();
    var secret = props.getProperty(CALL_FEED_SECRET_KEY) || '';
    if (!test && secret.length < 32) throw new Error('스크립트 속성에 ' + CALL_FEED_SECRET_KEY + '가 없습니다.');
    if (!props.getProperty(TG_FEED_SENDER_KEY)) throw new Error('보낸 사람 열쇠가 없습니다(tgFeed_initSenderKey로 만든 값). 이름표를 만들 수 없습니다.');
    var today = callFeedKstDay(Date.now());
    var bs = tgFeedSendersBackClean(test ? '' : props.getProperty(TG_FEED_SENDERS_BACK_STATE_KEY));
    if (bs.end) { Logger.log('이름표 소급 보내기는 이미 끝났습니다(' + bs.from + '~' + bs.to + '). 처음부터 다시 하려면 tgFeed_backfillSendersReset을 먼저 실행하세요.'); return; }
    if (!bs.from) {
      var range = tgFeedSendersBackRange(today, props.getProperty(TG_FEED_SENDERS_BACK_DAYS_KEY));
      bs.from = range.from; bs.to = range.to;
    }
    if (bs.fetch.d !== today) bs.fetch = { d: today, n: 0 };
    var wanted = tgFeedParseRooms(props.getProperty(TG_FEED_ROOMS_KEY) || '');
    if (!wanted.length) throw new Error('허용 방 목록(' + TG_FEED_ROOMS_KEY + ')이 비어 있습니다.');
    var found = tgFeed_rooms_(wanted);
    var budgetN = Number(props.getProperty(TG_FEED_SENDERS_BACK_BUDGET_KEY));
    var run = {
      state: { fetch: bs.fetch }, test: test, started: started, today: today,
      tally: { listed: 0, files: 0, unread: 0 },
      readLimit: started + TG_FEED_TIME_LIMIT_MS, budget: isFinite(budgetN) && budgetN >= 500 ? Math.floor(budgetN) : TG_FEED_SENDERS_BACK_BUDGET_DEFAULT,
      statFiles: 0, statMs: 0, token: '', dirs: null, dirsDirty: false,
    };
    var t = { roomDays: 0, people: 0, failed: 0, linked: 0, conflicts: 0 };
    var stop = '', visits = 0;
    var untilMs = Date.now();   // 수집기가 지난 파일에 이름 칸을 채우며 고친 시각이 바뀌었으므로, 고친 시각 범위는 첫 날 0시 ~ 지금으로 본다
    for (var i = 0; i < found.rooms.length && !stop; i++) {
      var room = found.rooms[i];
      var days = tgFeedSendersBackDays(bs, room.key);
      if (!days.length) continue;
      if (Date.now() - started > TG_FEED_TIME_LIMIT_MS) { stop = '시간 제한'; break; }
      var entry = { room: room, n: i + 1 };
      var rd = tgFeed_readDays_(run, entry, days, visits === 0, false, false, untilMs);
      if (rd.status === 'time' || rd.status === 'defer') { stop = '시간 제한(읽는 중)'; break; }
      if (rd.status === 'quota') { stop = 'URL 호출 하루 한도(' + rd.note + ') — 내일 다시 실행'; break; }
      visits++;
      if (rd.status === 'fail') {
        t.failed += days.length;
        Logger.log('읽지 못해 넘김: ' + (i + 1) + '번째 방 (' + rd.note + ')');
        if (!test) { bs.room = room.key; bs.day = bs.to; props.setProperty(TG_FEED_SENDERS_BACK_STATE_KEY, JSON.stringify(bs)); }
        continue;
      }
      var byDay = tgFeedByDay(rd.parsed);
      for (var d = 0; d < days.length && !stop; d++) {
        var grouped = tgFeedGroupDay(byDay[days[d]] || [], days[d]);
        var senders = tgFeedSendersBackList(tgFeed_buildSenders_(grouped.messages));
        if (senders.length) {
          if (test) { t.roomDays++; t.people += senders.length; }
          else {
            var res = tgFeed_postAction_('telegram_senders', tgFeedSendersBackBody(days[d], room.key, senders), secret);
            var v = tgFeedVerdict(res.code, res.json && res.json.error);
            if (v === 'auth') throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
            if (v === 'ok') {
              t.roomDays++; t.people += senders.length;
              t.linked += (res.json && res.json.linked) || 0; t.conflicts += (res.json && res.json.conflicts) || 0;
            } else if (v === 'drop') {
              t.failed++;
            } else {
              stop = v === 'limit' ? '서버 하루 상한 — 내일 다시 실행' : '서버·연결 실패(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ') — 잠시 뒤 다시 실행';
              break;
            }
          }
        }
        if (!test) { bs.room = room.key; bs.day = days[d]; props.setProperty(TG_FEED_SENDERS_BACK_STATE_KEY, JSON.stringify(bs)); }
      }
    }
    tgFeed_saveDirs_(run);
    if (!stop && !test) bs.end = true;
    if (!test) props.setProperty(TG_FEED_SENDERS_BACK_STATE_KEY, JSON.stringify(bs));
    Logger.log([
      (test ? '[시험 모드 — 보내지 않음] ' : '') + '이름표 소급 ' + bs.from + '~' + bs.to + ': 방·날 ' + t.roomDays + ', 보낸 사람 ' + t.people + ', 실패 ' + t.failed +
        (test ? '' : ' (새 연결 ' + t.linked + ' · 이미 다른 연결 ' + t.conflicts + ')'),
      '읽은 파일 ' + run.tally.files + '개 · 오늘 소급 URL 호출 ' + bs.fetch.n + ' / ' + run.budget + ' · 소요 ' + Math.round((Date.now() - started) / 1000) + '초',
      stop ? '멈춘 이유: ' + stop + (test ? '' : ' — 다시 실행하면 이어서 합니다') : (test ? '끝까지 셈. 시험 모드를 끄고 다시 실행하면 보냅니다' : '끝'),
    ].join('\n'));
  } finally {
    lock.releaseLock();
  }
}

/** 이름표 소급 보내기 진행 위치를 지운다(처음부터 다시 하고 싶을 때만). 이미 서버에 보낸 이름표는 그대로 남는다. */
function tgFeed_backfillSendersReset() {
  PropertiesService.getScriptProperties().deleteProperty(TG_FEED_SENDERS_BACK_STATE_KEY);
  Logger.log('이름표 소급 보내기 진행 위치를 지웠습니다. 다음 실행은 처음부터 합니다.');
}

/** 시험 모드 끄기: 다음 실행부터 실제로 보낸다. */
function tgFeed_testModeOff() {
  PropertiesService.getScriptProperties().setProperty(TG_FEED_TEST_KEY, '끔');
  Logger.log('텔레그램 시험 모드를 껐습니다. 다음 실행부터 Web2로 보냅니다.');
}

/** 시험 모드 다시 켜기: 보내기를 멈추고 개수만 센다. */
function tgFeed_testModeOn() {
  PropertiesService.getScriptProperties().setProperty(TG_FEED_TEST_KEY, '켬');
  Logger.log('텔레그램 시험 모드를 켰습니다. 보내지 않고 개수만 셉니다.');
}

/**
 * 처음 한 번(또는 매일 트리거에서 바꿀 때): 매시 tgFeed_run을 부르는 트리거를 만든다(있던 매일·매시·이어 하기 트리거는 지우고 하나만 둔다).
 * 한국 시각 0~7시 실행은 스크립트 안에서 바로 끝낸다(트리거는 그대로 매시).
 */
function tgFeed_installHourlyTrigger() {
  tgFeed_removeTrigger();
  ScriptApp.newTrigger('tgFeed_run').timeBased().everyHours(1).create();
  Logger.log('매시 트리거를 만들었습니다(앱 스크립트 특성상 매시 아무 분에 돕니다). 한국 시각 ' + TG_FEED_QUIET_FROM + '~' + TG_FEED_QUIET_UNTIL + '시는 쉬고 7시에 몰아서 보냅니다.');
}

/** 옛 이름(매일 08:10 트리거 설치). 이제 매시 트리거를 만든다. */
function tgFeed_installDailyTrigger() { tgFeed_installHourlyTrigger(); }

/** 멈추기·되돌리기: 이 스크립트의 텔레그램 보내기 트리거(매일·이어 하기)만 지운다. 통화·전사·분석 트리거는 건드리지 않는다. */
function tgFeed_removeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'tgFeed_run' || h === 'tgFeed_continue') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('지운 텔레그램 보내기 트리거: ' + removed + '개');
}

// ── 트리거가 부르는 함수 ───────────────────────────────────────────────

/** 매시 트리거. 이어 하기 횟수를 0으로 되돌리고 시작한다. 한국 시각 0~7시는 아무것도 하지 않는다(알림도 보내지 않음). */
function tgFeed_run() {
  if (tgFeedQuiet(Date.now())) { Logger.log('한국 시각 ' + TG_FEED_QUIET_FROM + '~' + TG_FEED_QUIET_UNTIL + '시는 쉽니다. 7시 실행에서 몰아서 보냅니다.'); return; }
  feedGuard_('tg', function () { return tgFeed_runCore_(false); });
}

/** 이어 하기 트리거(10분 뒤 한 번). 이어 하기 횟수를 1 올리고, 한도(5번)가 넘으면 멈춘다. 쉬는 시각이면 하지 않는다(7시 실행이 이어 받음). */
function tgFeed_continue() {
  if (tgFeedQuiet(Date.now())) { Logger.log('쉬는 시각이라 이어 하기를 건너뜁니다. 7시 실행이 이어서 합니다.'); return; }
  feedGuard_('tg', function () { return tgFeed_runCore_(true); });
}

function tgFeed_runCore_(isContinue) {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('다른 텔레그램 보내기가 돌고 있어 이번에는 건너뜁니다.'); return null; }
  try {
    // 이어 하기 트리거는 한 번 쓰면 지운다(쌓이지 않게).
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tgFeed_continue') ScriptApp.deleteTrigger(t); });
    var props = PropertiesService.getScriptProperties();
    var test = tgFeed_testMode_();
    var secret = props.getProperty(CALL_FEED_SECRET_KEY) || '';
    if (!test && secret.length < 32) throw new Error('스크립트 속성에 ' + CALL_FEED_SECRET_KEY + '가 없습니다. 안내 2단계를 먼저 하세요.');
    var state = tgFeed_loadState_();
    if (!state.startDay) throw new Error('시작 날짜가 없습니다. tgFeed_setup을 먼저 한 번 실행하세요.');
    state.chain = isContinue ? (state.chain || 0) + 1 : 0;
    if (isContinue && state.chain > TG_FEED_MAX_CHAIN) {
      if (!test) {
        state.lastRun = tgFeedLastRun(Date.now(), '이어 하기 한도(' + TG_FEED_MAX_CHAIN + '번) 도달', 0, 0);
        tgFeed_saveState_(state);
      }
      Logger.log('이어 하기 한도(' + TG_FEED_MAX_CHAIN + '번)를 넘어 여기서 멈춥니다. 다음 매시 실행에서 이어서 합니다.');
      return null;
    }
    var wanted = tgFeedParseRooms(props.getProperty(TG_FEED_ROOMS_KEY) || '');
    if (!wanted.length) throw new Error('허용 방 목록(' + TG_FEED_ROOMS_KEY + ')이 비어 있습니다. 안내 2단계를 먼저 하세요.');
    var found = tgFeed_rooms_(wanted);
    var today = callFeedKstDay(Date.now());
    // 보충 구간(한 번만): 예전 설치는 설치한 날부터만 보냈다. 시작 날짜 앞 7일 구간을 따로 한 번 보낸다(방마다 backDay로 이어 하기).
    // 시작 날짜 이후는 방의 doneDay가 이미 책임지므로 겹치지 않는다(같은 방·같은 날이 두 번 가지 않음).
    if (!state.backChecked) {
      state.backChecked = true;
      var backStart = tgFeedAddDays(today, -TG_FEED_RECENT_DAYS);
      state.backFrom = backStart < state.startDay ? backStart : '';
    }
    if (state.fetch.d !== today) state.fetch = { d: today, n: 0 };   // 하루 URL 호출 수는 한국 날짜마다 새로 센다
    var run = {
      state: state, test: test, secret: secret, started: started, today: today, stop: '', resumable: false,
      tally: { rooms: found.rooms.length, days: 0, parts: 0, messages: 0, noText: 0, kept: 0, duplicate: 0, skipped: 0, failed: 0, retry: 0, visits: 0, files: 0, listed: 0, unread: 0, readFail: 0, deferred: 0 },
      readLimit: started + TG_FEED_TIME_LIMIT_MS, sendLimit: started + TG_FEED_TIME_LIMIT_MS + TG_FEED_SEND_EXTRA_MS,
      kind: '', budget: tgFeed_fetchBudget_(), statFiles: 0, statMs: 0, token: '', dirs: null, dirsDirty: false,
    };
    // 방마다 보낼 날짜 계획. 읽는 순서는 "가장 오래된 못 보낸 날"이 앞선 방부터(날짜 우선) — 한 방이 오래 걸려도 다른 방이 굶지 않는다.
    var entries = found.rooms.map(function (room, i) {
      var rs = tgFeedRoomState(state, room.key);
      return { room: room, n: i + 1, rs: rs, plan: tgFeedPlanDays(rs, state, today, true), first: !!state.pri && state.pri === room.key, blocked: false };
    });

    while (!run.stop) {
      var e = tgFeedNextRoom(entries);
      if (!e) break;
      if (Date.now() - started > TG_FEED_TIME_LIMIT_MS) { run.stop = '시간 제한'; run.resumable = true; break; }
      if (!test && run.tally.parts >= TG_FEED_MAX_PARTS_PER_RUN) { run.stop = '한 번에 보낼 묶음 상한(' + TG_FEED_MAX_PARTS_PER_RUN + '개) 도달'; run.resumable = true; break; }
      var picks = e.plan.slice(0, TG_FEED_DAYS_PER_VISIT);
      var first = run.tally.visits === 0;
      var rd = tgFeed_readDays_(run, e, picks.map(function (p) { return p.day; }), first, true, false);
      if (rd.status === 'shrink') {   // 첫 방이 한 번 실행 시간에 안 들어가면 하루씩만 읽는다
        picks = picks.slice(0, 1);
        rd = tgFeed_readDays_(run, e, [picks[0].day], first, false, true);
      }
      if (rd.status === 'time') { run.stop = '시간 제한(읽는 중) — 이 방은 다음 실행에서 맨 먼저 읽음'; run.resumable = true; if (!state.pri) state.pri = e.room.key; break; }
      if (rd.status === 'quota') { run.stop = 'URL 호출 하루 한도(' + rd.note + ') — 다음 날 7시에 이어서 함'; run.kind = feedKindPick(run.kind, 'limit_day'); break; }
      if (rd.status === 'defer') { e.blocked = true; run.tally.deferred++; run.resumable = true; if (!state.pri) state.pri = e.room.key; continue; }
      if (rd.status === 'fail') { e.blocked = true; run.tally.readFail++; run.kind = feedKindPick(run.kind, 'bad'); run.resumable = true; Logger.log('읽지 못해 이번에는 건너뜀: ' + e.n + '번째 방 (' + rd.note + ')'); continue; }
      run.tally.visits++;
      if (state.pri === e.room.key) state.pri = '';
      var byDay = tgFeedByDay(rd.parsed);
      for (var d = 0; d < picks.length && !run.stop; d++) {
        tgFeed_sendDay_(run, e, picks[d].day, picks[d].back, tgFeedGroupDay(byDay[picks[d].day] || [], picks[d].day));
      }
      if (run.stop) break;
      e.plan = e.plan.slice(picks.length);
    }
    if (!run.stop && entries.some(function (x) { return x.blocked; })) {
      run.stop = '읽지 못했거나 시간이 모자라 미룬 방 ' + entries.filter(function (x) { return x.blocked; }).length + '개 — 다음 실행에서 이어 함';
    }
    tgFeed_saveDirs_(run);
    var tally = run.tally, stop = run.stop;
    var rep = feedStallNext(state.stall, { test: test, kind: run.kind, sent: tally.parts > 0 }, Date.now());
    if (!test) state.stall = { bad: rep.bad, sentAt: rep.sentAt, base: rep.base };

    if (!test) {
      if (run.resumable && state.chain < TG_FEED_MAX_CHAIN) {
        ScriptApp.newTrigger('tgFeed_continue').timeBased().after(TG_FEED_CONTINUE_MS).create();
        stop += ' (10분 뒤 이어 하기 예약)';
      }
      state.lastRun = tgFeedLastRun(Date.now(), stop, tally.parts, tally.kept, tally.skipped + tally.failed,
        { files: tally.files, secs: Math.round((Date.now() - started) / 1000), visits: tally.visits });
      tgFeed_saveState_(state);
    }
    Logger.log([
      (test ? '[시험 모드 — 보내지 않음] ' : '') + '방 ' + tally.rooms + '개 중 ' + tally.visits + '곳을 읽고, 날짜 ' + tally.days + '건 확인',
      '읽은 파일 ' + tally.files + '개 (목록 ' + tally.listed + ' · 못 읽고 넘김 ' + tally.unread + ') · 초당 약 ' + Math.round(tgFeed_rate_(run)) + '개 · 소요 ' + Math.round((Date.now() - started) / 1000) + '초 · 오늘 URL 호출 ' + state.fetch.n + ' / ' + run.budget,
      '메시지: 글 있는 것 ' + tally.messages + '개 · 글 없는 것(첨부만 있음) ' + tally.noText + '개',
      (test ? '보낼 묶음: ' : '보낸 묶음: ') + tally.parts + (test ? '' : ' (소식 ' + tally.kept + '개 저장 · 이미 있음 ' + tally.duplicate + ' · 넘김 ' + tally.skipped + ' · 3번 실패 ' + tally.failed + (tally.retry ? ' · 다시 보낼 것 ' + tally.retry : '') + ')'),
      found.missing.length ? '못 찾은 허용 방: ' + found.missing.join(' / ') : '허용 방 모두 찾음',
      stop ? '멈춘 이유: ' + stop : '끝까지 봄',
    ].join('\n'));
    return { source: 'telegram_send', lastAt: rep.lastAt, state: rep.state };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 한 방의 한 날짜를 서버로 보낸다(시험 모드면 개수만 센다). 멈춰야 하면 run.stop을 채운다.
 * 묶음마다 상태를 저장해 중간에 멈춰도 같은 묶음을 두 번 보내지 않는다.
 */
function tgFeed_sendDay_(run, e, day, isBack, grouped) {
  var state = run.state, tally = run.tally, room = e.room, test = run.test, started = run.started, secret = run.secret;
  tally.days++;
  // 라벨(A, B …)은 그날 전체로 정하고(시간마다 같은 사람 = 같은 라벨), 보내는 것은 이미 보낸 번호(e.rs.lastId)보다 큰 새 메시지만(보충 구간은 전부).
  var fresh = tgFeedFresh(grouped, isBack ? '' : e.rs.lastId);
  var open = !isBack && day >= run.today;   // 아직 끝나지 않은 오늘: 보내도 끝낸 날로 적지 않는다
  var cont = !isBack && !!e.rs.lastId && e.rs.lastDay === day;   // 이 방·날을 앞서 보낸 적이 있음(서버가 방 수를 다시 세지 않음)
  tally.messages += fresh.messages.length;
  tally.noText += fresh.total - fresh.messages.length;
  var parts = tgFeedSplit(fresh.messages);
  var senders = test ? [] : tgFeedSendersFor(tgFeed_buildSenders_(grouped.messages), fresh.messages);   // 시험 모드는 보내지 않으므로 해시도 만들지 않는다
  if (test) { tally.parts += parts.length; Logger.log('[시험] ' + e.n + '번째 방 ' + day + (open ? '(오늘)' : '') + ': 새 메시지 ' + fresh.total + '개 중 글 있는 ' + fresh.messages.length + '개, 묶음 ' + parts.length + '개'); return; }
  var save = function (rs) { e.rs = rs; state.rooms[room.key] = rs; tgFeed_saveState_(state); };
  var after = function (p, count) { return tgFeedAfterSend(e.rs, day, isBack, open, p < count ? tgFeedMaxId(parts[p]) : fresh.maxId, p + 1 >= count ? fresh.maxId : ''); };
  for (var p = 0; p < parts.length; p++) {
    if (Date.now() > run.sendLimit) { run.stop = '시간 제한'; run.resumable = true; return; }
    if (tally.parts >= TG_FEED_MAX_PARTS_PER_RUN) { run.stop = '한 번에 보낼 묶음 상한(' + TG_FEED_MAX_PARTS_PER_RUN + '개) 도달'; run.resumable = true; return; }
    var akey = room.key + '|' + day + '|' + (p + 1);
    var attempt = (state.attempts[akey] || 0) + 1;
    var body = tgFeedBuildBody({ day: day, roomKey: room.key, roomLabel: room.label, total: p === 0 ? fresh.total : parts[p].length, part: p + 1, attempt: attempt, messages: parts[p], senders: senders, cont: cont || p > 0 });
    var res = tgFeed_post_(body, secret);
    var verdict = tgFeedVerdict(res.code, res.json && res.json.error);
    if (verdict === 'ok') {
      var out = res.json || {};
      if (out.duplicate) tally.duplicate++;
      tally.kept += out.kept || 0;
      tally.parts++;
      delete state.attempts[akey];
      save(after(p, parts.length));
    } else if (verdict === 'auth') {
      tgFeed_saveState_(state);
      throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
    } else if (verdict === 'limit') {
      run.stop = tgFeedLimitReason(res.json && res.json.error); run.kind = feedKindPick(run.kind, feedLimitKind(res.json && res.json.error)); return;
    } else if (verdict === 'pause') {
      run.stop = '서버 준비 안 됨(HTTP ' + res.code + ' ' + (res.json && res.json.error || '') + ') — 다음 매시 실행에서 다시 시도'; run.kind = feedKindPick(run.kind, 'broken'); return;
    } else if (verdict === 'drop') {
      tally.skipped++;
      Logger.log('서버가 거절해 넘김: ' + e.n + '번째 방 ' + day + ' 묶음 ' + (p + 1) + ' (HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
      delete state.attempts[akey];
      save(after(p, parts.length));
    } else {
      state.attempts[akey] = attempt;
      if (attempt >= TG_FEED_MAX_ATTEMPTS) {
        Logger.log(TG_FEED_MAX_ATTEMPTS + '번 실패해 넘김: ' + e.n + '번째 방 ' + day + ' 묶음 ' + (p + 1) + ' (HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
        tally.failed++;
        delete state.attempts[akey];
        save(after(p, parts.length));
      } else {
        tally.retry++;
        tgFeed_saveState_(state);
        run.kind = feedKindPick(run.kind, 'bad');
        run.stop = '서버·연결 실패(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ') — 10분 뒤 같은 묶음을 다시 보냄'; run.resumable = true; return;
      }
    }
  }
  if (!parts.length && !fresh.total) {   // 새 메시지가 없으면 보낼 것이 없다. 끝난 날이면 끝낸 날로만 적는다(오늘이면 그대로)
    if (!open) save(after(0, 1));
  } else if (!parts.length) {   // 새 메시지 중 글 있는 것이 없으면(첨부만 등) 개수만 서버에 알린다(서버는 AI를 부르지 않고 개수만 센다)
    var emptyRes = tgFeed_post_(tgFeedBuildBody({ day: day, roomKey: room.key, roomLabel: room.label, total: fresh.total, part: 1, attempt: 1, messages: [], cont: cont }), secret);
    var ev = tgFeedVerdict(emptyRes.code, emptyRes.json && emptyRes.json.error);
    if (ev === 'ok' || ev === 'drop') save(after(0, 1));
    else if (ev === 'auth') throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
    else if (ev === 'limit') { run.stop = tgFeedLimitReason(emptyRes.json && emptyRes.json.error); run.kind = feedKindPick(run.kind, feedLimitKind(emptyRes.json && emptyRes.json.error)); }
    else { run.kind = feedKindPick(run.kind, ev === 'pause' ? 'broken' : 'bad'); run.stop = '서버 응답 이상(HTTP ' + emptyRes.code + ') — 다음 실행에서 다시 시도'; run.resumable = emptyRes.code === 0 || emptyRes.code >= 500; }
  }
}

// ── Apps Script 도우미 (고칠 필요 없음) ─────────────────────────────────

function tgFeed_testMode_() {
  return PropertiesService.getScriptProperties().getProperty(TG_FEED_TEST_KEY) !== '끔';
}

function tgFeed_loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TG_FEED_STATE_KEY);
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  return {
    startDay: /^\d{4}-\d{2}-\d{2}$/.test(s.startDay || '') ? s.startDay : '',
    backChecked: s.backChecked === true,
    backFrom: /^\d{4}-\d{2}-\d{2}$/.test(s.backFrom || '') ? s.backFrom : '',
    rooms: s.rooms && typeof s.rooms === 'object' ? s.rooms : {},
    attempts: s.attempts && typeof s.attempts === 'object' ? s.attempts : {},
    chain: typeof s.chain === 'number' ? s.chain : 0,
    lastRun: tgFeedLastRunClean(s.lastRun),
    fetch: s.fetch && /^\d{4}-\d{2}-\d{2}$/.test(s.fetch.d || '') && typeof s.fetch.n === 'number' && s.fetch.n >= 0 ? { d: s.fetch.d, n: Math.floor(s.fetch.n) } : { d: '', n: 0 },
    pri: typeof s.pri === 'string' && /^-?\d{1,30}$/.test(s.pri) ? s.pri : '',
    stall: feedStallClean(s.stall),
  };
}

function tgFeed_saveState_(state) {
  var text = JSON.stringify(tgFeedCompactState(state));
  if (text.length > TG_FEED_STATE_MAX_BYTES) throw new Error('진행 기록이 ' + text.length + '바이트로 한도(' + TG_FEED_STATE_MAX_BYTES + ')를 넘었습니다. 방 수를 줄이거나 개발에 알려 주세요.');
  PropertiesService.getScriptProperties().setProperty(TG_FEED_STATE_KEY, text);
}

/** 수집 폴더의 `원문` 아래에서 허용 목록에 있는 방 폴더만 찾는다. 목록에 없는 폴더는 이름만 보고 열지 않는다. */
function tgFeed_rooms_(wanted) {
  if (!TG_FEED_ROOT_FOLDER || TG_FEED_ROOT_FOLDER.indexOf('여기에_') === 0) throw new Error('코드 맨 위 텔레그램 수집 폴더 칸을 채우세요.');
  var root = DriveApp.getFolderById(TG_FEED_ROOT_FOLDER);
  var raw = callFeed_onlyChild_(root, TG_FEED_RAW_FOLDER);
  if (!raw) throw new Error('수집 폴더 안에 "' + TG_FEED_RAW_FOLDER + '" 폴더가 없습니다. 폴더 칸을 확인하세요.');
  var exclude = tgFeedParseRooms(PropertiesService.getScriptProperties().getProperty(TG_FEED_ROOMS_EXCLUDE_KEY) || '');
  var rooms = [], matched = {};
  var it = raw.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();
    var hit = tgFeedRoomPick(name, wanted, exclude);
    if (!hit) continue;
    var info = tgFeedRoomInfo(name);
    if (!info) { Logger.log('방 폴더 이름에서 방 번호를 읽지 못해 건너뜀: 허용 목록 ' + hit); continue; }
    matched[hit] = true;
    rooms.push({ key: info.key, label: info.label, folder: f });
  }
  rooms.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  var missing = wanted.filter(function (w) { return w !== '*' && !matched[w]; });
  if (wanted.indexOf('*') >= 0) Logger.log('모든 방 모드: ' + rooms.length + '개 방 (뺀 방 목록 ' + exclude.length + '개)');
  return { rooms: rooms, missing: missing };
}

/** 하루 URL 호출 상한(스크립트 속성 TG_FEED_FETCH_BUDGET, 없으면 기본). 목록 쪽과 파일 읽기를 모두 센다. */
function tgFeed_fetchBudget_() {
  var n = Number(PropertiesService.getScriptProperties().getProperty(TG_FEED_FETCH_BUDGET_KEY));
  return isFinite(n) && n >= 1000 ? Math.floor(n) : TG_FEED_FETCH_BUDGET_DEFAULT;
}

/** 이번 실행에서 잰 읽기 속도(초당 파일 수). 50개 넘게 읽기 전에는 가정값. */
function tgFeed_rate_(run) {
  return run.statFiles >= 50 && run.statMs >= 1000 ? run.statFiles / (run.statMs / 1000) : TG_FEED_ASSUMED_RATE;
}

function tgFeed_token_(run) {
  if (!run.token) run.token = ScriptApp.getOAuthToken();
  return run.token;
}

/** 방·월 폴더 ID 기억(CacheService 6시간). 폴더를 매번 이름으로 찾는 호출을 줄인다. */
function tgFeed_loadDirs_(run) {
  if (run.dirs) return run.dirs;
  run.dirs = {};
  try {
    var raw = CacheService.getScriptCache().get(TG_FEED_DIRS_CACHE_KEY);
    var obj = raw ? JSON.parse(raw) : {};
    if (obj && typeof obj === 'object') run.dirs = obj;
  } catch (e) { run.dirs = {}; }
  return run.dirs;
}
function tgFeed_saveDirs_(run) {
  if (!run.dirsDirty || !run.dirs) return;
  try { CacheService.getScriptCache().put(TG_FEED_DIRS_CACHE_KEY, JSON.stringify(run.dirs), 21600); } catch (e) { /* 기억은 속도용일 뿐이라 실패해도 계속한다 */ }
}

/** 그 방의 messages 폴더 ID와, 읽을 날짜들의 월 폴더 ID 목록. messages 폴더가 없으면 빈 목록. */
function tgFeed_dirIds_(run, room, days) {
  var dirs = tgFeed_loadDirs_(run);
  var c = dirs[room.key] || (dirs[room.key] = {});
  var msgFolder = null;
  var getMsg = function () {
    if (msgFolder) return msgFolder;
    if (c.m) { try { msgFolder = DriveApp.getFolderById(c.m); return msgFolder; } catch (e) { delete c.m; } }
    msgFolder = callFeed_onlyChild_(room.folder, TG_FEED_MESSAGES_FOLDER);
    if (msgFolder) { c.m = msgFolder.getId(); run.dirsDirty = true; }
    return msgFolder;
  };
  var ids = [];
  if (!c.m && !getMsg()) return ids;
  tgFeedMonthsOf(days).forEach(function (month) {
    if (!c[month]) {
      var mf = getMsg();
      var f = mf ? callFeed_onlyChild_(mf, month) : null;
      if (f) { c[month] = f.getId(); run.dirsDirty = true; }
    }
    if (c[month]) ids.push(c[month]);
  });
  return ids;
}

/** 폴더 안에서 고친 시각이 (fromMs, toMs) 사이인 json 파일 목록(Drive REST). 실패하면 error에 이유(이름·번호·내용 없음). */
function tgFeed_listFiles_(run, folderId, fromMs, toMs) {
  var out = { files: [], error: '' };
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) { out.error = '폴더 ID 형식'; return out; }
  var q = "'" + folderId + "' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'" +
    " and modifiedTime > '" + new Date(fromMs).toISOString() + "' and modifiedTime < '" + new Date(toMs).toISOString() + "'";
  var pageToken = '';
  for (var page = 0; page < 100; page++) {
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('nextPageToken,files(id,name)') +
      '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var body = null, lastCode = 0;
    for (var attempt = 0; attempt < 3 && body === null; attempt++) {
      if (attempt) Utilities.sleep(800 * attempt);
      try {
        var resp = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + tgFeed_token_(run) }, muteHttpExceptions: true });
        run.state.fetch.n++;
        lastCode = resp.getResponseCode();
        if (lastCode === 200) { try { body = JSON.parse(resp.getContentText()); } catch (pe) { body = null; } }
        else if (lastCode === 400 || lastCode === 404) break;
      } catch (e) {
        if (tgFeedIsQuotaError(e)) { out.error = 'quota'; return out; }
      }
    }
    if (body === null) { out.error = 'HTTP ' + lastCode; return out; }
    (body.files || []).forEach(function (f) { if (f && typeof f.id === 'string' && /\.json$/i.test(String(f.name || ''))) out.files.push(f.id); });
    pageToken = body.nextPageToken || '';
    if (!pageToken) return out;
  }
  out.error = '목록이 너무 김';
  return out;
}

/**
 * 파일 내용을 묶어서(fetchAll, 한 번에 TG_FEED_FETCH_BATCH개) 병렬로 받아 한 개씩 onText에 넘긴다.
 * 일시 오류(403·429·5xx·연결)는 TG_FEED_FETCH_ROUNDS번까지 다시 받고, 그래도 안 되면 unread로 센다. 404(그 사이 지워짐)는 gone으로 센다.
 * 반환 status: ok / time(시간 한도) / quota(하루 URL 호출 한도).
 */
function tgFeed_fetchFiles_(run, ids, onText) {   // 읽기 끝나는 때는 run.readLimit
  var res = { status: 'ok', unread: 0, gone: 0 };
  var pending = ids.slice();
  for (var round = 0; round < TG_FEED_FETCH_ROUNDS && pending.length; round++) {
    if (round > 0) Utilities.sleep(1000 * round);
    var retry = [];
    for (var i = 0; i < pending.length; i += TG_FEED_FETCH_BATCH) {
      if (Date.now() > run.readLimit) { res.status = 'time'; return res; }
      var batch = pending.slice(i, i + TG_FEED_FETCH_BATCH);
      var reqs = batch.map(function (id) {
        return { url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', method: 'get', headers: { Authorization: 'Bearer ' + tgFeed_token_(run) }, muteHttpExceptions: true };
      });
      var t0 = Date.now(), resps = null;
      try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) {
        if (tgFeedIsQuotaError(e)) { res.status = 'quota'; return res; }
        resps = null;
      }
      run.state.fetch.n += reqs.length;
      if (!resps) { retry = retry.concat(batch); continue; }
      run.statFiles += batch.length; run.statMs += Date.now() - t0;
      for (var j = 0; j < batch.length; j++) {
        var code = resps[j].getResponseCode();
        if (code === 200) onText(resps[j].getContentText());
        else if (code === 404) res.gone++;
        else retry.push(batch[j]);
      }
    }
    pending = retry;
  }
  res.unread = pending.length;
  return res;
}

/**
 * 한 방의 날짜들(days, 오름차순 연속)의 메시지 파일을 한 번에 읽는다. 파일은 첫 날 0시 ~ 마지막 날 0시+3일 사이에 고쳐진 것을 한 번만 받고,
 * 메시지 안 날짜가 days에 드는 것만 남긴다(날짜 판정은 메시지 안 값). 반환 status:
 *   ok(parsed) / shrink(첫 방이 한 번 실행에 안 들어감 — 하루씩 다시) / defer(시간이 모자라 이 방은 미룸) / fail(목록·읽기 실패)
 *   time(읽다가 시간 한도) / quota(하루 URL 호출 한도).
 * 읽기 전에 목록으로 파일 수를 알아 시간·하루 호출 수가 모자라면 읽지 않고 미룬다(읽다가 버리는 일을 막는다).
 */
function tgFeed_readDays_(run, entry, days, firstVisit, allowShrink, narrow, untilMs) {
  var out = { parsed: [], status: 'ok', note: '' };
  var ids = [];
  try {
    var dirIds = tgFeed_dirIds_(run, entry.room, days);
    if (!dirIds.length) return out;   // messages·월 폴더가 없으면 그 날들은 파일 없음
    var win = tgFeedWindowRange(days);
    if (narrow) win.toMs = win.fromMs + TG_FEED_NARROW_DAYS * 86400000;   // 첫 방이 한 번 실행에 안 들어갈 때만: 그 날 0시부터 2일까지만 본다
    if (untilMs) win.toMs = untilMs;   // 이름표 소급 보내기만: 고친 시각 범위 끝을 지금으로(지난 파일이 최근에 다시 고쳐졌기 때문)
    for (var i = 0; i < dirIds.length; i++) {
      var lst = tgFeed_listFiles_(run, dirIds[i], win.fromMs, win.toMs);
      if (lst.error === 'quota') { out.status = 'quota'; out.note = '목록'; return out; }
      if (lst.error) { out.status = 'fail'; out.note = '목록 ' + lst.error; return out; }
      ids = ids.concat(lst.files);
    }
  } catch (e) {
    if (tgFeedIsQuotaError(e)) { out.status = 'quota'; out.note = '폴더'; return out; }
    out.status = 'fail'; out.note = '폴더 찾기 오류'; return out;
  }
  run.tally.listed += ids.length;
  var used = run.state.fetch.n;
  if (used > 0 && used + ids.length > run.budget) { out.status = 'quota'; out.note = '오늘 ' + used + ' / ' + run.budget; return out; }
  run.readLimit = run.started + TG_FEED_TIME_LIMIT_MS + (firstVisit ? TG_FEED_FIRST_EXTRA_MS : 0);   // 이번 방 읽기가 끝나야 하는 때
  var remainMs = run.readLimit - Date.now();
  if (ids.length / tgFeed_rate_(run) * 1000 > remainMs) {
    if (firstVisit && allowShrink && days.length > 1) { out.status = 'shrink'; return out; }
    if (!firstVisit) { out.status = 'defer'; return out; }
  }
  var want = {};
  days.forEach(function (d) { want[d] = true; });
  var fetched = tgFeed_fetchFiles_(run, ids, function (text) {
    var p = null;
    try { p = tgFeedParseMessage(JSON.parse(String(text).replace(/^﻿/, ''))); } catch (pe) { p = null; }
    if (p && want[p.day]) out.parsed.push(p);
  });
  run.tally.files += ids.length - fetched.unread - fetched.gone;
  run.tally.unread += fetched.unread;
  if (fetched.status !== 'ok') { out.status = fetched.status; out.note = '오늘 ' + run.state.fetch.n + ' / ' + run.budget; return out; }
  if (fetched.unread > Math.max(3, Math.floor(ids.length * TG_FEED_UNREAD_MAX_RATE))) { out.status = 'fail'; out.note = '파일 ' + fetched.unread + '개 못 읽음'; return out; }
  return out;
}

/** 열쇠가 있을 때만 라벨별 이름표 목록을 만든다(없으면 빈 목록 = senders를 보내지 않음). 번호·이름·key는 로그에 남기지 않는다. */
function tgFeed_buildSenders_(messages) {
  var secret = PropertiesService.getScriptProperties().getProperty(TG_FEED_SENDER_KEY) || '';
  if (!secret) return [];
  return tgFeedBuildSenders(messages, function (number) {
    return tgFeedHmacHex(Utilities.computeHmacSha256Signature(number, secret));
  });
}

function tgFeed_post_(body, secret) { return tgFeed_postAction_('telegram', body, secret); }

function tgFeed_postAction_(action, body, secret) {
  var headers = {};
  headers[CALL_FEED_SECRET_HEADER] = secret;
  try {
    var res = UrlFetchApp.fetch(CALL_FEED_URL + '?action=' + action, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    var json = null;
    try { json = JSON.parse(res.getContentText()); } catch (e) { json = null; }
    return { code: res.getResponseCode(), json: json };
  } catch (e) {
    return { code: 0, json: null };   // 연결 실패
  }
}

// ── 순수 함수 (네트워크·Drive 없음, tests/security/collector-feed-tg-gas.test.mjs가 시험) ──────────

function tgFeedAddDays(day, n) {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** 허용 방 목록 글 → 이름 배열. 쉼표·세미콜론·줄바꿈으로 구분, NFC, 빈칸 정리, 중복 제거. */
function tgFeedParseRooms(text) {
  var out = [];
  callFeedNfc(text).split(/[,;\n\r]+/).forEach(function (item) {
    var s = callFeedNormalizeName(item);
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

/** 방 폴더 이름이 허용 목록에 있나. 목록의 한 줄이 폴더 이름 전체, 맨 앞 방 번호, 또는 번호 뒤 방 이름 전체와 같으면 맞다. 맞은 목록 글을 돌려주고 아니면 ''. */
function tgFeedRoomMatch(folderName, wanted) {
  var name = callFeedNormalizeName(folderName);
  var idm = /^(-?\d+)_(.*)$/.exec(name);
  for (var i = 0; i < wanted.length; i++) {
    if (wanted[i] === name) return wanted[i];
    if (idm && wanted[i] === idm[1]) return wanted[i];
    if (idm && idm[2] && wanted[i] === callFeedNormalizeName(idm[2])) return wanted[i];
  }
  return '';
}

/** 방 하나를 보낼지 정한다. 뺄 목록에 맞으면 ''. 허용 목록에 `*`가 있으면 '*', 아니면 허용 목록 대조 결과. */
function tgFeedRoomPick(folderName, wanted, exclude) {
  if (exclude && exclude.length && tgFeedRoomMatch(folderName, exclude)) return '';
  if (wanted.indexOf('*') >= 0) return '*';
  return tgFeedRoomMatch(folderName, wanted);
}

/** 방 폴더 이름 `<방 번호>_<표시 이름>` → 서버 room_key(방 번호)와 room_label(표시 이름, 100자까지). 번호를 못 읽으면 null. */
function tgFeedRoomInfo(folderName) {
  var m = /^(-?\d{1,30})_(.*)$/.exec(callFeedNormalizeName(folderName));
  if (!m) return null;
  var label = m[2].replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!label) label = '대화방 ' + m[1];
  return { key: m[1], label: Array.from(label).slice(0, 100).join('') };
}

/** 시각 글 → 밀리초. 시간대가 없으면 defaultOffset('Z' 또는 '+09:00')으로 본다. 못 읽으면 NaN. */
function tgFeedParseTime(value, defaultOffset) {
  var s = String(value == null ? '' : value).trim();
  var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return NaN;
  var off = m[5] || defaultOffset;
  if (/^[+-]\d{4}$/.test(off)) off = off.slice(0, 3) + ':' + off.slice(3);
  var frac = m[4] ? m[4].slice(0, 4) : '';
  return Date.parse(m[1] + 'T' + m[2] + (m[3] || ':00') + frac + off);
}

/**
 * 메시지 파일 하나(JSON 객체)를 보낼 모양으로 바꾼다.
 * 반환: null(읽을 수 없음) 또는 {id, day, at(ISO), text, hasText, service, senderId, senderName(없으면 ''), senderSelf(true/false/null), replyTo, forwarded}.
 * - 날짜는 date_utc(없으면 date_kst, 시간대 없으면 한국 시간)로 시각을 만들고, 날짜는 그 시각의 한국 날짜.
 * - service_action이 있으면 service:true(보내지 않고, 개수에도 더하지 않는다).
 * - 글이 없거나(첨부만) 빈칸뿐이면 hasText:false(보내지 않고 개수에만 더한다).
 */
function tgFeedParseMessage(obj) {
  if (!obj || typeof obj !== 'object') return null;
  var id = obj.message_id;
  if (typeof id === 'number' && isFinite(id)) id = String(id);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(id)) return null;
  var ms = tgFeedParseTime(obj.date_utc, 'Z');
  if (!isFinite(ms)) ms = tgFeedParseTime(obj.date_kst, '+09:00');
  if (!isFinite(ms)) return null;
  var service = !!obj.service_action;
  var text = typeof obj.text === 'string' ? callFeedNfc(obj.text).replace(/\u0000/g, '').trim() : '';
  var replyTo = obj.reply_to_message_id;
  if (typeof replyTo === 'number' && isFinite(replyTo)) replyTo = String(replyTo);
  if (typeof replyTo !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(replyTo)) replyTo = null;
  var sender = obj.sender_id == null ? '' : String(obj.sender_id);
  var senderName = tgFeedCleanName(obj.sender_name);
  var senderSelf = obj.sender_is_self === true ? true : (obj.sender_is_self === false ? false : null);
  return {
    id: id, day: callFeedKstDay(ms), at: new Date(ms).toISOString(),
    text: Array.from(text).slice(0, TG_FEED_MAX_CHARS).join(''), hasText: !service && text.length > 0, service: service,
    senderId: sender, senderName: senderName, senderSelf: senderSelf, replyTo: replyTo, forwarded: !!obj.forwarded,
  };
}

/**
 * 한 날짜(day)의 메시지만 모은다. 같은 message_id는 처음 것 하나만 쓴다(수정본은 처음 보낸 것 유지).
 * 반환: {total(시스템 메시지 뺀 그 날 전체 수, 5000까지), messages(글 있는 것, 시각·id 순)}.
 */
function tgFeedGroupDay(parsedList, day) {
  var seen = {}, all = [];
  (parsedList || []).forEach(function (p) {
    if (!p || p.day !== day || p.service || seen.hasOwnProperty(p.id)) return;
    seen[p.id] = true;
    all.push(p);
  });
  var msgs = all.filter(function (p) { return p.hasText; });
  msgs.sort(function (a, b) {
    var d = Date.parse(a.at) - Date.parse(b.at);
    return d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return { total: Math.min(all.length, TG_FEED_MAX_TOTAL), messages: msgs, ids: all.map(function (p) { return p.id; }) };
}

/** 메시지 번호 a가 b보다 큰가(숫자 글자는 자리수·글자 순으로 비교해 큰 번호도 정확). b가 비었으면 항상 참. 숫자가 아닌 번호는 새 것으로 본다. */
function tgFeedIdAfter(a, b) {
  if (!b) return true;
  if (!/^\d{1,20}$/.test(a) || !/^\d{1,20}$/.test(b)) return true;
  a = a.replace(/^0+(?=\d)/, ''); b = b.replace(/^0+(?=\d)/, '');
  return a.length !== b.length ? a.length > b.length : a > b;
}

/** 목록에서 가장 큰 숫자 번호(ref 또는 id). 없으면 ''. */
function tgFeedMaxId(list) {
  var max = '';
  (list || []).forEach(function (m) { var id = typeof m === 'string' ? m : (m.ref || m.id || ''); if (/^\d{1,20}$/.test(id) && (!max || tgFeedIdAfter(id, max))) max = id.replace(/^0+(?=\d)/, ''); });
  return max;
}

/**
 * 하루치(tgFeedGroupDay 결과)에서 lastId보다 큰 새 메시지만 남긴다. 라벨은 그날 전체 순서로 먼저 붙인 뒤 거른다(시간이 달라도 같은 사람 = 같은 라벨).
 * 반환: {total(새 메시지 수, 글 없는 것 포함), messages(라벨 붙은 새 글 메시지), maxId(새 메시지 중 가장 큰 번호, 없으면 '')}.
 */
function tgFeedFresh(grouped, lastId) {
  var labeled = tgFeedAssignSenders(grouped.messages);
  var ids = (grouped.ids || labeled.map(function (m) { return m.ref; })).filter(function (id) { return tgFeedIdAfter(id, lastId); });
  return {
    total: Math.min(ids.length, TG_FEED_MAX_TOTAL),
    messages: labeled.filter(function (m) { return tgFeedIdAfter(m.ref, lastId); }),
    maxId: tgFeedMaxId(ids),
  };
}

/** 그날 전체로 만든 이름표 목록에서 이번에 보내는 메시지의 라벨만 남긴다. */
function tgFeedSendersFor(senders, messages) {
  var used = {};
  (messages || []).forEach(function (m) { used[m.sender] = true; });
  return (senders || []).filter(function (s) { return used[s.label]; });
}

/** 한국 시각 0~7시(쉬는 시각)인가. */
function tgFeedQuiet(nowMs) {
  var h = new Date(nowMs + CALL_FEED_KST_MS).getUTCHours();
  return h >= TG_FEED_QUIET_FROM && h < TG_FEED_QUIET_UNTIL;
}

/** 번호 → A, B, … Z, AA, AB … (세 글자까지). */
function tgFeedSenderName(n) {
  var s = '';
  n = n + 1;
  while (n > 0 && s.length < 3) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

/** 보낸 사람 실제 값을 처음 나온 순서대로 A, B, C … 로 바꾼다(방·날짜마다 새로). 실제 값은 결과에 남지 않는다. */
function tgFeedAssignSenders(messages) {
  var map = {}, n = 0;
  return messages.map(function (m) {
    var key = m.senderId || '?';
    if (!map.hasOwnProperty(key)) map[key] = tgFeedSenderName(n++);
    return { ref: m.id, at: m.at, sender: map[key], text: m.text, reply_to: m.replyTo, forwarded: m.forwarded };
  });
}

/** 이름 칸 정리: 문자열만, NFC, 제어문자 제거, 빈칸 정리, 40글자까지. 전화번호·@아이디 모양이거나 비면 ''(서버 SENDER_NAME_REJECT와 같은 기준). */
function tgFeedCleanName(value) {
  if (typeof value !== 'string') return '';
  var s = callFeedNfc(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, TG_FEED_SENDER_NAME_CHARS).join('').trim();
  if (!s || /^@|^\+?[\d\s().-]{7,}$/.test(s)) return '';
  return s;
}

/** computeHmacSha256Signature가 돌려주는 부호 있는 바이트 배열 → 앞 32자 소문자 16진수. */
function tgFeedHmacHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length && hex.length < 32; i++) hex += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex.slice(0, 32);
}

/**
 * 하루치 메시지(tgFeedAssignSenders와 같은 순서로 A, B, C …)의 라벨별 이름표 목록을 만든다.
 * keyFn(번호) → 32자 해시(열쇠가 없으면 이 함수를 부르지 않는다). 번호가 비어 있는 사람('?')은 key를 만들지 않는다.
 * 보낼 것이 없는 라벨(key·name·self 모두 없음)은 뺀다. 40명까지. 실제 번호는 결과에 남지 않는다.
 */
function tgFeedBuildSenders(messages, keyFn) {
  var map = {}, order = [], n = 0;
  messages.forEach(function (m) {
    var id = m.senderId || '?';
    if (!map.hasOwnProperty(id)) { map[id] = { label: tgFeedSenderName(n++), id: id, name: '', self: null }; order.push(map[id]); }
    var e = map[id];
    if (!e.name && m.senderName) e.name = m.senderName;
    if (m.senderSelf === true) e.self = true;
    else if (m.senderSelf === false && e.self === null) e.self = false;
  });
  var out = [];
  order.forEach(function (e) {
    var item = { label: e.label };
    if (e.id !== '?') { var key = keyFn(e.id); if (/^[0-9a-f]{32}$/.test(key || '')) item.key = key; }
    if (e.name) item.name = e.name;
    if (e.self !== null) item.self = e.self;
    if (item.key || item.name || item.self !== undefined) out.push(item);
  });
  return out.slice(0, TG_FEED_SENDERS_MAX);
}

/** 소급 보내기 날짜 범위: 오늘(한국)에서 backDays일 전 ~ 어제. backDays는 1~60 정수(아니면 14). 오늘(아직 안 끝난 날)은 매시 보내기가 맡는다. */
function tgFeedSendersBackRange(today, backDays) {
  var n = Number(backDays);
  if (!(isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 60)) n = TG_FEED_SENDERS_BACK_DAYS_DEFAULT;
  return { from: tgFeedAddDays(today, -n), to: tgFeedAddDays(today, -1) };
}

/** 소급 보내기 진행 위치(JSON 글) 정리: {from, to, room(마지막으로 다룬 방 key), day(그 방에서 마지막으로 다룬 날), end, fetch:{d,n}}. 틀린 칸은 빈 값. */
function tgFeedSendersBackClean(raw) {
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  if (!s || typeof s !== 'object') s = {};
  var day = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };
  var out = { from: day(s.from), to: day(s.to), room: typeof s.room === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(s.room) ? s.room : '', day: day(s.day), end: s.end === true,
    fetch: s.fetch && day(s.fetch.d) && typeof s.fetch.n === 'number' && s.fetch.n >= 0 ? { d: s.fetch.d, n: Math.floor(s.fetch.n) } : { d: '', n: 0 } };
  if (!out.from || !out.to || out.from > out.to) { out.from = ''; out.to = ''; out.room = ''; out.day = ''; out.end = false; }
  return out;
}

/** 이 방에서 아직 안 다룬 날들(오름차순). 방은 key 순서로 다루므로 마지막 방보다 앞선 방은 끝난 것, 같은 방이면 마지막 날 다음부터. */
function tgFeedSendersBackDays(bs, roomKey) {
  if (!bs.from || bs.end) return [];
  if (bs.room && roomKey < bs.room) return [];
  var start = bs.room === roomKey && bs.day ? tgFeedAddDays(bs.day, 1) : bs.from;
  var out = [];
  for (var d = start; d <= bs.to && out.length < 62; d = tgFeedAddDays(d, 1)) out.push(d);
  return out;
}

/** 소급으로 보낼 이름표: key 있는 사람만(서버가 key 없는 사람은 받지 않는다 — 키 없이 새 사람을 만들지 않게). 40명까지. */
function tgFeedSendersBackList(senders) {
  return (senders || []).filter(function (s) { return s && /^[0-9a-f]{16,32}$/.test(s.key || ''); }).slice(0, TG_FEED_SENDERS_MAX);
}

/** 서버 POST ?action=telegram_senders 몸통(handler.ts parseSendersBody와 같은 칸). */
function tgFeedSendersBackBody(day, roomKey, senders) {
  return { day: day, room_key: roomKey, senders: senders };
}

/** 서버 몸통 상한(메시지 300개, 약 200 KB)에 맞춰 순서를 지키며 쪼갠다. 같은 입력이면 항상 같은 모양으로 쪼개진다(이어 하기 때문). */
function tgFeedSplit(messages) {
  var parts = [], cur = [], bytes = 0;
  messages.forEach(function (m) {
    var size = callFeedBytes(JSON.stringify(m)) + 1;
    if (cur.length && (cur.length >= TG_FEED_MAX_MESSAGES || bytes + size > TG_FEED_MAX_BODY_BYTES)) { parts.push(cur); cur = []; bytes = 0; }
    cur.push(m); bytes += size;
  });
  if (cur.length) parts.push(cur);
  return parts;
}

/** 서버 POST ?action=telegram 몸통(handler.ts parseTelegramBody와 같은 칸). reply_to·forwarded는 값이 있을 때만 넣는다. */
function tgFeedBuildBody(input) {
  var msgs = input.messages.map(function (m) {
    var o = { ref: m.ref, at: m.at, sender: m.sender, text: m.text };
    if (m.reply_to) o.reply_to = m.reply_to;
    if (m.forwarded) o.forwarded = true;
    return o;
  });
  var body = { day: input.day, room_key: input.roomKey, room_label: input.roomLabel, total: Math.max(input.total, msgs.length), messages: msgs };
  if (input.part > 1) body.part = input.part;
  if (input.attempt > 1) body.attempt = input.attempt;
  if (input.cont) body.cont = true;   // 이 방·날을 앞서 보낸 적이 있음(TG-1시간수집). 서버는 방 수를 다시 세지 않는다
  if (input.senders && input.senders.length) body.senders = input.senders;   // 나뉜 묶음마다 같은 목록. 라벨은 하루치 전체에서 정해져 일관된다
  return body;
}

/** 방 상태: 끝낸 마지막 날짜(doneDay), 시작 날짜 앞 보충 구간에서 끝낸 마지막 날짜(backDay, 보충 구간이 없으면 빈 글), 그리고 날짜를 묶음 몇 개까지 보냈는지(partDay·partsDone). */
function tgFeedRoomState(state, key) {
  var r = state.rooms && state.rooms[key] || {};
  // 디스크에는 짧은 모양(d·b·p·n)으로 쓰고, 옛 긴 모양(doneDay·backDay·partDay·partsDone)도 받는다.
  var done = r.doneDay !== undefined ? r.doneDay : r.d, back = r.backDay !== undefined ? r.backDay : r.b;
  var partDay = r.partDay !== undefined ? r.partDay : r.p, partsDone = r.partsDone !== undefined ? r.partsDone : r.n;
  var lastId = r.lastId !== undefined ? r.lastId : r.m, lastDay = r.lastDay !== undefined ? r.lastDay : r.l;
  return {
    lastId: /^\d{1,20}$/.test(String(lastId || '')) ? String(lastId) : '',
    lastDay: /^\d{4}-\d{2}-\d{2}$/.test(lastDay || '') ? lastDay : '',
    doneDay: /^\d{4}-\d{2}-\d{2}$/.test(done || '') ? done : tgFeedAddDays(state.startDay, -1),
    backDay: /^\d{4}-\d{2}-\d{2}$/.test(back || '') ? back : (state.backFrom ? tgFeedAddDays(state.backFrom, -1) : ''),
    partDay: /^\d{4}-\d{2}-\d{2}$/.test(partDay || '') ? partDay : '',
    partsDone: typeof partsDone === 'number' && partsDone > 0 ? Math.floor(partsDone) : 0,
  };
}

/** 보낼 날짜 목록: 끝낸 날 다음부터 어제(한국)까지(withToday면 오늘까지, TG-1시간수집). 시작 날짜 앞과 서버가 받는 92일보다 오래된 날은 뺀다. */
function tgFeedPendingDays(doneDay, startDay, today, withToday) {
  var first = tgFeedAddDays(doneDay, 1);
  if (first < startDay) first = startDay;
  var oldest = tgFeedAddDays(today, -CALL_FEED_MAX_PAST_DAYS);
  if (first < oldest) first = oldest;
  var last = withToday ? today : tgFeedAddDays(today, -1);
  var out = [];
  for (var d = first; d <= last && out.length < 94; d = tgFeedAddDays(d, 1)) out.push(d);
  return out;
}

/** 시작 날짜 앞 보충 구간에서 보낼 날짜 목록: 보충 구간에서 끝낸 날 다음부터 시작 날짜 하루 전까지(오늘은 뺌). 서버가 받는 92일보다 오래된 날은 뺀다. */
function tgFeedBackfillDays(backDay, backFrom, startDay, today) {
  if (!backFrom || !backDay) return [];
  var first = tgFeedAddDays(backDay, 1);
  if (first < backFrom) first = backFrom;
  var oldest = tgFeedAddDays(today, -CALL_FEED_MAX_PAST_DAYS);
  if (first < oldest) first = oldest;
  var last = tgFeedAddDays(startDay, -1);
  var yesterday = tgFeedAddDays(today, -1);
  if (last > yesterday) last = yesterday;
  var out = [];
  for (var d = first; d <= last && out.length < 93; d = tgFeedAddDays(d, 1)) out.push(d);
  return out;
}

/** 한 방에서 이번에 볼 날짜 계획: 보충 구간(back: true)이 먼저, 그 다음 평소 구간(back: false). 같은 날짜는 두 구간에 함께 들어가지 않는다. */
function tgFeedPlanDays(roomState, state, today, withToday) {
  var plan = [];
  tgFeedBackfillDays(roomState.backDay, state.backFrom, state.startDay, today).forEach(function (d) { plan.push({ day: d, back: true }); });
  tgFeedPendingDays(roomState.doneDay, state.startDay, today, withToday).forEach(function (d) { plan.push({ day: d, back: false }); });
  return plan;
}

/** 이 날짜에서 이미 보낸 묶음 수(이어 하기). 다른 날짜의 기록이면 0. */
function tgFeedPartsToSkip(roomState, day) {
  return roomState.partDay === day ? roomState.partsDone : 0;
}

/** 묶음 하나(0부터)를 보낸 뒤의 방 상태. 마지막 묶음이면 그 날을 끝낸 날로(보충 구간이면 backDay로), 아니면 몇 개까지 보냈는지만 적는다. */
function tgFeedAfterPart(roomState, day, partIndex, partCount, isBack) {
  var back = roomState.backDay || '';
  if (partIndex + 1 >= partCount) {
    return isBack ? { doneDay: roomState.doneDay, backDay: day, partDay: '', partsDone: 0 } : { doneDay: day, backDay: back, partDay: '', partsDone: 0 };
  }
  return { doneDay: roomState.doneDay, backDay: back, partDay: day, partsDone: partIndex + 1 };
}

/**
 * 새 메시지를 한 묶음(또는 묶음 없는 날) 보낸 뒤의 방 상태(TG-1시간수집). sentMax = 이번에 보낸 묶음의 가장 큰 번호, doneMax = 그 날 마지막 묶음이면 새 메시지 전체의 가장 큰 번호.
 * 보충 구간은 backDay만 옮긴다. 끝난 날의 마지막 묶음이면 그 날을 끝낸 날로 적는다. 오늘(open)은 번호만 옮기고 끝낸 날은 그대로 둔다.
 */
function tgFeedAfterSend(roomState, day, isBack, open, sentMax, doneMax) {
  var rs = { doneDay: roomState.doneDay, backDay: roomState.backDay || '', partDay: '', partsDone: 0, lastId: roomState.lastId || '', lastDay: roomState.lastDay || '' };
  if (isBack) { if (doneMax !== '' || sentMax === '') rs.backDay = day; return rs; }
  var top = [sentMax, doneMax].reduce(function (a, b) { return b && (!a || tgFeedIdAfter(b, a)) ? b : a; }, '');
  if (top && tgFeedIdAfter(top, rs.lastId)) { rs.lastId = top; rs.lastDay = day; }
  if (!open && (doneMax !== '' || sentMax === '')) rs.doneDay = day;
  return rs;
}

/** 그 날(한국)의 메시지 파일을 찾을 고친 시각 범위(밀리초): 그 날 0시부터 3일. */
function tgFeedWindow(day) {
  var from = Date.parse(day + 'T00:00:00+09:00');
  return { fromMs: from, toMs: from + TG_FEED_WINDOW_DAYS * 86400000 };
}

/** 그 날 메시지 파일이 있을 월 폴더 이름(한국 달, 달이 UTC와 다르면 UTC 달도). */
function tgFeedMonths(day) {
  var out = [day.slice(0, 7)];
  var utc = new Date(Date.parse(day + 'T00:00:00+09:00')).toISOString().slice(0, 7);
  if (out.indexOf(utc) < 0) out.push(utc);
  return out;
}

/** 여러 날(오름차순)을 한 번에 읽을 고친 시각 범위(밀리초): 첫 날 0시(한국) ~ 마지막 날 0시 + 3일. tgFeedWindow를 날 하나씩 묶은 것과 같다. */
function tgFeedWindowRange(days) {
  return { fromMs: tgFeedWindow(days[0]).fromMs, toMs: tgFeedWindow(days[days.length - 1]).toMs };
}

/** 여러 날에 필요한 월 폴더 이름(중복 없음, 한국 달과 UTC 달). */
function tgFeedMonthsOf(days) {
  var out = [];
  days.forEach(function (d) { tgFeedMonths(d).forEach(function (m) { if (out.indexOf(m) < 0) out.push(m); }); });
  return out;
}

/** 읽은 메시지를 메시지 안 날짜별로 나눈다. */
function tgFeedByDay(parsedList) {
  var out = {};
  (parsedList || []).forEach(function (p) { if (p && p.day) (out[p.day] || (out[p.day] = [])).push(p); });
  return out;
}

/**
 * 다음에 읽을 방: 보낼 날이 남고 막히지 않은 방 중, 미뤄 둔 방(first)이 맨 먼저, 그다음 가장 오래된 못 보낸 날이 앞선 방, 같으면 방 번호 순.
 * 날짜 우선이라 한 방이 몇 날을 하든 다른 방이 굶지 않는다. 없으면 null.
 */
function tgFeedNextRoom(entries) {
  var best = null;
  entries.forEach(function (e) {
    if (e.blocked || !e.plan.length) return;
    if (!best) { best = e; return; }
    if (!!e.first !== !!best.first) { if (e.first) best = e; return; }
    var a = e.plan[0].day, b = best.plan[0].day;
    if (a < b || (a === b && e.room.key < best.room.key)) best = e;
  });
  return best;
}

/** 앱 스크립트의 "하루 호출 너무 많음" 계열 오류인가. */
function tgFeedIsQuotaError(e) {
  return /too many times|quota|limit exceeded|한도|너무 많/i.test(String(e && e.message || e || ''));
}

/** 방 상태를 디스크에 쓸 짧은 모양으로: {d: 끝낸 날, b: 보충 끝낸 날, p: 묶음 중간 날짜, n: 보낸 묶음 수}. 비어 있는 b·p·n은 쓰지 않는다. */
function tgFeedCompactRoom(rs, state) {
  var o = { d: rs.doneDay };
  if (rs.backDay && rs.backDay !== (state && state.backFrom ? tgFeedAddDays(state.backFrom, -1) : '')) o.b = rs.backDay;   // 보충 구간을 막 시작한 방의 기본값은 쓰지 않는다
  if (rs.partDay) { o.p = rs.partDay; o.n = rs.partsDone; }
  if (rs.lastId) { o.m = rs.lastId; o.l = rs.lastDay; }
  return o;
}

/** 저장할 진행 기록(방 상태는 짧은 모양). 읽을 때는 tgFeedRoomState가 옛 긴 모양과 짧은 모양을 모두 받는다. */
function tgFeedCompactState(state) {
  var rooms = {};
  Object.keys(state.rooms || {}).forEach(function (k) { rooms[k] = tgFeedCompactRoom(tgFeedRoomState(state, k), state); });
  var out = { startDay: state.startDay, backChecked: state.backChecked, backFrom: state.backFrom, rooms: rooms, attempts: state.attempts, chain: state.chain, lastRun: state.lastRun };
  if (state.fetch && state.fetch.n > 0) out.fetch = state.fetch;
  if (state.pri) out.pri = state.pri;
  if (state.stall) out.stall = state.stall;
  return out;
}

/** 방별 남은 날 수 요약(방 이름·번호 없이 개수만): 합계, 남은 방 수, 가장 많이 남은 방의 날 수, 분포. */
function tgFeedRemaining(state, roomKeys, today) {
  var total = 0, rooms = 0, max = 0, dist = { zero: 0, one: 0, few: 0, many: 0 };
  roomKeys.forEach(function (k) {
    var n = tgFeedPlanDays(tgFeedRoomState(state, k), state, today).length;
    total += n; if (n) rooms++; if (n > max) max = n;
    if (n === 0) dist.zero++; else if (n === 1) dist.one++; else if (n <= 3) dist.few++; else dist.many++;
  });
  return { total: total, rooms: rooms, max: max, dist: dist };
}
function tgFeedRemainingText(r) {
  return '방별 남은 날: 합계 ' + r.total + '일 · 남은 방 ' + r.rooms + '개(가장 많이 남은 방 ' + r.max + '일) · 0일 ' + r.dist.zero + '개 방 / 1일 ' + r.dist.one + ' / 2~3일 ' + r.dist.few + ' / 4일 이상 ' + r.dist.many;
}

/** 429의 서버 오류 코드 → 멈춘 이유 글. 하루 상한(DAILY_LIMIT)과 이번 달 AI 상한(AI_MONTHLY_LIMIT)은 풀리는 때가 달라 구분해 적는다. */
function tgFeedLimitReason(errorCode) {
  if (errorCode === 'AI_MONTHLY_LIMIT') return '이번 달 AI 상한(AI_MONTHLY_LIMIT, 429) — 다음 달 1일까지 풀리지 않음. 상한을 올릴지는 명진 결정';
  if (errorCode === 'DAILY_LIMIT') return '서버 하루 상한(DAILY_LIMIT, 429, 묶음 300개) — 다음 날 7시에 이어 보냄';
  return '서버 상한(429' + (errorCode ? ' ' + errorCode : '') + ') — 다음 매시 실행에서 다시 시도';
}

/** 마지막 실행 기록(멈춘 일이 로그를 열지 않아도 tgFeed_check에 보이게). 값은 날짜·개수·멈춘 이유 글뿐이다. */
function tgFeedLastRun(nowMs, stop, parts, kept, dropped, extra) {
  var x = extra || {};
  return { at: new Date(nowMs).toISOString(), stop: String(stop || '').slice(0, 200), parts: parts || 0, kept: kept || 0, dropped: dropped || 0, files: x.files || 0, secs: x.secs || 0, visits: x.visits || 0 };
}
function tgFeedLastRunClean(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.at !== 'string' || isNaN(Date.parse(raw.at))) return null;
  return { at: raw.at, stop: typeof raw.stop === 'string' ? raw.stop.slice(0, 200) : '', parts: Number(raw.parts) || 0, kept: Number(raw.kept) || 0, dropped: Number(raw.dropped) || 0, files: Number(raw.files) || 0, secs: Number(raw.secs) || 0, visits: Number(raw.visits) || 0 };
}
function tgFeedLastRunText(lr) {
  if (!lr) return '기록 없음(이 기록이 생긴 뒤 한 번도 실제로 돌지 않음)';
  return callFeedKstDay(Date.parse(lr.at)) + ' ' + new Date(Date.parse(lr.at) + CALL_FEED_KST_MS).toISOString().slice(11, 16) + ' — 보낸 묶음 ' + lr.parts + ' · 소식 ' + lr.kept + ' · 넘김·실패 ' + lr.dropped + ' · ' + (lr.stop || '끝까지 봄') +
    (lr.secs || lr.files || lr.visits ? ' · 소요 ' + lr.secs + '초 · 읽은 파일 ' + lr.files + '개(초당 약 ' + (lr.secs ? Math.round(lr.files / lr.secs) : lr.files) + ') · 읽은 방 ' + lr.visits + '곳' : '');
}

/** 방별 진행 요약: 가장 늦은·가장 빠른 끝낸 날, 어제까지 못 끝낸 방 수. 상태에 없는 방은 시작 날짜 하루 전으로 본다. */
function tgFeedProgress(state, roomKeys, today) {
  var yesterday = tgFeedAddDays(today, -1);
  var min = '', max = '', behind = 0;
  roomKeys.forEach(function (k) {
    var d = tgFeedRoomState(state, k).doneDay;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
    if (d < yesterday) behind++;
  });
  return { rooms: roomKeys.length, min: min, max: max, behind: behind, yesterday: yesterday };
}
function tgFeedProgressText(p, today) {
  if (!p.rooms) return '방별 진행: 찾은 방 없음';
  return '방별 진행: ' + p.rooms + '개 방 중 어제(' + p.yesterday + ')까지 끝낸 방 ' + (p.rooms - p.behind) + '개 · 못 끝낸 방 ' + p.behind + '개 (끝낸 날 가장 늦은 방 ' + p.min + ', 가장 빠른 방 ' + p.max + ')';
}

/**
 * 빠진 날 다시 보내기의 순수 부분. day(YYYY-MM-DD)는 최근 7일 안·어제까지만 받는다.
 * 방마다 doneDay가 day 이상이면 day 하루 전으로 되돌리고 이어 하기 기록(partDay)을 지운다. 이미 더 앞인 방은 그대로.
 * 시작 날짜가 day보다 뒤이면(보충 구간이 남아 있지 않을 때만) 시작 날짜도 day로 당겨 상태에 없는 방도 그 날부터 받게 한다.
 */
function tgFeedRewind(state, day, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return { error: '스크립트 속성 ' + TG_FEED_REWIND_KEY + '에 날짜(예: 2026-10-25)를 적고 다시 실행하세요.' };
  if (day > tgFeedAddDays(today, -1)) return { error: '아직 하루가 끝나지 않은 날은 되돌릴 수 없습니다(어제까지).' };
  if (day < tgFeedAddDays(today, -TG_FEED_RECENT_DAYS)) return { error: '최근 ' + TG_FEED_RECENT_DAYS + '일보다 오래된 날은 되돌리지 않습니다.' };
  var prev = tgFeedAddDays(day, -1);
  var next = JSON.parse(JSON.stringify(state));
  var changed = 0;
  Object.keys(next.rooms).forEach(function (k) {
    var rs = tgFeedRoomState(next, k);
    if (rs.doneDay > prev || (rs.lastDay && rs.lastDay >= day)) {
      next.rooms[k] = { doneDay: rs.doneDay > prev ? prev : rs.doneDay, backDay: rs.backDay, partDay: '', partsDone: 0 };   // 보낸 번호 기록도 지워 그 날부터 전부 다시 보낸다
      changed++;
    }
  });
  if (next.startDay > day && !next.backFrom) next.startDay = day;
  Object.keys(next.attempts || {}).forEach(function (k) { var m = k.split('|'); if (m[1] >= day) delete next.attempts[k]; });
  return { state: next, changed: changed };
}

/** 이 스크립트의 트리거 중 handler 이름이 목록에 든 것을 한 줄로. 하나도 없으면 emptyText. */
function feedTriggerSummary_(handlers, emptyText) {
  var counts = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (handlers.indexOf(h) >= 0) counts[h] = (counts[h] || 0) + 1;
  });
  var names = Object.keys(counts);
  if (!names.length) return emptyText;
  return names.map(function (h) { return h + ' ' + counts[h] + '개'; }).join(' · ');
}

/** 서버 응답 → 할 일. ok·auth·limit(429)·drop(400·413)은 통화와 같다. pause: 서버 준비 문제(AI 열쇠 없음 503, DB 연결 503)는 횟수에 세지 않고 멈춘다. 나머지는 retry. */
function tgFeedVerdict(code, errorCode) {
  if (code === 200) return 'ok';
  if (code === 401) return 'auth';
  if (code === 429) return 'limit';
  if (code === 400 || code === 413) return 'drop';
  if (code === 503 && (errorCode === 'AI_NOT_CONFIGURED' || errorCode === 'DB_UNAVAILABLE')) return 'pause';
  return 'retry';
}

// ═══════════════════════════════════════════════════════════════════════
// 멈춤 알림 (OPS-수집멈춤알림)
//
// 텔레그램·통화 보내기가 한 번 끝날 때마다 "시각 + 닫힌 상태 글자 하나"를 Web2 점검 신호 입구(drive-summary ?action=heartbeat)로 알린다.
// Web2 홈 "마지막 수집 시각" 칸이 이 값으로 멈춤을 알아챈다(출처 이름 telegram_send·call_send). 내용·방 이름·파일 이름·번호는 보내지 않는다.
//   state: ok(잘 됨) · test(시험 모드) · limit_day(서버 하루 상한 — 내일 이어짐) · limit_ai(이번 달 AI 상한) ·
//          failing(서버·연결 실패가 3번 이어짐) · broken(비밀값 불일치·설정 빠짐·서버 준비 안 됨 등 사람이 고쳐야 함)
//   last_at: 마지막으로 실제 글을 보낸 시각(아직 없으면 이 기능을 처음 켠 시각). 신호가 아예 끊기면 Web2가 '보내기 멈춤'(트리거 삭제·스크립트 정지)으로 본다.
// 비밀값(스크립트 속성 COLLECTOR_HEARTBEAT_SECRET)이 이 프로젝트에 없으면 알리지 않고 넘어간다. 알리기에 실패해도 보내기는 영향이 없다.
// ═══════════════════════════════════════════════════════════════════════

/** 실행 결과 종류 둘 중 더 무거운 쪽: broken > limit_ai > bad(서버·연결 실패) > limit_day. */
function feedKindPick(a, b) {
  var rank = { '': 0, limit_day: 1, bad: 2, limit_ai: 3, broken: 4 };
  return (rank[b] || 0) > (rank[a] || 0) ? b : (a || '');
}
/** 429의 서버 오류 코드 → limit_ai(이번 달 AI 상한) 또는 limit_day(하루 상한 등). */
function feedLimitKind(errorCode) { return errorCode === 'AI_MONTHLY_LIMIT' ? 'limit_ai' : 'limit_day'; }

/** 스크립트 속성에서 읽은 stall 기록 정리. 이상하면 null. */
function feedStallClean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var okTime = function (t) { return typeof t === 'string' && t.length <= 40 && !isNaN(Date.parse(t)); };
  var bad = Number(raw.bad);
  return { bad: isFinite(bad) && bad >= 0 ? Math.min(Math.floor(bad), 99) : 0, sentAt: okTime(raw.sentAt) ? raw.sentAt : '', base: okTime(raw.base) ? raw.base : '' };
}

/**
 * 이번 실행 결과로 다음 기록과 알릴 값을 만든다(순수 함수).
 * prev: 지난 기록({bad, sentAt, base} 또는 null). input: {test, kind('' | limit_day | bad | limit_ai | broken), sent(이번에 실제 글을 보냈나)}.
 */
function feedStallNext(prev, input, nowMs) {
  var p = feedStallClean(prev) || { bad: 0, sentAt: '', base: '' };
  var nowIso = new Date(nowMs).toISOString();
  var base = p.base || nowIso;
  var sentAt = input.sent && !input.test ? nowIso : p.sentAt;
  var bad = input.kind === 'bad' || input.kind === 'broken' ? Math.min(p.bad + 1, 99) : 0;
  var state = 'ok';
  if (input.test) state = 'test';
  else if (input.kind === 'broken') state = 'broken';
  else if (input.kind === 'limit_ai') state = 'limit_ai';
  else if (input.kind === 'bad' && bad >= FEED_REPORT_FAIL_RUNS) state = 'failing';
  else if (input.kind === 'limit_day') state = 'limit_day';
  return { bad: bad, sentAt: sentAt, base: base, state: state, lastAt: sentAt || base };
}

/** 점검 신호 몸통(순수 함수). 서버가 받는 모양과 같다: {source, last_at, state}. */
function feedReportBody(source, lastAt, state) {
  return { source: source, last_at: lastAt, state: state };
}

/** 실행 한 번을 감싼다. 끝나면 결과를 알리고, 오류로 끝나면 broken을 알린 뒤 오류를 그대로 다시 던진다(트리거 실행 기록에 실패로 남음). */
function feedGuard_(which, core) {
  var result = null;
  try {
    result = core();
  } catch (e) {
    try {
      var state = which === 'tg' ? tgFeed_loadState_() : callFeed_loadState_();
      var next = feedStallNext(state.stall, { test: false, kind: 'broken', sent: false }, Date.now());
      feedReport_({ source: which === 'tg' ? 'telegram_send' : 'call_send', lastAt: next.lastAt, state: 'broken' });
    } catch (ignore) { /* 알리기 실패는 원래 오류를 가리지 않는다 */ }
    throw e;
  }
  if (result) feedReport_(result);
}

/** 점검 신호 한 번 보내기. 비밀값이 없거나 실패하면 로그만 남기고 조용히 넘어간다. */
function feedReport_(report) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty(FEED_REPORT_SECRET_KEY) || '';
    if (secret.length < 32) { Logger.log('멈춤 알림: 스크립트 속성 ' + FEED_REPORT_SECRET_KEY + '가 없어 Web2에 알리지 않았습니다(안내 문서 멈춤 알림 단계).'); return; }
    var res = UrlFetchApp.fetch(FEED_REPORT_URL, {
      method: 'post', contentType: 'application/json', headers: { 'x-collector-heartbeat-secret': secret },
      payload: JSON.stringify(feedReportBody(report.source, report.lastAt, report.state)), muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    Logger.log('멈춤 알림 ' + report.source + ': ' + (code === 200 ? '알림(' + report.state + ')' : '실패(HTTP ' + code + ')'));
  } catch (e) {
    Logger.log('멈춤 알림 실패: ' + (e && e.message ? e.message : e));
  }
}

/** check 함수가 쓰는 한 줄: 멈춤 알림 비밀값 유무(길이만)와 마지막 보낸 시각·이어진 실패 횟수. */
function feedReportCheckText_(stall) {
  var len = (PropertiesService.getScriptProperties().getProperty(FEED_REPORT_SECRET_KEY) || '').length;
  var st = feedStallClean(stall);
  return '멈춤 알림: 비밀값 ' + (len >= 32 ? '있음' : '없음 — Web2 홈에 멈춤이 알려지지 않음(안내 문서 멈춤 알림 단계)') +
    (st ? ' · 마지막으로 글을 보낸 시각 ' + (st.sentAt || '없음') + ' · 이어진 실패 ' + st.bad + '번' : ' · 아직 기록 없음');
}

/** 손으로 [실행]: 멈춤 알림 시험. 지금 상태를 두 출처 모두 한 번 알린다(보내기·진행 기록은 건드리지 않는다). 실행 로그에 결과가 나온다. */
function feedReport_test() {
  var now = Date.now();
  var tg = feedStallNext(tgFeed_loadState_().stall, { test: tgFeed_testMode_(), kind: '', sent: false }, now);
  var call = feedStallNext(callFeed_loadState_().stall, { test: callFeed_testMode_(), kind: '', sent: false }, now);
  feedReport_({ source: 'telegram_send', lastAt: tg.lastAt, state: tg.state });
  feedReport_({ source: 'call_send', lastAt: call.lastAt, state: call.state });
}

// node 시험에서만 쓰는 내보내기(앱 스크립트에는 module이 없어서 아무 일도 하지 않는다).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    callFeedNormalizeNumber: callFeedNormalizeNumber, callFeedNormalizeName: callFeedNormalizeName, callFeedParseList: callFeedParseList,
    callFeedTranscriptName: callFeedTranscriptName, callFeedIsPersonal: callFeedIsPersonal, callFeedKstDay: callFeedKstDay,
    callFeedDayInRange: callFeedDayInRange, callFeedTooOld: callFeedTooOld, callFeedRecentStartMs: callFeedRecentStartMs, callFeedShiftSpeakers: callFeedShiftSpeakers, callFeedHasSpeakerZero: callFeedHasSpeakerZero, callFeedBytes: callFeedBytes, callFeedCapBytes: callFeedCapBytes,
    callFeedAnalysisName: callFeedAnalysisName, callFeedMinimalAnalysis: callFeedMinimalAnalysis,
    callFeedFrontmatter: callFeedFrontmatter, callFeedClass: callFeedClass, callFeedForcePersonal: callFeedForcePersonal,
    callFeedBuildCallBody: callFeedBuildCallBody, callFeedVerdict: callFeedVerdict,
    callFeedHasSummary: callFeedHasSummary, callFeedResendWanted: callFeedResendWanted,
    callFeedPendingClean: callFeedPendingClean, callFeedPendingTrim: callFeedPendingTrim, callFeedPendingDecision: callFeedPendingDecision,
    tgFeedAddDays: tgFeedAddDays, tgFeedParseRooms: tgFeedParseRooms, tgFeedRoomMatch: tgFeedRoomMatch, tgFeedRoomPick: tgFeedRoomPick, tgFeedRoomInfo: tgFeedRoomInfo,
    tgFeedParseTime: tgFeedParseTime, tgFeedParseMessage: tgFeedParseMessage, tgFeedGroupDay: tgFeedGroupDay, tgFeedSenderName: tgFeedSenderName,
    tgFeedAssignSenders: tgFeedAssignSenders, tgFeedCleanName: tgFeedCleanName, tgFeedHmacHex: tgFeedHmacHex, tgFeedBuildSenders: tgFeedBuildSenders, tgFeedSplit: tgFeedSplit, tgFeedBuildBody: tgFeedBuildBody, tgFeedRoomState: tgFeedRoomState,
    tgFeedPendingDays: tgFeedPendingDays, tgFeedIdAfter: tgFeedIdAfter, tgFeedMaxId: tgFeedMaxId, tgFeedFresh: tgFeedFresh, tgFeedSendersFor: tgFeedSendersFor, tgFeedQuiet: tgFeedQuiet, tgFeedAfterSend: tgFeedAfterSend, tgFeedPartsToSkip: tgFeedPartsToSkip, tgFeedAfterPart: tgFeedAfterPart, tgFeedWindow: tgFeedWindow,
    tgFeedMonths: tgFeedMonths, tgFeedBackfillDays: tgFeedBackfillDays, tgFeedLimitReason: tgFeedLimitReason, tgFeedLastRun: tgFeedLastRun, tgFeedLastRunClean: tgFeedLastRunClean, tgFeedLastRunText: tgFeedLastRunText, tgFeedProgress: tgFeedProgress, tgFeedProgressText: tgFeedProgressText, tgFeedRewind: tgFeedRewind, tgFeedPlanDays: tgFeedPlanDays, tgFeedVerdict: tgFeedVerdict,
    tgFeedWindowRange: tgFeedWindowRange, tgFeedMonthsOf: tgFeedMonthsOf, tgFeedByDay: tgFeedByDay, tgFeedNextRoom: tgFeedNextRoom, tgFeedIsQuotaError: tgFeedIsQuotaError,
    feedKindPick: feedKindPick, feedLimitKind: feedLimitKind, feedStallClean: feedStallClean, feedStallNext: feedStallNext, feedReportBody: feedReportBody,
    tgFeedSendersBackRange: tgFeedSendersBackRange, tgFeedSendersBackClean: tgFeedSendersBackClean, tgFeedSendersBackDays: tgFeedSendersBackDays,
    tgFeedSendersBackList: tgFeedSendersBackList, tgFeedSendersBackBody: tgFeedSendersBackBody,
    tgFeedCompactRoom: tgFeedCompactRoom, tgFeedCompactState: tgFeedCompactState, tgFeedRemaining: tgFeedRemaining, tgFeedRemainingText: tgFeedRemainingText,
  };
}
