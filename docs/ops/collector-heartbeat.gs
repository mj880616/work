/**
 * Web2 수집 점검 신호 (OPS-수집점검 2단계)
 *
 * 하는 일: 1시간마다 아래 두 가지 "시각"과 "개수"만 읽어 Web2에 알린다. 파일 이름·내용·ID는 보내지 않는다.
 *   1) 텔레그램: 원문 폴더 아래 모든 대화방의 messages → 월별 폴더(예: 2026-10)에서 가장 최근 메시지 파일 시각 + 최근 24시간에 생긴 파일 수
 *   2) 통화 전사: 전사 폴더에서 가장 최근 txt 파일 시각 + 최근 24시간에 생긴 txt 수
 * Web2 홈 "마지막 수집 시각" 칸이 이 값으로 텔레그램·통화 전사 줄을 보여 준다.
 *
 * 설정 안내: docs/ops/collector-heartbeat.md (붙여넣기 → 폴더 주소 두 칸 채우기 → 비밀값 → 시험 → 1시간 트리거)
 *
 * 비밀값은 이 코드에 넣지 않는다. "프로젝트 설정 → 스크립트 속성"의 COLLECTOR_HEARTBEAT_SECRET에만 둔다.
 * 기존 통화 전사 스크립트와 이름이 겹치지 않도록 함수·설정 이름은 모두 web2Heartbeat로 시작한다.
 */

// ── 여기 두 칸만 채운다 (따옴표는 그대로 두고 안쪽만 바꾼다) ─────────────────
// ① 텔레그램 원문 폴더: 대화방 폴더(예: 12345678_방이름)들이 들어 있는 "원문" 폴더를 열었을 때 주소창의 /folders/ 뒤 글자.
//    2026-10-22 변경: 방 하나(messages 폴더)만 보던 것을 전체 방 기준으로 바꿈.
//    되돌리기: 이 값을 한 방의 messages 폴더 주소로 바꾸면 그 방 하나만 본다(아래 함수는 그대로 둬도 됨).
var WEB2_HEARTBEAT_TELEGRAM_MESSAGES_FOLDER = '여기에_텔레그램_원문_폴더_주소_끝부분';
// ② 통화 전사 폴더: Drive에서 "통화 녹음 → 전사" 폴더를 열었을 때 주소창의 /folders/ 뒤 글자.
var WEB2_HEARTBEAT_TRANSCRIPT_FOLDER = '여기에_통화_전사_폴더_주소_끝부분';
// ─────────────────────────────────────────────────────────────────────

// Web2 받는 입구(공개 주소, 비밀값 아님)
var WEB2_HEARTBEAT_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=heartbeat';
var WEB2_HEARTBEAT_SECRET_KEY = 'COLLECTOR_HEARTBEAT_SECRET';
var WEB2_HEARTBEAT_RECENT_DAYS = 7;      // 먼저 최근 7일 안에 바뀐 파일만 찾는다(빠름)
var WEB2_HEARTBEAT_MAX_FILES = 20000;    // 7일 안에 하나도 없을 때만 전체를 훑되, 이 개수에서 멈춘다
var WEB2_HEARTBEAT_TIME_LIMIT_MS = 4.5 * 60 * 1000; // 앱 스크립트 6분 제한 전에 멈춘다
var WEB2_HEARTBEAT_MONTH = /^\d{4}-\d{2}$/;

/** 1시간 트리거가 부르는 함수. 손으로 [실행]해서 시험해도 된다. */
function web2Heartbeat_send() {
  var secret = PropertiesService.getScriptProperties().getProperty(WEB2_HEARTBEAT_SECRET_KEY);
  if (!secret) throw new Error('스크립트 속성에 ' + WEB2_HEARTBEAT_SECRET_KEY + '가 없습니다. 안내 문서 3단계를 먼저 하세요.');
  var started = Date.now();
  var results = [];
  // 2026-10-22: 가벼운 통화 전사를 먼저 보낸다(텔레그램 55개 방 훑기가 시간을 다 쓰더라도 전사 신호는 끊기지 않게).
  results.push(web2Heartbeat_try_('transcript', function () { return web2Heartbeat_transcript_(Date.now()); }, secret));
  results.push(web2Heartbeat_try_('telegram', function () { return web2Heartbeat_telegram_(Date.now()); }, secret));
  Logger.log(results.join('\n'));
  if (results.some(function (line) { return line.indexOf('정상') < 0; })) {
    throw new Error('일부 신호를 보내지 못했습니다. 위 실행 로그를 확인하세요.');
  }
}

