/**
 * Web2 수집 보내기 — 통화 부분 (CALL-통화메뉴 3-가)
 *
 * 하는 일: 1시간마다 새 통화 전사 txt와 그 통화 분석 파일(검토__…md)을 찾아 Web2 서버(collector-feed)로 한 건씩 보낸다.
 *   - 개인 번호·연락처 목록(스크립트 속성 CALL_FEED_PERSONAL_LIST)에 있는 통화는 분석 파일을 읽지도 보내지도 않고 개수만 보낸다.
 *   - 분석이 아직 없으면 기다린다(24시간 넘게 없으면 건너뛴다).
 *   - 어디까지 보냈는지는 이 스크립트의 스크립트 속성(CALL_FEED_STATE)에만 적는다. Drive 파일은 고치지 않는다.
 *     분석 파일의 status, Drive 파일 설명도 건드리지 않는다(Q13).
 *   - 시험 모드(기본 켬): 아무것도 보내지 않고 개수만 실행 로그에 적는다. 어디까지 보냈는지도 바꾸지 않는다.
 * 텔레그램 부분(3-나)은 아직 없다.
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

/** 설정 확인: 폴더·비밀값·목록이 제대로 들어갔는지 본다(값은 로그에 찍지 않는다). */
function callFeed_check() {
  var props = PropertiesService.getScriptProperties();
  var secretLength = (props.getProperty(CALL_FEED_SECRET_KEY) || '').length;   // 길이만 본다. 값은 쓰지 않는다
  var list = callFeedParseList(props.getProperty(CALL_FEED_LIST_KEY) || '');
  var folders = callFeed_folders_();
  Logger.log([
    '전사 폴더: 찾음',
    '분석 폴더: ' + folders.analysis.length + '개 찾음(' + CALL_FEED_ANALYSIS_FOLDERS.join('·') + ')',
    '비밀값: ' + (secretLength >= 32 ? '있음' : '없음 또는 너무 짧음 — 안내 3단계'),
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
  if (!test && secret.length < 32) throw new Error('스크립트 속성에 ' + CALL_FEED_SECRET_KEY + '가 없습니다. 안내 3단계를 먼저 하세요.');
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
      if (cls === '실패') tally.failed++; else if (cls === '업무') tally.work++; else if (cls === '개인') tally.personal++; else if (cls === '애매') tally.unsure++; else tally.noClass++;
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
      (test ? ' · 구분 없음(분석 안내문 수정 전) ' + tally.noClass + ' · 분석 실패 ' + tally.failed : ' · 판정 실패 ' + tally.failed + ' · 이미 있음 ' + tally.duplicate) + ')',
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
 * 분석 파일의 구분: '업무' | '개인' | '애매' | '구분없음' | '실패'.
 * - work_class 칸(안내문 수정 3.3부터)을 그대로 쓴다.
 * - work_class가 없는 3.2 파일: is_work_related: false(개인 기록 파일)만 '개인'으로 본다. 나머지는 '구분없음'(서버는 애매로 센다).
 * - 분석 스크립트가 남긴 "분석실패" 기록은 '실패'.
 */
function callFeedClass(md) {
  var meta = callFeedFrontmatter(md);
  if (meta.status === '분석실패') return '실패';
  var w = (meta.work_class || '').replace(/\s/g, '');
  if (w === '업무' || w === '개인' || w === '애매') return w;
  if (!w && String(meta.is_work_related).trim() === 'false') return '개인';
  return '구분없음';
}

/** `## 상대 이름·직책` 절의 `- 이름: …`, `- 직책: …`, `- 소속: …`. */
function callFeedCounterpartFields(md) {
  var lines = String(md || '').split(/\r?\n/), inSection = false, out = { name: '', role: '', org: '' };
  for (var i = 0; i < lines.length; i++) {
    var h = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
    if (h) { inSection = h[1].replace(/[\s·‧・/:：()（）]/g, '') === '상대이름직책'; continue; }
    if (!inSection) continue;
    var kv = /^\s*[-*]\s*(이름|직책|소속)\s*[:：]\s*(.+?)\s*$/.exec(lines[i]);
    if (!kv) continue;
    var key = kv[1] === '이름' ? 'name' : kv[1] === '직책' ? 'role' : 'org';
    if (!out[key]) out[key] = kv[2];
  }
  return out;
}

/**
 * 전문 줄 머리에 쓸 상대 표기(Q11): `소속조직 이름 직책`. 이름을 모르면 '상대'.
 * 줄 머리 모양을 깨는 글자(콜론·줄바꿈)와 번호처럼 보이는 글은 쓰지 않는다. 60자까지.
 */
function callFeedCounterpartLabel(fields, contact) {
  var clean = function (v) {
    var s = callFeedNfc(v).replace(/[\u0000-\u001f\u007f:：]/g, ' ').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
    return /^(없음|확인\s*필요|확인\s*불가|미상|불명|-)$/.test(s) ? '' : s;
  };
  var name = clean(fields && fields.name), role = clean(fields && fields.role), org = clean(fields && fields.org);
  // 분석에 이름이 없으면 전사 파일 이름의 연락처 이름(번호가 아닐 때만)을 쓴다.
  if (!name && contact && !callFeedNormalizeNumber(contact)) { name = clean(contact); role = ''; }
  if (!name || /\d{3,}/.test(name + role + org)) return '상대';
  var parts = [];
  if (org && name.indexOf(org) < 0) parts.push(org);
  parts.push(name);
  if (role && role !== org && name.indexOf(role) < 0) parts.push(role);
  var label = parts.join(' ');
  return label.length > 60 ? label.slice(0, 60).trim() : label;
}

/**
 * 화자 구분 전사(`화자1: …` / `화자2: …` 줄)의 머리를 바꾼다(Q11).
 * speakerMe(분석 앞머리 speaker_me)가 화자1 또는 화자2이고 화자가 정확히 둘일 때만:
 *   나인 쪽 → `나:`, 다른 쪽 → 상대 표기. 그 밖(한 문단, 화자 셋 이상, 모름)은 손대지 않는다.
 */
function callFeedRelabelSpeakers(transcript, speakerMe, counterpartLabel) {
  var text = String(transcript == null ? '' : transcript);
  if (speakerMe !== '화자1' && speakerMe !== '화자2') return text;
  var lines = text.split(/\r?\n/), seen = {}, count = 0;
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var m = /^(화자\d{1,2})\s*:\s/.exec(lines[i]);
    if (!m) return text;
    if (!seen[m[1]]) { seen[m[1]] = true; count++; }
  }
  if (count !== 2 || !seen['화자1'] || !seen['화자2']) return text;
  var other = speakerMe === '화자1' ? '화자2' : '화자1';
  var label = counterpartLabel || '상대';
  return lines.map(function (line) {
    var m = /^(화자\d{1,2})\s*:/.exec(line);
    if (!m) return line;
    return (m[1] === speakerMe ? '나' : m[1] === other ? label : m[1]) + ':' + line.slice(m[0].length);
  }).join('\n');
}

/**
 * 업무가 아닌 통화에 보낼 앞머리: 서버가 개수를 세는 데 필요한 칸만(이름·요약·전사는 보내지 않는다).
 * 녹음 시각이 없으면 전사 파일 이름의 날짜·시각(fallbackDatetime)을 쓴다(서버가 그 날짜에 센다).
 * 분석 스크립트가 남긴 "분석실패" 기록은 버전 칸을 빼서 서버가 판정 실패로 세게 한다.
 */
var CALL_FEED_MIN_KEYS = ['analysis_version', 'source_txt_id', 'recording_datetime', 'work_class'];
function callFeedMinimalAnalysis(md, fallbackDatetime) {
  var meta = callFeedFrontmatter(md), lines = ['---'];
  if (!meta.recording_datetime && fallbackDatetime) meta.recording_datetime = fallbackDatetime;
  var cls = callFeedClass(md);
  if (cls === '개인' || cls === '애매') meta.work_class = cls; else delete meta.work_class;
  CALL_FEED_MIN_KEYS.forEach(function (k) {
    if (cls === '실패' && k === 'analysis_version') return;
    if (meta.hasOwnProperty(k)) lines.push(k + ': "' + String(meta[k]).replace(/["\\\r\n]/g, ' ') + '"');
  });
  lines.push('---');
  return lines.join('\n');
}

/**
 * 서버 POST ?action=call 몸통 {ref, analysis_md, transcript, drive_url}(handler.ts parseCallBody와 같은 칸만).
 * - 분석의 work_class가 '업무'일 때만 분석 전체와 전사를 보낸다(전사 줄 머리는 callFeedRelabelSpeakers로 바꿈).
 * - 개인·애매·구분 없음은 앞머리 몇 칸만 보내고 전사는 빈 글로 보낸다(서버는 개수만 센다).
 * - 분석 파일이 64 KB를 넘으면 null(보내지 않음). 합계 200 KB를 넘으면 전사를 자른다.
 */
function callFeedBuildCallBody(input) {
  var analysisMd = callFeedNfc(input.analysisMd);
  if (!analysisMd.trim() || callFeedBytes(analysisMd) > CALL_FEED_ANALYSIS_MAX_BYTES) return null;
  var meta = callFeedFrontmatter(analysisMd);
  var body;
  if (callFeedClass(analysisMd) !== '업무') {
    body = { ref: String(input.ref), analysis_md: callFeedMinimalAnalysis(analysisMd, input.recordedAt), transcript: '' };
  } else {
    var label = callFeedCounterpartLabel(callFeedCounterpartFields(analysisMd), input.contact);
    var transcript = callFeedRelabelSpeakers(callFeedNfc(input.transcript).trim(), meta.speaker_me, label);
    transcript = callFeedCapBytes(transcript, CALL_FEED_TOTAL_MAX_BYTES - callFeedBytes(analysisMd));
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

// node 시험에서만 쓰는 내보내기(앱 스크립트에는 module이 없어서 아무 일도 하지 않는다).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    callFeedNormalizeNumber: callFeedNormalizeNumber, callFeedNormalizeName: callFeedNormalizeName, callFeedParseList: callFeedParseList,
    callFeedTranscriptName: callFeedTranscriptName, callFeedIsPersonal: callFeedIsPersonal, callFeedKstDay: callFeedKstDay,
    callFeedDayInRange: callFeedDayInRange, callFeedBytes: callFeedBytes, callFeedCapBytes: callFeedCapBytes,
    callFeedAnalysisName: callFeedAnalysisName, callFeedMinimalAnalysis: callFeedMinimalAnalysis,
    callFeedFrontmatter: callFeedFrontmatter, callFeedClass: callFeedClass, callFeedCounterpartFields: callFeedCounterpartFields,
    callFeedCounterpartLabel: callFeedCounterpartLabel, callFeedRelabelSpeakers: callFeedRelabelSpeakers,
    callFeedBuildCallBody: callFeedBuildCallBody, callFeedVerdict: callFeedVerdict,
  };
}
