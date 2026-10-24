/**
 * Web2 수집 보내기 — 통화 부분 (CALL-통화메뉴 3-가)
 *
 * 하는 일: 1시간마다 새 통화 전사 txt와 그 통화 분석 파일(검토__…md)을 찾아 Web2 서버(collector-feed)로 한 건씩 보낸다.
 *   - 개인 번호·연락처 목록(스크립트 속성 CALL_FEED_PERSONAL_LIST)에 있는 통화는 분석 파일을 읽지도 보내지도 않고 개수만 보낸다.
 *   - 분석이 아직 없으면 기다린다(24시간 넘게 없으면 건너뛴다).
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

// ═══════════════════════════════════════════════════════════════════════
// 텔레그램 보내기 (TG-소식메뉴 3-나)
//
// 하는 일: 매일 08:10에 "어제까지 끝난 날"의 텔레그램 메시지를 방별·날짜별로 묶어 Web2 서버(collector-feed ?action=telegram)로 보낸다.
//   - 허용 목록(스크립트 속성 TG_FEED_ROOMS)에 적은 업무방 폴더만 읽는다. 목록에 없는 방(개인 수집 포함)은 열지 않는다.
//   - 오늘 날짜는 보내지 않는다(하루가 끝난 날만). 같은 방·같은 날은 한 번만 보낸다(방별 doneDay).
//   - 한 번에 4.5분 안에서 멈추고, 남은 일은 10분 뒤 이어 하기 트리거가 이어서 한다(하루 12번까지). 못 한 날은 다음 날 08:10에도 이어진다.
//   - 어디까지 보냈는지는 스크립트 속성(TG_FEED_STATE)에만 적는다. Drive 파일(원문·검토후보·telegram_ai_review_state_v2)은 읽기만 하고 고치지 않는다(Q9).
//   - 시험 모드(기본 켬): 서버로 보내지 않고 방·날짜별 개수만 실행 로그에 적는다. 어디까지 보냈는지도 바꾸지 않는다.
//   - 보내는 이(sender_id)는 방·날짜마다 A, B, C 같은 임시 이름으로 바꿔 보낸다. 실제 값은 서버로 가지 않는다.
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
var TG_FEED_STATE_KEY = 'TG_FEED_STATE';        // 어디까지 보냈는지(JSON)
var TG_FEED_TIME_LIMIT_MS = 4.5 * 60 * 1000;    // 앱 스크립트 6분 제한 전에 새 일을 시작하지 않는다
var TG_FEED_CONTINUE_MS = 10 * 60 * 1000;       // 이어 하기 트리거 간격
var TG_FEED_MAX_CHAIN = 12;                     // 하루에 이어 하기를 부르는 최대 횟수
var TG_FEED_WINDOW_DAYS = 3;                    // 그 날 메시지 파일은 그 날 0시부터 3일 안에 고쳐진 것으로 본다(수집이 하루 늦어도 잡힘)
var TG_FEED_MAX_MESSAGES = 300;                 // 서버 한 묶음 상한(TG_LIMITS.messages)
var TG_FEED_MAX_CHARS = 4000;                   // 서버 메시지 글자 상한(TG_LIMITS.messageChars)
var TG_FEED_MAX_BODY_BYTES = 200 * 1024;        // 서버 몸통 상한 240 KB보다 작게 쪼갠다
var TG_FEED_MAX_TOTAL = 5000;                   // 서버가 받는 하루 메시지 수 상한
var TG_FEED_MAX_ATTEMPTS = 3;                   // 한 묶음을 다시 보내는 횟수(서버 attempt 1~3과 같다)

// ── 손으로 [실행]하는 함수 ───────────────────────────────────────────────

/**
 * 처음 한 번: 오늘(한국 날짜)부터 보낸다고 적는다. 그 전 날짜는 보내지 않는다.
 * 이미 적혀 있으면 바꾸지 않는다. 시험 모드도 켠 상태로 둔다.
 */