/** 처음 한 번: 1시간마다 web2Heartbeat_send를 부르는 트리거를 만든다(이미 있으면 그대로 둔다). */
function web2Heartbeat_installHourlyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'web2Heartbeat_send'; });
  if (exists) { Logger.log('이미 1시간 트리거가 있습니다. 새로 만들지 않았습니다.'); return; }
  ScriptApp.newTrigger('web2Heartbeat_send').timeBased().everyHours(1).create();
  Logger.log('1시간 트리거를 만들었습니다.');
}

/** 멈추고 싶을 때: 이 스크립트의 점검 신호 트리거만 지운다(전사 트리거는 건드리지 않는다). */
function web2Heartbeat_removeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'web2Heartbeat_send') { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log('지운 점검 신호 트리거: ' + removed + '개');
}

/**
 * 처음 한 번: 긴 임의 비밀값을 만들어 스크립트 속성에 저장한다(이미 있으면 바꾸지 않는다).
 * 값은 로그에 찍지 않는다. "프로젝트 설정 → 스크립트 속성"에서 보고 복사해 Supabase에 똑같이 등록한다.
 */
function web2Heartbeat_makeSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(WEB2_HEARTBEAT_SECRET_KEY)) { Logger.log('비밀값이 이미 있습니다. 바꾸지 않았습니다.'); return; }
  var value = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty(WEB2_HEARTBEAT_SECRET_KEY, value);
  Logger.log('비밀값을 만들어 스크립트 속성에 저장했습니다(값은 로그에 남기지 않음).');
}

// ── 아래는 고칠 필요 없음 ─────────────────────────────────────────────

function web2Heartbeat_try_(source, read, secret) {
  try {
    var beat = read();
    if (!beat) return source + ': 보낼 시각 없음(폴더에 파일이 없음) — 건너뜀';
    var code = web2Heartbeat_post_(source, beat, secret);
    var note = beat.partial ? ' (시간 제한으로 일부만 확인)' : '';
    if (code === 200) return source + ': 정상(200)' + note;
    if (code === 401) return source + ': 비밀값 불일치(401) — Supabase 비밀값과 스크립트 속성 값이 같은지 확인';
    if (code === 409) return source + ': Web2 읽기용 사본 폴더 없음(409) — 커맨드센터에 알리기';
    if (code === 405 || code === 404) return source + ': 받는 입구 미배포(' + code + ') — 커맨드센터에 알리기';
    return source + ': 실패(HTTP ' + code + ')';
  } catch (e) {
    return source + ': 읽기 실패 — ' + (e && e.message ? e.message : e);
  }
}

