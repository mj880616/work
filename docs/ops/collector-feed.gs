/**
 * Web2 수집 보내기 — 통화 부분 (CALL-통화메뉴 3-가)
 *
 * 하는 일: 1시간마다 새 통화 전사 txt와 그 통화 분석 파일(검토__…md)을 찾아 Web2 서버(collector-feed)로 한 건씩 보낸다.
 *   - 개인 번호·연락처 목록(스크립트 속성 CALL_FEED_PERSONAL_LIST)에 있는 통화는 분석 파일을 읽지도 보내지도 않고 개수만 보낸다.
 *   - 분석이 아직 없으면 기다린다(24시간 넘게 없으면 건너뛴다).
 *   - 어디까지 보냈는지는 이 스크립트의 스크립트 속성(CALL_FEED_STATE)에만 적는다. Drive 파일은 고치지 않는다.
 *     분석 파일의 status, Drive 파일 설명도 건드리지 않는다(Q13).
 *   - 시험 모드(기본 켬): 아무것도 보내지 않고 개수만 실행 로그에 적는다. 어디까지 보냈는지도 바꾸지 않는다.
 * 텔레그램 부분(3-나)은 이 파일 아래쪽 "텔레그램 보내기" 구역에 있다(함수·설정 이름은 tgFeed·TG_FEED로 시작). 통화 부분과 같은 프로젝트·같은 비밀값을 쓴다.
 *
 * 설치 안내: docs/ops/collector-feed-setup.md
 * 설계: docs/design/call-telegram-feed.md 3.3·6절, 서버: supabase/functions/collector-feed/handler.ts
 *
 * 비밀값·개인 목록은 이 코드에 넣지 않는다. "프로젝트 설정 → 스크립트 속성"에만 둔다.
 * 기존 전사·분석 스크립트와 이름이 겹치지 않도록 통화 함수·설정 이름은 모두 callFeed로 시작한다.
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
var CALL_FEED_TRANSCRIPT_FOLDER = '전사';             // 기존 전사·분석 스크립트와 같은 이름
var CALL_FEED_ANALYSIS_FOLDERS = ['검토대기', '검토완료'];
var CALL_FEED_MAX_PER_RUN = 20;                       // 서버 하루 상한 50건 안에서 한 번에 보낼 수
var CALL_FEED_TIME_LIMIT_MS = 4.5 * 60 * 1000;        // 앱 스크립트 6분 제한 전에 멈춘다
var CALL_FEED_WAIT_ANALYSIS_MS = 24 * 3600 * 1000;    // 분석을 기다리는 시간
var CALL_FEED_MAX_ATTEMPTS = 3;                       // 서버·연결 실패를 다시 보내는 횟수
// 서버 상한(collector-feed handler.ts·call-analysis.ts와 같은 값)
var CALL_FEED_ANALYSIS_MAX_BYTES = 64 * 1024;
var CALL_FEED_TOTAL_MAX_BYTES = 204800;
var CALL_FEED_MAX_PAST_DAYS = 92;
var CALL_FEED_KST_MS = 9 * 3600 * 1000;

// ── 손으로 [실행]하는 함수 ───────────────────────────────────────────────

/**
 * 처음 한 번: 이 시각 이후에 생긴 전사부터 보낸다고 적는다(지난 통화는 보내지 않음, Q12).
 * 이미 적혀 있으면 바꾸지 않는다. 시험 모드도 켠 상태로 둔다.
 */