function tgFeed_setup() {
  var props = PropertiesService.getScriptProperties();
  var state = tgFeed_loadState_();
  if (state.startDay) {
    Logger.log('이미 시작 날짜가 있습니다: ' + state.startDay + ' (바꾸지 않았습니다)');
  } else {
    state.startDay = callFeedKstDay(Date.now());
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
  ].join('\n'));
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

/** 처음 한 번: 매일 08:10경 tgFeed_run을 부르는 트리거를 만든다(있던 같은 트리거는 지우고 하나만 둔다). */
function tgFeed_installDailyTrigger() {
  tgFeed_removeTrigger();
  ScriptApp.newTrigger('tgFeed_run').timeBased().atHour(8).nearMinute(10).everyDays(1).create();
  Logger.log('매일 08:10 트리거를 만들었습니다(앱 스크립트 특성상 08:10~08:25 사이에 돕니다).');
}

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

/** 매일 08:10 트리거. 이어 하기 횟수를 0으로 되돌리고 시작한다. */
function tgFeed_run() { tgFeed_runCore_(false); }

/** 이어 하기 트리거(10분 뒤 한 번). 이어 하기 횟수를 1 올리고, 한도(12번)가 넘으면 멈춘다. */
function tgFeed_continue() { tgFeed_runCore_(true); }