function web2Heartbeat_post_(source, beat, secret) {
  var body = { source: source, last_at: beat.lastAt.toISOString(), count: beat.count };
  var res = UrlFetchApp.fetch(WEB2_HEARTBEAT_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-collector-heartbeat-secret': secret },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  return res.getResponseCode();
}

function web2Heartbeat_folder_(id, label) {
  if (!id || id.indexOf('여기에_') === 0) throw new Error(label + ' 칸을 코드 맨 위에 채우세요.');
  return DriveApp.getFolderById(id);
}

/**
 * 텔레그램: 원문 폴더 → 대화방 폴더 전체 → 각 방의 messages → 이름이 YYYY-MM인 월별 폴더 중 최근 두 달 → 그 안과 한 단계 아래 폴더.
 * 전체 방 중 가장 최근 메시지 시각을 보낸다(조용한 방 하나 때문에 '오래됨'으로 뜨지 않게).
 * ① 칸에 예전처럼 messages 폴더를 넣어도 동작한다(그 방 하나만 봄).
 */
function web2Heartbeat_telegram_(started) {
  var root = web2Heartbeat_folder_(WEB2_HEARTBEAT_TELEGRAM_MESSAGES_FOLDER, '① 텔레그램 원문 폴더');
  var messagesFolders = [];
  if (root.getName() === 'messages') {
    messagesFolders.push(root);
  } else {
    var rooms = root.getFolders();
    while (rooms.hasNext()) {
      var msgs = rooms.next().getFoldersByName('messages');
      while (msgs.hasNext()) messagesFolders.push(msgs.next());
    }
  }
  var folders = [];
  messagesFolders.forEach(function (messages) {
    var months = [];
    var subs = messages.getFolders();
    while (subs.hasNext()) {
      var f = subs.next();
      if (WEB2_HEARTBEAT_MONTH.test(f.getName())) months.push(f);
    }
    months.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
    months.slice(0, 2).forEach(function (month) {
      folders.push(month);
      var inner = month.getFolders();
      while (inner.hasNext()) folders.push(inner.next()); // 한 단계 아래까지
    });
  });
  if (!folders.length) throw new Error('월별 폴더(2026-10 등)를 하나도 찾지 못했습니다. ① 칸이 "원문" 폴더인지 확인하세요.');
  Logger.log('텔레그램 점검: 방 messages 폴더 ' + messagesFolders.length + '개, 월별 폴더 ' + folders.length + '개 확인');
  return web2Heartbeat_scan_(folders, function () { return true; }, started);
}

/** 통화 전사: 전사 폴더의 txt 파일만. */
function web2Heartbeat_transcript_(started) {
  var folder = web2Heartbeat_folder_(WEB2_HEARTBEAT_TRANSCRIPT_FOLDER, '② 통화 전사 폴더');
  return web2Heartbeat_scan_([folder], function (file) {
    return /\.txt$/i.test(file.getName()) || file.getMimeType() === 'text/plain';
  }, started);
}

/**
 * 여러 폴더에서 가장 최근 파일 시각(만든·고친 시각 중 늦은 것)과 최근 24시간에 생긴 파일 수를 센다.
 * 최근 1일 → 7일 안에 바뀐 파일만 차례로 검색하고(searchFiles), 둘 다 하나도 없을 때만 전체를 훑는다(상한·시간 제한).
 */
function web2Heartbeat_scan_(folders, accept, started) {
  // 2026-10-22: 최근 1일 → 7일 → 전체 순서로 넓힌다. 보통은 1일 창만 보고 끝내 빠르다.
  var now = Date.now(), since24 = now - 24 * 3600 * 1000;
  var state = { latest: 0, count: 0, seen: 0, partial: false };
  function take(iterator) {
    while (iterator.hasNext()) {
      if (Date.now() - started > WEB2_HEARTBEAT_TIME_LIMIT_MS || state.seen >= WEB2_HEARTBEAT_MAX_FILES) { state.partial = true; return; }
      var file = iterator.next();
      state.seen++;
      if (!accept(file)) continue;
      var created = file.getDateCreated().getTime(), updated = file.getLastUpdated().getTime();
      state.latest = Math.max(state.latest, created, updated);
      if (created >= since24) state.count++;
    }
  }
  function queryFor(days) {
    var from = new Date(now - days * 24 * 3600 * 1000);
    return 'trashed = false and modifiedDate > "' + Utilities.formatDate(from, 'UTC', "yyyy-MM-dd'T'HH:mm:ss") + '"';
  }
  [1, WEB2_HEARTBEAT_RECENT_DAYS].forEach(function (days) {
    if (state.latest || state.partial) return;
    var q = queryFor(days);
    folders.forEach(function (folder) { if (!state.partial) take(folder.searchFiles(q)); });
  });
  if (!state.latest && !state.partial) {
    folders.forEach(function (folder) { if (!state.partial) take(folder.getFiles()); });
  }
  if (!state.latest) return null;
  return { lastAt: new Date(Math.min(state.latest, now)), count: Math.min(state.count, 100000), partial: state.partial };
}