function callFeed_setup() {
  var props = PropertiesService.getScriptProperties();
  var state = callFeed_loadState_();
  if (state.since) {
    Logger.log('이미 시작 시각이 있습니다: ' + state.since + ' (바꾸지 않았습니다)');
  } else {
    state.since = new Date().toISOString();
    callFeed_saveState_(state);
    Logger.log('시작 시각을 적었습니다: ' + state.since + ' — 이 뒤에 생긴 통화부터 봅니다.');
  }
  if (!props.getProperty(CALL_FEED_TEST_KEY)) props.setProperty(CALL_FEED_TEST_KEY, '켬');
  callFeed_check();
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

// ── 1시간 트리거가 부르는 함수 ─────────────────────────────────────────

function callFeed_run() {
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
  var tally = { noClass: 0, personalList: 0, sent: 0, work: 0, personal: 0, unsure: 0, failed: 0, duplicate: 0, waiting: 0, skipped: 0, retry: 0 };
  var skipDays = test ? {} : state.skips;   // 시험 모드에서는 상태를 바꾸지 않는다
  var cursor = Date.parse(state.since);
  var stop = '';

  var files = callFeed_newTranscripts_(folders.transcript, cursor);
  for (var i = 0; i < files.length; i++) {
    if (Date.now() - started > CALL_FEED_TIME_LIMIT_MS) { stop = '시간 제한'; break; }
    if (!test && tally.sent + tally.retry >= CALL_FEED_MAX_PER_RUN) { stop = '한 번에 보낼 수 도달'; break; }
    var file = files[i].file, created = files[i].created, id = file.getId(), name = file.getName();
    var info = callFeedTranscriptName(name);
    var day = info.day || callFeedKstDay(created);

    // 1단계: 개인 번호·연락처 목록(분석 파일을 읽지 않는다)
    if (callFeedIsPersonal(info.contact, list)) {
      tally.personalList++;
      if (!test) skipDays[day] = (skipDays[day] || 0) + 1;
      cursor = created;
      continue;
    }

    var analysis = callFeed_findAnalysis_(folders.analysis, name, id);
    if (!analysis) {
      if (nowMs - created < CALL_FEED_WAIT_ANALYSIS_MS) { tally.waiting++; stop = '분석 대기'; break; }
      tally.skipped++;   // 분석이 끝내 안 생긴 통화(수동 처리 등)는 넘긴다
      cursor = created;
      continue;
    }
    var analysisMd = analysis.getBlob().getDataAsString('UTF-8');
    var transcript = file.getBlob().getDataAsString('UTF-8');
    var body = callFeedBuildCallBody({ ref: id, analysisMd: analysisMd, transcript: transcript, driveUrl: file.getUrl(), contact: info.contact, recordedAt: info.datetime });
    if (!body) { tally.skipped++; cursor = created; continue; }   // 분석 파일이 너무 큼

    if (test) {
      var cls = callFeedClass(analysisMd);
      if (cls === '실패') tally.failed++; else if (cls === '업무') tally.work++; else if (cls === '개인') tally.personal++; else tally.noClass++;
      tally.sent++;
      cursor = created;
      continue;
    }

    var res = callFeed_post_('call', body, secret);
    var verdict = callFeedVerdict(res.code);
    if (verdict === 'ok') {
      var out = res.json || {};
      if (out.duplicate) tally.duplicate++;
      tally.work += out.kept || 0; tally.personal += out.personal || 0; tally.unsure += out.unsure || 0; tally.failed += out.failed || 0;
      tally.sent++;
      delete state.attempts[id];
      cursor = created;
    } else if (verdict === 'auth') {
      callFeed_saveProgress_(state, cursor, skipDays);
      throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
    } else if (verdict === 'limit') {
      stop = '서버 하루 상한(429) — 다음 실행에서 이어 보냄'; break;
    } else if (verdict === 'drop') {
      tally.skipped++;   // 고쳐도 다시 될 일이 없는 거절(400·413). 넘긴다
      Logger.log('서버가 거절해 넘김(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
      cursor = created;
    } else {
      state.attempts[id] = (state.attempts[id] || 0) + 1;
      tally.retry++;
      if (state.attempts[id] >= CALL_FEED_MAX_ATTEMPTS) {
        Logger.log(CALL_FEED_MAX_ATTEMPTS + '번 실패해 넘김(HTTP ' + res.code + ')');
        delete state.attempts[id];
        tally.skipped++;
        cursor = created;
      } else {
        stop = '서버·연결 실패(HTTP ' + res.code + ') — 다음 실행에서 다시 보냄'; break;
      }
    }
  }

  // 개인 목록으로 거른 수: 날짜마다 한 번씩 보낸다. 실패하면 남겨 두었다가 다음 실행에서 보낸다.
  if (!test) {
    Object.keys(skipDays).sort().forEach(function (d) {
      if (!callFeedDayInRange(d, nowMs)) { delete skipDays[d]; return; }
      var r = callFeed_post_('call_skip', { day: d, personal: Math.min(skipDays[d], 500), short: 0 }, secret);
      if (r.code === 200) delete skipDays[d];
      else if (r.code === 400) delete skipDays[d];
    });
    callFeed_saveProgress_(state, cursor, skipDays);
  }

  Logger.log([
    (test ? '[시험 모드 — 보내지 않음] ' : '') + '전사 ' + files.length + '건 확인',
    '개인 목록으로 거름: ' + tally.personalList,
    (test ? '보낼 것: ' : '보냄: ') + tally.sent + ' (업무 ' + tally.work + ' · 개인 ' + tally.personal + ' · 애매 ' + tally.unsure +
      (test ? ' · 구분 없음(옛 분석·비어 있음) ' + tally.noClass + ' · 분석 실패 ' + tally.failed : ' · 판정 실패 ' + tally.failed + ' · 이미 있음 ' + tally.duplicate) + ')',
    '분석 대기: ' + tally.waiting + ' · 넘김: ' + tally.skipped + (tally.retry ? ' · 다시 보낼 것: ' + tally.retry : ''),
    stop ? '멈춘 이유: ' + stop : '끝까지 봄',
  ].join('\n'));
}

// ── Apps Script 도우미 (고칠 필요 없음) ─────────────────────────────────

function callFeed_testMode_() {
  return PropertiesService.getScriptProperties().getProperty(CALL_FEED_TEST_KEY) !== '끔';
}

function callFeed_loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CALL_FEED_STATE_KEY);
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  return { since: typeof s.since === 'string' ? s.since : '', attempts: s.attempts || {}, skips: s.skips || {} };
}

function callFeed_saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(CALL_FEED_STATE_KEY, JSON.stringify(state));
}