function tgFeed_runCore_(isContinue) {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('다른 텔레그램 보내기가 돌고 있어 이번에는 건너뜁니다.'); return; }
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
      if (!test) tgFeed_saveState_(state);
      Logger.log('이어 하기 한도(' + TG_FEED_MAX_CHAIN + '번)를 넘어 오늘은 여기서 멈춥니다. 내일 08:10에 이어서 합니다.');
      return;
    }
    var wanted = tgFeedParseRooms(props.getProperty(TG_FEED_ROOMS_KEY) || '');
    if (!wanted.length) throw new Error('허용 방 목록(' + TG_FEED_ROOMS_KEY + ')이 비어 있습니다. 안내 2단계를 먼저 하세요.');
    var found = tgFeed_rooms_(wanted);
    var today = callFeedKstDay(Date.now());
    var tally = { rooms: found.rooms.length, days: 0, parts: 0, messages: 0, noText: 0, kept: 0, duplicate: 0, skipped: 0, failed: 0, retry: 0 };
    var stop = '';
    var resumable = false;

    for (var r = 0; r < found.rooms.length && !stop; r++) {
      var room = found.rooms[r];
      var rs = tgFeedRoomState(state, room.key);
      var days = tgFeedPendingDays(rs.doneDay, state.startDay, today);
      for (var d = 0; d < days.length && !stop; d++) {
        var day = days[d];
        if (Date.now() - started > TG_FEED_TIME_LIMIT_MS) { stop = '시간 제한'; resumable = true; break; }
        var read = tgFeed_readDay_(room, day, started);
        if (read.timedOut) { stop = '시간 제한(읽는 중) — 이 날은 다음 실행에서 처음부터 다시 읽음'; resumable = true; break; }
        var grouped = tgFeedGroupDay(read.parsed, day);
        tally.days++;
        tally.messages += grouped.messages.length;
        tally.noText += grouped.total - grouped.messages.length;
        var parts = tgFeedSplit(tgFeedAssignSenders(grouped.messages));
        var skipParts = tgFeedPartsToSkip(rs, day);
        if (test) { tally.parts += parts.length; Logger.log('[시험] ' + room.label + ' ' + day + ': 전체 ' + grouped.total + '개 중 글 있는 ' + grouped.messages.length + '개, 묶음 ' + parts.length + '개'); continue; }
        for (var p = skipParts; p < parts.length; p++) {
          if (Date.now() - started > TG_FEED_TIME_LIMIT_MS) { stop = '시간 제한'; resumable = true; break; }
          var akey = room.key + '|' + day + '|' + (p + 1);
          var attempt = (state.attempts[akey] || 0) + 1;
          var body = tgFeedBuildBody({ day: day, roomKey: room.key, roomLabel: room.label, total: grouped.total, part: p + 1, attempt: attempt, messages: parts[p] });
          var res = tgFeed_post_(body, secret);
          var verdict = tgFeedVerdict(res.code, res.json && res.json.error);
          if (verdict === 'ok') {
            var out = res.json || {};
            if (out.duplicate) tally.duplicate++;
            tally.kept += out.kept || 0;
            tally.parts++;
            delete state.attempts[akey];
            rs = tgFeedAfterPart(rs, day, p, parts.length);
            state.rooms[room.key] = rs;
            tgFeed_saveState_(state);   // 묶음마다 저장 — 중간에 멈춰도 같은 묶음을 두 번 보내지 않는다
          } else if (verdict === 'auth') {
            tgFeed_saveState_(state);
            throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
          } else if (verdict === 'limit') {
            stop = '서버 하루 상한 또는 이번 달 AI 상한(429) — 내일 08:10에 이어 보냄'; break;
          } else if (verdict === 'pause') {
            stop = '서버 준비 안 됨(HTTP ' + res.code + ' ' + (res.json && res.json.error || '') + ') — 내일 08:10에 다시 시도'; break;
          } else if (verdict === 'drop') {
            tally.skipped++;
            Logger.log('서버가 거절해 넘김: ' + room.key + ' ' + day + ' 묶음 ' + (p + 1) + ' (HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
            delete state.attempts[akey];
            rs = tgFeedAfterPart(rs, day, p, parts.length);
            state.rooms[room.key] = rs;
            tgFeed_saveState_(state);
          } else {
            state.attempts[akey] = attempt;
            if (attempt >= TG_FEED_MAX_ATTEMPTS) {
              Logger.log(TG_FEED_MAX_ATTEMPTS + '번 실패해 넘김: ' + room.key + ' ' + day + ' 묶음 ' + (p + 1) + ' (HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ')');
              tally.failed++;
              delete state.attempts[akey];
              rs = tgFeedAfterPart(rs, day, p, parts.length);
              state.rooms[room.key] = rs;
              tgFeed_saveState_(state);
            } else {
              tally.retry++;
              tgFeed_saveState_(state);
              stop = '서버·연결 실패(HTTP ' + res.code + (res.json && res.json.error ? ' ' + res.json.error : '') + ') — 10분 뒤 같은 묶음을 다시 보냄'; resumable = true; break;
            }
          }
        }
        if (stop) break;
        if (!parts.length && !grouped.total) {   // 그 날 파일이 하나도 없으면 보낼 것이 없다. 끝난 날로만 적는다
          rs = tgFeedAfterPart(rs, day, 0, 1); state.rooms[room.key] = rs; tgFeed_saveState_(state);
        } else if (!parts.length) {   // 글 있는 메시지가 없는 날(첨부만 등)은 개수만 서버에 알린다(서버는 AI를 부르지 않고 개수만 센다)
          var emptyRes = tgFeed_post_(tgFeedBuildBody({ day: day, roomKey: room.key, roomLabel: room.label, total: grouped.total, part: 1, attempt: 1, messages: [] }), secret);
          var ev = tgFeedVerdict(emptyRes.code, emptyRes.json && emptyRes.json.error);
          if (ev === 'ok' || ev === 'drop') { rs = tgFeedAfterPart(rs, day, 0, 1); state.rooms[room.key] = rs; tgFeed_saveState_(state); }
          else if (ev === 'auth') throw new Error('비밀값 불일치(401) — 스크립트 속성 값과 Supabase COLLECTOR_FEED_SECRET이 같은지 확인하세요.');
          else { stop = '서버 응답 이상(HTTP ' + emptyRes.code + ') — 다음 실행에서 다시 시도'; resumable = emptyRes.code === 0 || emptyRes.code >= 500; }
        }
      }
    }

    if (!test) {
      if (resumable && state.chain < TG_FEED_MAX_CHAIN) {
        ScriptApp.newTrigger('tgFeed_continue').timeBased().after(TG_FEED_CONTINUE_MS).create();
        stop += ' (10분 뒤 이어 하기 예약)';
      }
      tgFeed_saveState_(state);
    }
    Logger.log([
      (test ? '[시험 모드 — 보내지 않음] ' : '') + '방 ' + tally.rooms + '개, 날짜 ' + tally.days + '건 확인',
      '메시지: 글 있는 것 ' + tally.messages + '개 · 글 없는 것(첨부만 있음) ' + tally.noText + '개',
      (test ? '보낼 묶음: ' : '보낸 묶음: ') + tally.parts + (test ? '' : ' (소식 ' + tally.kept + '개 저장 · 이미 있음 ' + tally.duplicate + ' · 넘김 ' + tally.skipped + ' · 3번 실패 ' + tally.failed + (tally.retry ? ' · 다시 보낼 것 ' + tally.retry : '') + ')'),
      found.missing.length ? '못 찾은 허용 방: ' + found.missing.join(' / ') : '허용 방 모두 찾음',
      stop ? '멈춘 이유: ' + stop : '끝까지 봄',
    ].join('\n'));
  } finally {
    lock.releaseLock();
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
    rooms: s.rooms && typeof s.rooms === 'object' ? s.rooms : {},
    attempts: s.attempts && typeof s.attempts === 'object' ? s.attempts : {},
    chain: typeof s.chain === 'number' ? s.chain : 0,
  };
}