function callFeed_saveProgress_(state, cursorMs, skipDays) {
  state.since = new Date(Math.max(cursorMs, Date.parse(state.since) || 0)).toISOString();
  state.skips = skipDays;
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

/** 시작 시각 뒤에 만들어진 txt 전사만, 만든 순서대로. */
function callFeed_newTranscripts_(folder, sinceMs) {
  // 검색은 고친 시각으로 좁히고(새로 만든 파일은 그 뒤에 고친 것이기도 함), 만든 시각은 아래에서 다시 거른다.
  var q = 'trashed = false and modifiedDate > "' + Utilities.formatDate(new Date(sinceMs), 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + '"';
  var it = folder.searchFiles(q), out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.txt$/i.test(f.getName()) && f.getMimeType() !== 'text/plain') continue;
    var created = f.getDateCreated().getTime();
    if (created > sinceMs) out.push({ file: f, created: created });
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
 * 분석 파일의 구분: '업무' | '개인' | '구분없음' | '실패'. 기준은 명진의 통화 분석 v3.2(2026-10-24 명진 결정)이다.
 * - is_work_related: true → '업무'. false 또는 status: "개인"(개인 기록 파일) → '개인'.
 * - 칸이 없거나 비어 있음(옛 3.1 파일, 애매해서 비워 둔 것) → '구분없음'(보내지 않고 서버가 개수로만 센다).
 * - 분석 스크립트가 남긴 "분석실패" 기록은 '실패'.
 */
function callFeedClass(md) {
  var meta = callFeedFrontmatter(md);
  var status = String(meta.status || '').replace(/\s/g, '');
  if (status === '분석실패') return '실패';
  var flag = String(meta.is_work_related || '').trim().toLowerCase();
  if (status === '개인' || flag === 'false') return '개인';
  if (flag === 'true') return '업무';
  return '구분없음';
}

/**
 * 업무가 아닌 통화에 보낼 앞머리: 서버가 개수를 세는 데 필요한 칸만(이름·요약·전사는 보내지 않는다).
 * 녹음 시각이 없으면 전사 파일 이름의 날짜·시각(fallbackDatetime)을 쓴다(서버가 그 날짜에 센다).
 * 분석 스크립트가 남긴 "분석실패" 기록은 버전 칸을 빼서 서버가 판정 실패로 세게 한다.
 */
var CALL_FEED_MIN_KEYS = ['analysis_version', 'source_txt_id', 'recording_datetime', 'is_work_related'];
function callFeedMinimalAnalysis(md, fallbackDatetime) {
  var meta = callFeedFrontmatter(md), lines = ['---'];
  if (!meta.recording_datetime && fallbackDatetime) meta.recording_datetime = fallbackDatetime;
  var cls = callFeedClass(md);
  if (cls === '개인') meta.is_work_related = 'false'; else delete meta.is_work_related;
  CALL_FEED_MIN_KEYS.forEach(function (k) {
    if (cls === '실패' && k === 'analysis_version') return;
    if (meta.hasOwnProperty(k)) lines.push(k + ': "' + String(meta[k]).replace(/["\\\r\n]/g, ' ') + '"');
  });
  lines.push('---');
  return lines.join('\n');
}

/**
 * 서버 POST ?action=call 몸통 {ref, analysis_md, transcript, drive_url}(handler.ts parseCallBody와 같은 칸만).
 * - 분석이 '업무'(is_work_related: true)일 때만 분석 전체와 전사를 보낸다. 전사는 고치지 않고 그대로 보낸다
 *   (화자 구분은 전사 스크립트가 직접 `나:`/상대 표기로 쓰게 요청함 방에 요청한다. 서버가 줄 모양으로 알아본다).
 * - 개인·구분 없음은 앞머리 몇 칸만 보내고 전사는 빈 글로 보낸다(서버는 개수만 센다).
 * - 분석 파일이 64 KB를 넘으면 null(보내지 않음). 합계 200 KB를 넘으면 전사를 자른다.
 */
function callFeedBuildCallBody(input) {
  var analysisMd = callFeedNfc(input.analysisMd);
  if (!analysisMd.trim() || callFeedBytes(analysisMd) > CALL_FEED_ANALYSIS_MAX_BYTES) return null;
  var body;
  if (callFeedClass(analysisMd) !== '업무') {
    body = { ref: String(input.ref), analysis_md: callFeedMinimalAnalysis(analysisMd, input.recordedAt), transcript: '' };
  } else {
    var transcript = callFeedCapBytes(callFeedNfc(input.transcript).trim(), CALL_FEED_TOTAL_MAX_BYTES - callFeedBytes(analysisMd));
    body = { ref: String(input.ref), analysis_md: analysisMd, transcript: transcript };
  }
  var url = input.driveUrl;
  if (typeof url === 'string' && url.length <= 500 && /^https:\/\/(drive|docs)\.google\.com\/[^\s\u0000-\u001f\u007f]*$/.test(url)) body.drive_url = url;
  return body;
}

/** 서버 응답 코드 → 할 일. ok: 다음으로, auth: 멈추고 알림, limit: 다음 실행, drop: 넘김, retry: 다음 실행에 다시. */
function callFeedVerdict(code) {
  if (code === 200) return 'ok';
  if (code === 401) return 'auth';
  if (code === 429) return 'limit';
  if (code === 400 || code === 413) return 'drop';
  return 'retry';
}

// ═════════════════════════════════════════════════════════════════════
// 텔레그램 보내기 (TG-소식메뉴 3-나)
//
// 하는 일: 매일 08:10(07:30 수집이 끝난 뒤) 텔레그램 수집 폴더의 새 메시지 파일을 읽어, 날짜별·방별로 묶어 Web2 서버(collector-feed ?action=telegram)로 보낸다.
//   - 허용 목록(스크립트 속성 TG_FEED_ROOMS)에 적힌 업무방 폴더만 읽는다. 목록이 비어 있으면 아무 방도 읽지 않는다.
//   - 하루가 끝난 날(어제까지)의 메시지만 보낸다. 오늘 날짜 메시지는 내일 보낸다.
//   - 5분 안에서 멈추고, 못 한 방은 10분 뒤 보조 트리거가 이어 한다. 어디까지 했는지는 방마다 "마지막으로 읽은 파일 만든 시각"으로 적는다.
//   - 같은 묶음을 두 번 보내도 서버가 한 번만 저장한다(묶음 이름이 방·날짜·메시지 번호로 정해짐). 보내기에 성공한 묶음까지만 진행 위치를 옮긴다.
//   - 보내는 이는 A, B, C로 바꿔 보낸다(실제 id는 보내지 않는다). Drive 파일은 고치지 않는다. `검토후보` 폴더와 `telegram_ai_review_state_v2`는 읽지도 고치지도 않는다(Q9).
//   - 시험 모드(기본 켬): 아무것도 보내지 않고 개수만 실행 로그에 적는다. 시험용 진행 위치는 따로 적어서 며칠치도 이어서 센다. 실제 진행 위치는 바꾸지 않는다.
//
// 설치 안내: docs/ops/collector-feed-setup.md 텔레그램 절. 설계: docs/design/call-telegram-feed.md 6절.
// 폴더 주소 끝부분·허용 목록은 이 코드에 넣지 않는다(폴더 칸 하나만 아래에 채우고, 목록은 스크립트 속성에만 둔다).
// ═════════════════════════════════════════════════════════════════════

// ── 여기 한 칸만 채운다 (따옴표는 그대로 두고 안쪽만 바꾼다) ─────────────────
// 텔레그램 수집 폴더: Drive에서 "원문" 폴더가 들어 있는 수집 폴더를 열었을 때 주소창 /folders/ 뒤 글자.
var TG_FEED_ROOT_FOLDER = '여기에_텔레그램_수집_폴더_주소_끝부분';
// ─────────────────────────────────────────────────────────────────────

var TG_FEED_ROOMS_KEY = 'TG_FEED_ROOMS';           // 보낼 업무방 허용 목록(쉼표·줄바꿈으로 구분). 방 폴더 이름 앞의 숫자 id 또는 폴더 이름 전체
var TG_FEED_TEST_KEY = 'TG_FEED_TEST_MODE';        // 없거나 '켬'이면 시험 모드. '끔'일 때만 실제로 보낸다
var TG_FEED_STATE_KEY = 'TG_FEED_STATE';           // 어디까지 보냈는지(JSON)
var TG_FEED_RAW_FOLDER = '원문';                   // 수집 폴더 아래 방 폴더들이 있는 폴더
var TG_FEED_MESSAGES_FOLDER = 'messages';          // 방 폴더 아래 월별 폴더(YYYY-MM)가 있는 폴더
var TG_FEED_TIME_LIMIT_MS = 4.5 * 60 * 1000;       // 앱 스크립트 6분 제한 전에 멈춘다
var TG_FEED_CHUNK_START_MAX_MS = 2.5 * 60 * 1000;  // 이 시간이 지나면 새 덩어리를 시작하지 않는다
var TG_FEED_CHUNK_FILES = 120;                     // 한 번에 읽는 파일 수(덩어리). 덩어리가 고정이라 다시 보내도 같은 묶음이 된다
var TG_FEED_MAX_MESSAGES = 300;                    // 서버 TG_LIMITS.messages
var TG_FEED_MAX_TEXT_CHARS = 4000;                 // 서버 TG_LIMITS.messageChars
var TG_FEED_BATCH_BYTES = 120 * 1024;              // 한 묶음 글자 크기(서버 몸통 상한 240 KB 안에서 여유)
var TG_FEED_MAX_TOTAL = 5000;                      // 서버가 받는 하루 메시지 수 상한
var TG_FEED_MAX_PAST_DAYS = 90;                    // 서버 92일 안에서 여유를 둔다
var TG_FEED_MAX_ATTEMPTS = 3;                      // AI·연결 실패를 다시 보내는 횟수(서버 attempt 1~3과 같다)
var TG_FEED_MAX_RESUMES = 12;                      // 하루에 보조 트리거로 이어 하는 최대 횟수
var TG_FEED_RESUME_DELAY_MS = 10 * 60 * 1000;
var TG_FEED_MAX_FAILED_ROOMS = 3;                  // 한 번 실행에서 실패한 방이 이만큼이면 멈춘다

// ── 손으로 [실행]하는 함수 ───────────────────────────────────────────────

/**
 * 처음 한 번: 오늘 0시(한국) 이후 날짜의 메시지부터 보낸다고 적는다(지난 메시지는 보내지 않음).
 * 이미 적혀 있으면 바꾸지 않는다. 시험 모드도 켠 상태로 둔다.
 */
function tgFeed_setup() {
  var props = PropertiesService.getScriptProperties();
  var state = tgFeed_loadState_();
  if (state.since) {
    Logger.log('이미 시작 시각이 있습니다: ' + state.since + ' (바꾸지 않았습니다)');
  } else {
    state.since = new Date(Date.parse(callFeedKstDay(Date.now()) + 'T00:00:00Z') - CALL_FEED_KST_MS).toISOString();
    tgFeed_saveState_(state);
    Logger.log('시작 시각을 적었습니다: ' + state.since + ' — 이 날짜부터의 메시지를 봅니다.');
  }
  if (!props.getProperty(TG_FEED_TEST_KEY)) props.setProperty(TG_FEED_TEST_KEY, '켬');
  tgFeed_check();
}

/** 설정 확인: 폴더·비밀값·허용 목록이 제대로 들어갔는지 본다(방 이름·값은 로그에 찍지 않는다). */
function tgFeed_check() {
  var props = PropertiesService.getScriptProperties();
  var secretLength = (props.getProperty(CALL_FEED_SECRET_KEY) || '').length;   // 길이만 본다. 값은 쓰지 않는다
  var list = tgFeedParseList(props.getProperty(TG_FEED_ROOMS_KEY) || '');
  var rooms = tgFeed_rooms_(list);
  var state = tgFeed_loadState_();
  Logger.log([
    '수집 폴더 안 "' + TG_FEED_RAW_FOLDER + '" 폴더: 찾음',
    '허용 목록: ' + list.length + '개 적음, 폴더에서 찾음 ' + rooms.found.length + '개' + (rooms.found.length < list.length ? ' — 못 찾은 방이 있습니다(안내 텔레그램 3단계)' : ''),
    '비밀값: ' + (secretLength >= 32 ? '있음' : '없음 또는 너무 짧음 — 안내 2단계'),
    '시험 모드: ' + (tgFeed_testMode_() ? '켬(보내지 않음)' : '끔(실제로 보냄)'),
    '시작 시각: ' + (state.since || '없음 — tgFeed_setup을 먼저 실행'),
  ].join('\n'));
}

/** 시험 모드 끄기: 다음 실행부터 실제로 보낸다. 시험용 숫자는 지운다. */
function tgFeed_testModeOff() {
  PropertiesService.getScriptProperties().setProperty(TG_FEED_TEST_KEY, '끔');
  var state = tgFeed_loadState_();
  state.test = { rooms: {}, tally: {} };
  tgFeed_saveState_(state);
  Logger.log('시험 모드를 껐습니다. 다음 실행부터 Web2로 보냅니다.');
}

/** 시험 모드 다시 켜기: 보내기를 멈추고 개수만 센다(시험용 숫자는 처음부터 다시 센다). */
function tgFeed_testModeOn() {
  PropertiesService.getScriptProperties().setProperty(TG_FEED_TEST_KEY, '켬');
  var state = tgFeed_loadState_();
  state.test = { rooms: {}, tally: {} };
  tgFeed_saveState_(state);
  Logger.log('시험 모드를 켰습니다. 보내지 않고 개수만 셉니다.');
}

/** 처음 한 번: 매일 08:10 무렵(한국 시간)에 tgFeed_run을 부르는 트리거를 만든다(있던 같은 트리거는 지우고 하나만 둔다). */
function tgFeed_installDailyTrigger() {
  tgFeed_removeTrigger();
  ScriptApp.newTrigger('tgFeed_run').timeBased().atHour(8).nearMinute(10).everyDays(1).inTimezone('Asia/Seoul').create();
  Logger.log('매일 08:10 무렵 트리거를 만들었습니다.');
}

/** 멈추기·되돌리기: 이 스크립트의 텔레그램 보내기 트리거(매일·이어 하기)만 지운다(통화·전사·분석 트리거는 건드리지 않는다). */
function tgFeed_removeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'tgFeed_run' || fn === 'tgFeed_resume') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('지운 텔레그램 보내기 트리거: ' + removed + '개');
}

// ── 트리거가 부르는 함수 ─────────────────────────────────────────────────

/** 매일 08:10 트리거: 이어 하기 횟수를 0으로 하고 시작한다. */
function tgFeed_run() {
  var state = tgFeed_loadState_();
  state.resumes = 0;
  tgFeed_saveState_(state);
  tgFeed_work_();
}

/** 보조 트리거(10분 뒤): 5분에 못 끝낸 방을 이어서 한다. */
function tgFeed_resume() {
  tgFeed_work_();
}

function tgFeed_work_() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var test = tgFeed_testMode_();
  var secret = props.getProperty(CALL_FEED_SECRET_KEY) || '';
  if (!test && secret.length < 32) throw new Error('스크립트 속성에 ' + CALL_FEED_SECRET_KEY + '가 없습니다. 안내 2단계를 먼저 하세요.');
  var state = tgFeed_loadState_();
  if (!state.since) throw new Error('시작 시각이 없습니다. tgFeed_setup을 먼저 한 번 실행하세요.');
  var list = tgFeedParseList(props.getProperty(TG_FEED_ROOMS_KEY) || '');
  if (!list.length) throw new Error('허용 목록(' + TG_FEED_ROOMS_KEY + ')이 비어 있습니다. 안내 텔레그램 3단계를 먼저 하세요.');
  var found = tgFeed_rooms_(list).found;
  var nowMs = Date.now();
  var todayDay = callFeedKstDay(nowMs);
  var startDay = callFeedKstDay(Date.parse(state.since));
  var oldestDay = tgFeedAddDays(todayDay, -TG_FEED_MAX_PAST_DAYS);
  var tally = { rooms: found.length, roomsDone: 0, files: 0, text: 0, nonText: 0, service: 0, broken: 0, old: 0, batches: 0, sent: 0, kept: 0, duplicate: 0, dropped: 0, retry: 0 };
  var stop = '';
  var failedRooms = 0;
  var order = tgFeedRotate(found.length, state.rotate || 0);
  var stoppedAt = 0;

  for (var oi = 0; oi < order.length && !stop; oi++) {
    var room = found[order[oi]];
    var roomState = test ? (state.test.rooms[room.key] || (state.test.rooms[room.key] = {})) : (state.rooms[room.key] || (state.rooms[room.key] = {}));
    if (typeof roomState.cursor !== 'number') roomState.cursor = Date.parse(state.since);
    var result = tgFeed_doRoom_(room, roomState, { test: test, secret: secret, state: state, started: started, todayDay: todayDay, startDay: startDay, oldestDay: oldestDay, nowMs: nowMs }, tally);
    if (result === 'done') { tally.roomsDone++; continue; }
    stoppedAt = order[oi];
    if (result === 'auth') { tgFeed_saveState_(state); throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.'); }
    if (result === 'time') { stop = '시간 제한'; break; }
    if (result === 'limit') { stop = '서버 상한(429) — 다음 실행에서 이어 보냄'; break; }
    failedRooms++;   // 'fail': 이 방은 다음 실행에서 다시. 다른 방은 계속 본다
    tally.retry++;
    if (failedRooms >= TG_FEED_MAX_FAILED_ROOMS) { stop = '서버·연결 실패 ' + failedRooms + '곳 — 다음 실행에서 다시 보냄'; break; }
  }

  state.rotate = stop ? stoppedAt : 0;
  var willResume = false;
  if (stop === '시간 제한' || (stop && stop.indexOf('실패') >= 0)) {
    if ((state.resumes || 0) < TG_FEED_MAX_RESUMES) { state.resumes = (state.resumes || 0) + 1; willResume = true; }
  }
  if (test) {
    var t = state.test.tally;
    ['files', 'text', 'nonText', 'service', 'broken', 'old', 'batches'].forEach(function (k) { t[k] = (t[k] || 0) + tally[k]; });
  }
  tgFeed_saveState_(state);
  if (willResume) tgFeed_scheduleResume_();

  Logger.log([
    (test ? '[시험 모드 — 보내지 않음] ' : '') + '허용된 방 ' + tally.rooms + '곳 중 끝까지 본 방 ' + tally.roomsDone + '곳, 파일 ' + tally.files + '개 읽음',
    '글 메시지 ' + tally.text + ' · 글 없는 메시지(첨부 등) ' + tally.nonText + ' · 시스템 ' + tally.service + ' · 읽지 못한 파일 ' + tally.broken + ' · 시작일 전이라 넘김 ' + tally.old,
    (test ? '보낼 묶음: ' + tally.batches : '보낸 묶음: ' + tally.sent + ' (저장된 소식 ' + tally.kept + ' · 이미 있음 ' + tally.duplicate + ' · 넘김 ' + tally.dropped + ')') + (tally.retry ? ' · 다시 보낼 방: ' + tally.retry : ''),
    test ? '시험 누계 — 파일 ' + (state.test.tally.files || 0) + ' · 글 ' + (state.test.tally.text || 0) + ' · 글 없음 ' + (state.test.tally.nonText || 0) + ' · 묶음 ' + (state.test.tally.batches || 0) : '',
    stop ? '멈춘 이유: ' + stop + (willResume ? ' (10분 뒤 이어서 합니다)' : '') : '끝까지 봄',
  ].filter(function (l) { return l; }).join('\n'));
}

/**
 * 방 하나를 덩어리(파일 TG_FEED_CHUNK_FILES개)씩 읽고 보낸다.
 * 반환: 'done'(끝까지 봄) | 'time'(시간 제한) | 'limit'(429) | 'auth'(401) | 'fail'(이 방은 다음 실행에 다시)
 */
function tgFeed_doRoom_(room, roomState, ctx, tally) {
  var files = tgFeed_listFiles_(room.folder, roomState.cursor, ctx.nowMs, ctx.started);
  if (files === null) return 'time';
  var idx = 0;
  while (idx < files.length) {
    if (Date.now() - ctx.started > TG_FEED_CHUNK_START_MAX_MS) return 'time';
    var end = tgFeedChunkEnd(files.map(function (f) { return f.created; }), idx, TG_FEED_CHUNK_FILES);
    var infos = [];
    for (var i = idx; i < end; i++) {
      var info;
      try { info = tgFeedParseMessage(JSON.parse(files[i].file.getBlob().getDataAsString('UTF-8'))); }
      catch (e) { info = { kind: 'broken' }; }
      infos.push(info);
    }
    var plan = tgFeedPlanChunk(infos, ctx.todayDay, ctx.startDay, ctx.oldestDay);
    tally.files += plan.consumed;
    tally.text += plan.counts.text; tally.nonText += plan.counts.nonText; tally.service += plan.counts.service;
    tally.broken += plan.counts.broken; tally.old += plan.counts.old;
    var sentOk = true;
    var parts = {}, attemptsDone = [];
    for (var d = 0; d < plan.days.length && sentOk; d++) {
      var g = plan.days[d];
      var startPart = roomState.day === g.day && roomState.part ? roomState.part : 1;
      var batches = tgFeedBuildBatches(g.day, room.key, room.label, g.messages, g.nonText, startPart);
      for (var b = 0; b < batches.length; b++) {
        tally.batches++;
        if (ctx.test) continue;
        if (Date.now() - ctx.started > TG_FEED_TIME_LIMIT_MS) { sentOk = false; var late = 'time'; break; }
        var akey = tgFeedAttemptKey(room.key, g.day, batches[b].messages.length ? batches[b].messages[0].ref : '', batches[b].part);
        batches[b].attempt = Math.min((ctx.state.attempts[akey] || 0) + 1, TG_FEED_MAX_ATTEMPTS);
        var res = callFeed_post_('telegram', batches[b], ctx.secret);
        var verdict = callFeedVerdict(res.code);
        if (verdict === 'ok') {
          var out = res.json || {};
          if (out.duplicate) tally.duplicate++;
          tally.kept += out.kept || 0; tally.sent++;
          delete ctx.state.attempts[akey];
        } else if (verdict === 'auth') {
          return 'auth';
        } else if (verdict === 'limit') {
          tgFeed_saveRoomProgress_(roomState, ctx, files, idx, 0);   // 이미 보낸 묶음 몫의 기록만 남긴다(진행 위치는 그대로)
          return 'limit';
        } else if (verdict === 'drop') {
          tally.dropped++;   // 고쳐도 다시 될 일이 없는 거절(400·413)이다. 이 묶음은 넘긴다
          Logger.log('서버가 거절해 넘김(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
          delete ctx.state.attempts[akey];
        } else {
          ctx.state.attempts[akey] = (ctx.state.attempts[akey] || 0) + 1;
          if (ctx.state.attempts[akey] >= TG_FEED_MAX_ATTEMPTS) {
            Logger.log(TG_FEED_MAX_ATTEMPTS + '번 실패해 넘김(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
            delete ctx.state.attempts[akey];
            tally.dropped++;
          } else { sentOk = false; var late = 'fail'; break; }
        }
        roomState.day = g.day; roomState.part = batches[b].part + 1;
      }
      if (!ctx.test && sentOk) { roomState.day = g.day; roomState.part = Math.max(roomState.part || 1, startPart + batches.length); }
    }
    if (!sentOk) {
      tgFeed_saveState_(ctx.state);   // 시도 횟수를 남긴다. 진행 위치는 옮기지 않으므로 같은 덩어리를 다시 보낸다(서버가 중복을 막는다)
      return late;
    }
    // 덩어리 끝: 읽은 만큼 진행 위치를 옮긴다(오늘 날짜 메시지에서 멈췄다면 그 앞까지).
    if (plan.consumed > 0) roomState.cursor = files[idx + plan.consumed - 1].created;
    if (!ctx.test) tgFeed_saveState_(ctx.state);
    else tgFeed_saveState_(ctx.state);
    if (plan.blocked || plan.consumed === 0) return 'done';   // 오늘 날짜 메시지부터는 내일
    idx += plan.consumed;
  }
  return 'done';
}

function tgFeed_saveRoomProgress_(roomState, ctx) { tgFeed_saveState_(ctx.state); }

// ── Apps Script 도우미 (고칠 필요 없음) ─────────────────────────────────

function tgFeed_testMode_() {
  return PropertiesService.getScriptProperties().getProperty(TG_FEED_TEST_KEY) !== '끔';
}

function tgFeed_loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TG_FEED_STATE_KEY);
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  var test = s.test && typeof s.test === 'object' ? s.test : {};
  return {
    since: typeof s.since === 'string' ? s.since : '',
    rooms: s.rooms && typeof s.rooms === 'object' ? s.rooms : {},
    attempts: s.attempts && typeof s.attempts === 'object' ? s.attempts : {},
    rotate: typeof s.rotate === 'number' ? s.rotate : 0,
    resumes: typeof s.resumes === 'number' ? s.resumes : 0,
    test: { rooms: test.rooms && typeof test.rooms === 'object' ? test.rooms : {}, tally: test.tally && typeof test.tally === 'object' ? test.tally : {} },
  };
}

function tgFeed_saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(TG_FEED_STATE_KEY, JSON.stringify(state));
}

/** 10분 뒤 한 번 tgFeed_resume을 부르는 트리거를 하나만 둔다(이전 것은 지운다). */
function tgFeed_scheduleResume_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tgFeed_resume') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tgFeed_resume').timeBased().after(TG_FEED_RESUME_DELAY_MS).create();
}