function tgFeed_saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(TG_FEED_STATE_KEY, JSON.stringify(state));
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

/** 한 방의 한 날짜 메시지 파일을 읽어 정리한다. 그 날 0시부터 3일 안에 고쳐진 json만 열고, 날짜는 파일 안 값으로 다시 거른다. */
function tgFeed_readDay_(room, day, started) {
  var out = { parsed: [], timedOut: false };
  var msgFolder = callFeed_onlyChild_(room.folder, TG_FEED_MESSAGES_FOLDER);
  if (!msgFolder) return out;
  var win = tgFeedWindow(day);
  var q = 'trashed = false and modifiedDate > "' + Utilities.formatDate(new Date(win.fromMs), 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + '"' +
    ' and modifiedDate < "' + Utilities.formatDate(new Date(win.toMs), 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + '"';
  var months = tgFeedMonths(day);
  for (var m = 0; m < months.length; m++) {
    var mf = callFeed_onlyChild_(msgFolder, months[m]);
    if (!mf) continue;
    var it = mf.searchFiles(q);
    while (it.hasNext()) {
      if (Date.now() - started > TG_FEED_TIME_LIMIT_MS + 60 * 1000) { out.timedOut = true; return out; }
      var f = it.next();
      if (!/\.json$/i.test(f.getName())) continue;
      var parsed = null;
      try { parsed = tgFeedParseMessage(JSON.parse(f.getBlob().getDataAsString('UTF-8').replace(/^﻿/, ''))); } catch (e) { parsed = null; }
      if (parsed) out.parsed.push(parsed);
    }
  }
  return out;
}

function tgFeed_post_(body, secret) {
  var headers = {};
  headers[CALL_FEED_SECRET_HEADER] = secret;
  try {
    var res = UrlFetchApp.fetch(CALL_FEED_URL + '?action=telegram', {
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
 * 반환: null(읽을 수 없음) 또는 {id, day, at(ISO), text, hasText, service, senderId, replyTo, forwarded}.
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
  return {
    id: id, day: callFeedKstDay(ms), at: new Date(ms).toISOString(),
    text: Array.from(text).slice(0, TG_FEED_MAX_CHARS).join(''), hasText: !service && text.length > 0, service: service,
    senderId: sender, replyTo: replyTo, forwarded: !!obj.forwarded,
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
  return { total: Math.min(all.length, TG_FEED_MAX_TOTAL), messages: msgs };
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
  return body;
}

/** 방 상태: 끝낸 마지막 날짜(doneDay)와, 그 다음 날짜를 묶음 몇 개까지 보냈는지(partDay·partsDone). */
function tgFeedRoomState(state, key) {
  var r = state.rooms && state.rooms[key] || {};
  return {
    doneDay: /^\d{4}-\d{2}-\d{2}$/.test(r.doneDay || '') ? r.doneDay : tgFeedAddDays(state.startDay, -1),
    partDay: /^\d{4}-\d{2}-\d{2}$/.test(r.partDay || '') ? r.partDay : '',
    partsDone: typeof r.partsDone === 'number' && r.partsDone > 0 ? Math.floor(r.partsDone) : 0,
  };
}

/** 보낼 날짜 목록: 끝낸 날 다음부터 어제(한국)까지. 시작 날짜 앞과 서버가 받는 92일보다 오래된 날은 뺀다. 오늘은 아직 끝나지 않아 뺀다. */
function tgFeedPendingDays(doneDay, startDay, today) {
  var first = tgFeedAddDays(doneDay, 1);
  if (first < startDay) first = startDay;
  var oldest = tgFeedAddDays(today, -CALL_FEED_MAX_PAST_DAYS);
  if (first < oldest) first = oldest;
  var last = tgFeedAddDays(today, -1);
  var out = [];
  for (var d = first; d <= last && out.length < 93; d = tgFeedAddDays(d, 1)) out.push(d);
  return out;
}

/** 이 날짜에서 이미 보낸 묶음 수(이어 하기). 다른 날짜의 기록이면 0. */
function tgFeedPartsToSkip(roomState, day) {
  return roomState.partDay === day ? roomState.partsDone : 0;
}

/** 묶음 하나(0부터)를 보낸 뒤의 방 상태. 마지막 묶음이면 그 날을 끝낸 날로, 아니면 몇 개까지 보냈는지만 적는다. */
function tgFeedAfterPart(roomState, day, partIndex, partCount) {
  if (partIndex + 1 >= partCount) return { doneDay: day, partDay: '', partsDone: 0 };
  return { doneDay: roomState.doneDay, partDay: day, partsDone: partIndex + 1 };
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

/** 서버 응답 → 할 일. ok·auth·limit(429)·drop(400·413)은 통화와 같다. pause: 서버 준비 문제(AI 열쇠 없음 503, DB 연결 503)는 횟수에 세지 않고 멈춘다. 나머지는 retry. */
function tgFeedVerdict(code, errorCode) {
  if (code === 200) return 'ok';
  if (code === 401) return 'auth';
  if (code === 429) return 'limit';
  if (code === 400 || code === 413) return 'drop';
  if (code === 503 && (errorCode === 'AI_NOT_CONFIGURED' || errorCode === 'DB_UNAVAILABLE')) return 'pause';
  return 'retry';
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
    tgFeedAddDays: tgFeedAddDays, tgFeedParseRooms: tgFeedParseRooms, tgFeedRoomMatch: tgFeedRoomMatch, tgFeedRoomPick: tgFeedRoomPick, tgFeedRoomInfo: tgFeedRoomInfo,
    tgFeedParseTime: tgFeedParseTime, tgFeedParseMessage: tgFeedParseMessage, tgFeedGroupDay: tgFeedGroupDay, tgFeedSenderName: tgFeedSenderName,
    tgFeedAssignSenders: tgFeedAssignSenders, tgFeedSplit: tgFeedSplit, tgFeedBuildBody: tgFeedBuildBody, tgFeedRoomState: tgFeedRoomState,
    tgFeedPendingDays: tgFeedPendingDays, tgFeedPartsToSkip: tgFeedPartsToSkip, tgFeedAfterPart: tgFeedAfterPart, tgFeedWindow: tgFeedWindow,
    tgFeedMonths: tgFeedMonths, tgFeedVerdict: tgFeedVerdict,
  };
}