/** 수집 폴더/원문 아래 방 폴더 중 허용 목록에 있는 것만 찾는다. 폴더 이름은 로그에 쓰지 않는다. */
function tgFeed_rooms_(list) {
  if (!TG_FEED_ROOT_FOLDER || TG_FEED_ROOT_FOLDER.indexOf('여기에_') === 0) throw new Error('코드 맨 아래 텔레그램 수집 폴더 칸을 채우세요.');
  var root = DriveApp.getFolderById(TG_FEED_ROOT_FOLDER);
  var raw = callFeed_onlyChild_(root, TG_FEED_RAW_FOLDER);
  if (!raw) throw new Error('수집 폴더 안에 "' + TG_FEED_RAW_FOLDER + '" 폴더가 없습니다. 폴더 칸을 확인하세요.');
  var found = [], seen = {};
  var it = raw.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();
    if (!tgFeedRoomAllowed(name, list)) continue;
    var info = tgFeedRoomInfo(name);
    if (!info.key || seen[info.key]) continue;   // 방 id가 서버가 받는 모양이 아니거나 같은 id 폴더가 둘이면 넘긴다
    seen[info.key] = true;
    found.push({ folder: f, key: info.key, label: info.label });
  }
  found.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  return { found: found };
}

/** 방 폴더의 messages/YYYY-MM 아래에서 진행 위치 뒤에 만들어진 .json만, 만든 순서대로. 시간이 모자라면 null. */
function tgFeed_listFiles_(roomFolder, cursorMs, nowMs, started) {
  var messages = callFeed_onlyChild_(roomFolder, TG_FEED_MESSAGES_FOLDER);
  if (!messages) return [];
  var months = tgFeedMonthsBetween(cursorMs, nowMs);
  // 검색은 고친 시각으로 좁히고(초 단위라 2초 여유), 만든 시각은 아래에서 다시 거른다.
  var q = 'trashed = false and modifiedDate > "' + Utilities.formatDate(new Date(cursorMs - 2000), 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + '"';
  var out = [];
  for (var m = 0; m < months.length; m++) {
    var it0 = messages.getFoldersByName(months[m]);
    if (!it0.hasNext()) continue;
    var it = it0.next().searchFiles(q);
    while (it.hasNext()) {
      if (Date.now() - started > TG_FEED_TIME_LIMIT_MS) return null;
      var f = it.next();
      if (!/\.json$/i.test(f.getName())) continue;
      var created = f.getDateCreated().getTime();
      if (created > cursorMs) out.push({ file: f, created: created, name: f.getName() });
    }
  }
  out.sort(function (a, b) { return a.created - b.created || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  return out;
}

// ── 순수 함수 (네트워크·Drive 없음, tests/security/collector-feed-tg-gas.test.mjs가 시험) ──────────

/** 허용 목록 글을 항목으로 나눈다. 쉼표·세미콜론·줄바꿈으로 구분, NFC, 앞뒤 빈칸 제거, 중복 제거. */
function tgFeedParseList(text) {
  var out = [];
  callFeedNfc(text).split(/[,;\n\r]+/).forEach(function (item) {
    var v = callFeedNormalizeName(item);
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  return out;
}

/** 방 폴더 이름 `<숫자 id>_<표시 이름>`에서 서버로 보낼 방 키(id)와 표시 이름. 키가 서버 모양(영문·숫자·_ . : -)이 아니면 key는 빈 글. */
function tgFeedRoomInfo(folderName) {
  var name = callFeedNormalizeName(folderName);
  var cut = name.indexOf('_');
  var id = cut > 0 ? name.slice(0, cut) : name;
  var label = (cut > 0 ? name.slice(cut + 1) : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  label = Array.from(label).slice(0, 100).join('') || '대화방';
  return { key: /^[A-Za-z0-9_.:-]{1,100}$/.test(id) ? id : '', label: label };
}

/** 폴더 이름이 허용 목록에 있나. 목록 항목은 폴더 이름 앞의 id 또는 폴더 이름 전체와 글자 그대로 같을 때만 맞는다. */
function tgFeedRoomAllowed(folderName, list) {
  if (!list || !list.length) return false;
  var name = callFeedNormalizeName(folderName);
  var id = tgFeedRoomInfo(name).key;
  return list.indexOf(name) >= 0 || (id !== '' && list.indexOf(id) >= 0);
}

function tgFeedAddDays(day, n) {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** cursorMs가 속한 한국 달부터 nowMs가 속한 달까지 'YYYY-MM' 목록(월이 바뀌는 날은 전달도 본다). */
function tgFeedMonthsBetween(cursorMs, nowMs) {
  var first = callFeedKstDay(cursorMs).slice(0, 7), last = callFeedKstDay(nowMs).slice(0, 7), out = [];
  var y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
  for (var guard = 0; guard < 120; guard++) {
    var key = y + '-' + (m < 10 ? '0' : '') + m;
    out.push(key);
    if (key >= last) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** 시간 값 두 칸(date_utc, date_kst) 중 쓸 수 있는 것을 ms로. date_kst에 시간대 표시가 없으면 한국 시각으로 본다. */
function tgFeedMessageTime(utc, kst) {
  function parse(v, assumeKst) {
    if (typeof v !== 'string') return NaN;
    var s = v.trim();
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return NaN;
    s = s.replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += assumeKst ? '+09:00' : 'Z';
    return Date.parse(s);
  }
  var a = parse(utc, false);
  return Number.isFinite(a) ? a : parse(kst, true);
}

/**
 * 메시지 파일 하나(JSON 객체)를 읽는다. kind:
 * - 'text': 글이 있다 → {ref, at, day, text, replyTo, forwarded, senderId}
 * - 'nonText': 글 없이 첨부만 있다(개수에만 더한다) → {day}
 * - 'service': 시스템 메시지(건너뜀) → {day}
 * - 'broken': 읽을 수 없는 모양(시간·번호 없음) → 개수만
 */
function tgFeedParseMessage(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { kind: 'broken' };
  var at = tgFeedMessageTime(obj.date_utc, obj.date_kst);
  if (!Number.isFinite(at)) return { kind: 'broken' };
  var day = callFeedKstDay(at);
  if (obj.service_action) return { kind: 'service', day: day };
  var text = typeof obj.text === 'string' ? callFeedNfc(obj.text) : '';
  if (!text.trim()) return { kind: 'nonText', day: day };
  var ref = obj.message_id == null ? '' : String(obj.message_id);
  if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(ref)) return { kind: 'broken' };
  var reply = obj.reply_to_message_id == null ? null : String(obj.reply_to_message_id);
  if (reply !== null && !/^[A-Za-z0-9_.:-]{1,40}$/.test(reply)) reply = null;
  return {
    kind: 'text', ref: ref, at: at, day: day,
    text: Array.from(text).slice(0, TG_FEED_MAX_TEXT_CHARS).join(''),
    replyTo: reply, forwarded: obj.forwarded === true || (obj.forwarded && typeof obj.forwarded === 'object') ? true : false,
    senderId: obj.sender_id == null ? '' : String(obj.sender_id),
  };
}

/** 덩어리 끝 위치: start에서 size개를 잡되, 만든 시각이 같은 파일이 경계에서 갈리지 않게 같은 시각까지 늘린다. */
function tgFeedChunkEnd(createds, start, size) {
  var end = Math.min(createds.length, start + size);
  while (end < createds.length && createds[end] === createds[end - 1]) end++;
  return end;
}

/**
 * 읽은 덩어리(파일 순서)를 날짜별로 묶는다.
 * - 오늘 날짜(이후) 메시지를 만나면 거기서 멈춘다(blocked, 그 파일부터는 소비하지 않는다. 하루가 끝난 뒤 보낸다).
 * - 시작일 전, 또는 서버가 받는 범위(oldestDay)보다 오래된 날짜는 보내지 않고 넘긴다(old).
 * 반환: {consumed, blocked, days:[{day, messages, nonText}] (날짜 오름차순), counts}
 */
function tgFeedPlanChunk(infos, todayDay, startDay, oldestDay) {
  var counts = { text: 0, nonText: 0, service: 0, broken: 0, old: 0 };
  var byDay = {}, consumed = 0, blocked = false;
  for (var i = 0; i < infos.length; i++) {
    var m = infos[i];
    if (m.kind === 'broken') { counts.broken++; consumed++; continue; }
    if (m.day >= todayDay) { blocked = true; break; }
    consumed++;
    if (m.day < startDay || m.day < oldestDay) { counts.old++; continue; }
    var g = byDay[m.day] || (byDay[m.day] = { day: m.day, messages: [], nonText: 0, seen: {} });
    if (m.kind === 'service') { counts.service++; continue; }
    if (m.kind === 'nonText') { counts.nonText++; g.nonText++; continue; }
    if (g.seen[m.ref]) continue;   // 같은 번호는 한 번만(수정된 메시지 등)
    g.seen[m.ref] = true;
    counts.text++;
    g.messages.push(m);
  }
  var days = Object.keys(byDay).sort().map(function (d) { var g = byDay[d]; return { day: g.day, messages: g.messages, nonText: g.nonText }; });
  return { consumed: consumed, blocked: blocked, days: days, counts: counts };
}

/** 보내는 이 id를 A, B, … Z, AA, … 로 바꾼다(첫 등장 순서, 최대 세 글자). */
function tgFeedSenderLabel(n) {
  var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (n < 26) return a[n];
  if (n < 26 + 676) { var k = n - 26; return a[Math.floor(k / 26)] + a[k % 26]; }
  return 'ZZZ';
}

/**
 * 하루치(한 방) 메시지를 서버 POST ?action=telegram 몸통 목록으로 만든다(handler.ts parseTelegramBody와 같은 칸만).
 * - 메시지는 시각·번호 순서. 300개 또는 TG_FEED_BATCH_BYTES를 넘기 전에 다음 묶음으로 나눈다.
 * - 첫 묶음(part 1)의 total은 그날 글 있는 메시지 + 글 없는 메시지 수. 서버는 total을 part 1에서만 센다.
 * - 글 있는 메시지가 없고 글 없는 메시지만 있으면 메시지가 빈 묶음 하나(개수만).
 * - 보내는 이는 이 함수 안에서 A, B, C로 바꾼다. 실제 id는 몸통에 없다.
 */
function tgFeedBuildBatches(day, roomKey, roomLabel, messages, nonText, startPart) {
  var sorted = messages.slice().sort(function (x, y) {
    return x.at - y.at || (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0);
  });
  var senders = {}, nextSender = 0;
  var rows = sorted.map(function (m) {
    if (!(m.senderId in senders)) senders[m.senderId] = tgFeedSenderLabel(nextSender++);
    var row = { ref: m.ref, at: new Date(m.at).toISOString(), sender: senders[m.senderId], text: m.text };
    if (m.replyTo) row.reply_to = m.replyTo;
    if (m.forwarded) row.forwarded = true;
    return row;
  });
  var groups = [], cur = [], bytes = 0;
  rows.forEach(function (r) {
    var size = callFeedBytes(r.text) + 120;
    if (cur.length && (cur.length >= TG_FEED_MAX_MESSAGES || bytes + size > TG_FEED_BATCH_BYTES)) { groups.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += size;
  });
  if (cur.length) groups.push(cur);
  if (!groups.length) { if (!nonText) return []; groups.push([]); }
  var total = Math.min(rows.length + nonText, TG_FEED_MAX_TOTAL);
  var first = Math.max(1, startPart || 1);
  return groups.map(function (g, i) {
    var part = Math.min(first + i, 50);
    return { day: day, room_key: roomKey, room_label: roomLabel, total: first === 1 && i === 0 ? Math.max(total, g.length) : g.length, part: part, messages: g };
  });
}

function tgFeedAttemptKey(roomKey, day, firstRef, part) { return roomKey + '|' + day + '|' + firstRef + '|' + part; }

/** 방을 도는 순서: start번째 방부터 한 바퀴(앞에서 시간 제한으로 멈춘 방부터 이어 하기 위해). */
function tgFeedRotate(n, start) {
  var out = [];
  for (var i = 0; i < n; i++) out.push((start + i) % n);
  return out;
}

// node 시험에서만 쓰는 내보내기(앱 스크립트에는 module이 없어서 아무 일도 하지 않는다).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    callFeedNormalizeNumber: callFeedNormalizeNumber, callFeedNormalizeName: callFeedNormalizeName, callFeedParseList: callFeedParseList,
    callFeedTranscriptName: callFeedTranscriptName, callFeedIsPersonal: callFeedIsPersonal, callFeedKstDay: callFeedKstDay,
    callFeedDayInRange: callFeedDayInRange, callFeedBytes: callFeedBytes, callFeedCapBytes: callFeedCapBytes,
    callFeedAnalysisName: callFeedAnalysisName, callFeedMinimalAnalysis: callFeedMinimalAnalysis,
    callFeedFrontmatter: callFeedFrontmatter, callFeedClass: callFeedClass,
    callFeedBuildCallBody: callFeedBuildCallBody, callFeedVerdict: callFeedVerdict,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.tgFeedParseList = tgFeedParseList;
  module.exports.tgFeedRoomInfo = tgFeedRoomInfo;
  module.exports.tgFeedRoomAllowed = tgFeedRoomAllowed;
  module.exports.tgFeedAddDays = tgFeedAddDays;
  module.exports.tgFeedMonthsBetween = tgFeedMonthsBetween;
  module.exports.tgFeedMessageTime = tgFeedMessageTime;
  module.exports.tgFeedParseMessage = tgFeedParseMessage;
  module.exports.tgFeedChunkEnd = tgFeedChunkEnd;
  module.exports.tgFeedPlanChunk = tgFeedPlanChunk;
  module.exports.tgFeedSenderLabel = tgFeedSenderLabel;
  module.exports.tgFeedBuildBatches = tgFeedBuildBatches;
  module.exports.tgFeedAttemptKey = tgFeedAttemptKey;
  module.exports.tgFeedRotate = tgFeedRotate;
}
