// WEEKLY-한글초안 2단계: 업무일지 [주간 정리]의 [주간보고 한글 파일 만들기] (docs/design/weekly-hwpx-draft.md 8절 2단계).
// 지난주 팀 확정본(자료실 "주간보고 확정본" 최신 또는 기기 파일) → 내 칸 바탕 → 이번 주 기록을 줄 옆에 보여 주고 사람이 붙이기·고치기
// → .hwpx 내려받기 / [HWP로 받기] / [확정]하면 자료실(Drive)에 저장. AI 없음.
// - 파일은 이 기기 안에서만 다룬다(화면 안내문에는 쓰지 않음, WEEKLY-한글파일다듬기 ①). HWP 5 ↔ .hwpx 바꾸기는 HWP 편집기와 같은 칸막이 엔진(hwp-frame.js, sandbox iframe —
//   Web2 창·로그인 정보에 닿지 못함)이 하고, 표 읽기·빈 서식·보고서 만들기는 weekly-hwpx/*.mjs(외부 라이브러리 없음)가 한다.
//   서버로 가는 것은 자료실 확정본 열기(기존 document-actions hwp-open, owner 확인)와 [확정] 저장(기존 library-files)뿐이다.
// - 내 담당 조직은 my-organizations.js(내 프로필 → 담당 사업장)에서 받는다. 담당 팀원 칸의 내 이름은 직전 주 확정본에 쓴 표기,
//   그 표기를 찾지 못하면 프로필 이름(JOURNAL-주간정리다듬기 ②, draft.mjs resolveMe — 화면에서 고칠 수 있음). [주간 정리] 화면 요약 표에는
//   담당 팀원 칸이 없고 이 파일에만 서식대로 들어간다. 내 줄의 담당 칸은 확정본 그대로(여러 사람이 함께 맡은 줄도 그대로).
// - 5. 주요 일정 표는 [주간 정리]의 5번 묶음(다음 주 월요일부터 2주, 달력 일정)으로 14일을 한 줄씩 채우고 참석자 칸에 내 이름,
//   휴가는 표 아래 "※ 날짜 이름 연차" 줄로 쓴다(WEEKLY-주요일정, 2026-10-21 사용자 결정 — 금요일 작성·월요일 보고라 "보고 주 + 그다음 주").
//   1. 2) 주요 일정(본부 주요 일정)은 기준이 정해지지 않아 비운다.
// - ■ 일시·파일 이름·자료 날짜는 상집 보고일(보고 있는 주의 다음 월요일, journal-data.js reportDay)로 한다(2026-10-21 사용자 결정).
// - 1. 요청사항 표(WEEKLY-임원요청정리, 2026-10-23): 직전 주 확정본을 그대로 옮기지 않는다. 확정본을 읽으면 그 요청 표에서 날짜가
//   기준일(상집 보고일, 늦게 쓰면 오늘) 이후이고 내가 요청한 줄 — 내 '임원 요청' 기록(업데이트 표시·글)이 가리키거나 내 담당 사업장(이름·별칭)·
//   내 사업(진행 중인 프로젝트, 확정본의 내 담당 줄) 이름이 든 줄만
//   골라(weekly-exec-requests.js carryOver) journal.js에 넘기고(onCarry — 그 주에 한 번만 서버에 더함), 파일의 요청 표는 [주간 정리]
//   1. 요청사항 › 1) 표에 저장된 그 주 줄로 채운다(표 준비 전이면 고른 줄만). '지난주에서' 표시는 화면에만 있고 파일에는 없다.
// - 5. 주요 일정 제목 확인(WEEKLY-일정다듬기, 2026-10-23 사용자 요청 12:43 ④⑤): 표 칸은 늘 '시간 / 내용 / 장소'(장소 없으면 '미정').
//   [AI로 다듬기]를 누를 때만 서버 ai-assist(kind=schedule_titles)에 그 주와 일정 줄(날짜·시각·제목·장소)만 보내고, 업무 기록은 서버가 내
//   로그인으로 읽는다. 답은 칸에 넣는 제안이다(칸 값이라 임시저장에 함께 들어가고, 원래 제목은 늘 옆에 보여 칸에서 되돌릴 수 있다). 원래 제목은 늘 옆에 보이고 칸에서 고칠 수 있다.
//   그 모드가 없는 서버면 원래 제목 그대로 만든다. 본문(요약·투쟁 사업장·산하조직 칸)과 일정표가 같은 날 다른 시각이면 '다름' 목록으로만
//   보인다(고치지 않음, weekly-hwpx/schedule.mjs scheduleMismatches).
// - 임시저장(WEEKLY-임시저장, docs/design/weekly-draft-feedback.md 2절): 고친 값(줄 글·일정 제목·이름·일시)은 칸을 고치고 2초 멈추면,
//   상자를 닫거나 화면이 숨을 때 그 주 요청 표 행의 draft 칸에 서버 저장한다(weekly-draft-store.js). 칸 열쇠는 줄 번호가 아니라 칸 이름
//   (요약 '사업영역›세부 과제', 조직 이름, 같은 이름이면 몇 번째). 다시 열면 이름이 맞는 칸만 넣고, 바탕이 바뀌어 못 넣은 칸은 접어서
//   보여 주며 버리지 않는다. 다른 기기가 그사이 저장했으면 칸 단위 3자 비교(마지막으로 같았던 판·이 기기·서버)로 한쪽만 고친 칸은 합치고,
//   같은 칸을 양쪽이 다르게 고쳤으면 그 칸만 묻는다(고를 때까지 그 칸은 서버 값을 둔다). 칸이 아직 없으면 "임시저장은 준비 중" 한 줄.
// - 환류(WEEKLY-환류, 설계 3절, 명진 결정 Q3~Q7 추천대로): 5. 주요 일정 줄마다 작은 [빼기](이번 주 파일에서 뺌, 임시저장 dropped).
//   주간보고 기억(내 프로필 칸, weekly-schedule-memory.js)이 원래 제목 열쇠로 고친 이름을 먼저 넣고(작은 '기억' 표시 + [이번 주만 원래대로]),
//   기억으로 뺀 일정은 맨 아래 접힌 "기억으로 뺀 일정 N개"에 [이번 주만 넣기](임시저장 kept). 순서: 이번 주 임시저장 > 기억 > 달력.
//   [확정]이 성공하면 "다음 주에도 쓸까요?" 목록(달력 제목과 다르게 확정한 일정·뺀 일정, 체크된 채, 2자 이하 제목은 풀어 둠)에서
//   [기억하기]를 누른 것만 기억한다. 확정하지 않고 받기만 한 주는 기억하지 않는다. 달력 원본은 건드리지 않는다.
// - 같은 draft의 docs 칸(WEEKLY-자료요약 화면 ②, [주간 정리]의 자료 줄 고침)은 이 상자가 고치지 않고 읽은 그대로 다시 실어 보낸다.
//   [처음부터]도 docs는 남긴다.
// - 이 상자 하나만 이 모듈이 그린다(journal.js는 자리만 주고 주·자료가 바뀌면 알려 줌). 브라우저 저장소에 아무것도 두지 않는다.
import {selectMyOrganizations} from './my-organizations.js';
import {waitHtml, waitInlineHtml, emptyEl} from './wait-state.js'; // UI-기다림표시통일 2차
import {flashDone} from './press-feedback.js';
import {loadDisputeState} from './org-dispute-stage.js';
import {shortDay, reportDay, todayKey} from './journal-data.js';
import {scheduleForm} from './journal-weekly.js';
import {carryOver, carryCutoff, formRequests, formDay, mergeCarried} from './weekly-exec-requests.js';
import {scheduleItems, scheduleMismatches, titleRequest, titleAnswer, NO_PLACE} from './weekly-hwpx/schedule.mjs';
import {callAiAssist, AI_SUMMARY_TEXT, aiSummaryRetryable} from './basket-ai-summary.js';
import {cellKeys, cellId, parseCellId, summaryKey, orgKey, makeDraft, putIssued, placeDraft, merge3, sameDraft, hasContent, baseDigest, readWeekDraft, writeWeekDraft, draftDocs, draftAreaSummaries, keepDocsOnly, draftExtras} from './weekly-draft-store.js';
import {sameIssuedLines} from './weekly-lines.mjs';
import {pickBase, teamIsNewer, teamChanges, cellList, feedbackRecord} from './weekly-feedback.mjs';
import {isDropped, defaultTitle, visibleCalendar, effectiveOverrides, memoryCandidates, withEntries, withUsed, changeMemory} from './weekly-schedule-memory.js';

const CONFIRMED_CATEGORY = '주간보고 확정본';
// WEEKLY-환류학습 1(docs/design/weekly-draft-feedback.md 10절): 다음 주 바탕은 내가 최종으로 올린 최신 '주간보고 개인본'(보고일 앞의 것). 없으면 지금처럼 팀 확정본.
const PERSONAL_CATEGORY = '주간보고 개인본';
const encode = encodeURIComponent;
const TEXT = Object.freeze({
  // WEEKLY-한글파일다듬기 ①(2026-10-23 사용자 요청 11:35): 안내문 쉽게, 바탕 확정본이 있을 때·없을 때 따로.
  intro: '지난주 팀 확정본을 바탕으로 내 칸만 고친 한글 파일을 만들어요. [확정]을 눌러야 자료실에 저장돼요.',
  introNoBase: `지난주 팀 확정본이 없어요. 자료실에 ‘${CONFIRMED_CATEGORY}’으로 올리거나, 내 컴퓨터에서 골라 주세요.`,
  checking: '자료실에서 지난주 팀 확정본을 찾는 중이에요.',
  introPersonal: '지난주에 내가 올린 개인본을 바탕으로 만들어요. 팀 확정본에서 바뀐 칸은 옆에 작게 알려요. [확정]을 눌러야 자료실에 저장돼요.',
  noBrowser: '이 브라우저는 한글 파일 만들기(압축)를 지원하지 않아요. 최신 크롬·사파리·엣지에서 열어 주세요.',
  noConfirmed: `자료실에 "${CONFIRMED_CATEGORY}" 분류 자료가 없어요. 팀 확정본을 그 분류로 올리거나 [기기에서 파일 고르기]를 써 주세요.`,
  readFailed: '자료실을 읽지 못했어요. 잠시 뒤 다시 시도하거나 [기기에서 파일 고르기]를 써 주세요.',
  // WEEKLY-한글파일다듬기 ②: 자동 변환(칸막이 편집기 엔진)이 안 될 때만. 괄호 안은 다음에 원인을 좁히려는 짧은 이유(시간 초과 등).
  engineFailed: '이 파일은 옛 한글 형식(.hwp)이라 쓸 수 없어요. 한글에서 열어 ‘다른 이름으로 저장’ → 파일 형식 HWPX로 저장한 뒤 다시 골라 주세요.',
  locked: '암호가 걸린 한글 파일이라 열 수 없어요. 한글에서 암호를 푼 뒤 ‘다른 이름으로 저장’ → 파일 형식 HWPX로 저장해 다시 골라 주세요.',
  notHwp: 'HWP(.hwp) 또는 한글 파일(.hwpx)만 고를 수 있어요.',
  tooBig: '30MB가 넘는 파일은 열지 않아요.',
  noMine: '담당 팀원 칸에서 이 이름을 찾지 못했어요. 이름을 확인해 주세요(요약 표는 틀만 들어가요).',
});
// ai-assist schedule_titles 답의 일상어(없는 모드·배포 전이면 원래 제목 그대로 쓴다고 알림).
const TITLE_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready: 'AI 제목 다듬기는 아직 준비 중이에요. 원래 제목으로 만들어요.',
  unsupported_kind: 'AI 제목 다듬기는 아직 준비 중이에요. 원래 제목으로 만들어요.',
  daily_limit: '오늘 AI를 쓸 수 있는 횟수를 다 썼어요. 제목은 칸에서 직접 고쳐 주세요.',
  monthly_limit: '이번 달 AI 한도에 닿았어요. 제목은 칸에서 직접 고쳐 주세요.',
});
const MAX_BYTES = 30 * 1024 * 1024;
const DRAFT_DELAY = 2000;
const SECTION_NAME = Object.freeze({summary:'요약', orgs:'산하조직', sites:'투쟁 사업장'});
const DRAFT_TEXT = Object.freeze({
  missing: '임시저장은 준비 중이에요. 상자를 닫으면 고친 내용은 사라져요.',
  saving: '저장 중…',
  failed: '저장 못 함 — ',
  readFailed: '임시저장본을 읽지 못했어요. 고치면 서버 것과 맞춰 저장해요.',
});
const seoulParts = iso => {
  try { return Object.fromEntries(new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date(iso)).map(p => [p.type, p.value])); }
  catch { return null; }
};
const hm = iso => { const p = seoulParts(iso); return p ? `${p.hour}:${p.minute}` : ''; };
const mdhm = iso => { const p = seoulParts(iso); return p ? `${p.month}/${p.day} ${p.hour}:${p.minute}` : ''; };

// The hidden sandboxed editor (same engine and frame as the HWP editor), made on first need and removed with the panel.
function createEngine() {
  let host = null, flight = null;
  const ready = () => flight || (flight = (async () => {
    const {createSandboxedEditor} = await import('./hwp-frame.js');
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true'); host.inert = true;
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
    document.body.append(host);
    return createSandboxedEditor(host);
  })().catch(error => { flight = null; host?.remove(); host = null; throw error; }));
  const run = async (bytes, name, out) => { const editor = await ready(); await editor.loadFile(bytes, name, {skipUnsavedGuard:true}); return out === 'hwp' ? editor.exportHwp() : editor.exportHwpx(); };
  return {
    toHwpx: (bytes, name) => run(bytes, name, 'hwpx'),
    toHwp: bytes => run(bytes, 'draft.hwpx', 'hwp'),
    close() { const pending = flight; flight = null; pending?.then(editor => { try { editor.destroy(); } catch { /* gone */ } }).catch(() => {}); host?.remove(); host = null; },
  };
}

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Reads for the draft: my profile name, my organizations (my-organizations.js), the latest confirmed team report in the library.
async function readContext(rt) {
  const c = rt.context.read(), user = c?.user?.id, workspace = c?.workspace?.id;
  if (!user || !workspace) throw new Error('context');
  const [profile, orgs, assignees] = await Promise.all([
    rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(user)}&select=display_name&limit=1`).catch(() => []),
    rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(workspace)}&select=id,name,aliases,active&order=id.asc`).catch(() => null),
    rt.api(`/rest/v1/app_suborganization_assignees?user_id=eq.${encode(user)}&select=organization_id`).catch(() => []),
  ]);
  const mine = orgs ? selectMyOrganizations(orgs, assignees || []) : {organizations:[], fallback:true, failed:true};
  // ORG-쟁의단계 ②: 쟁의 단계(투쟁 사업장 표 자동 채움). 읽지 못해도 보고서는 기존처럼 만든다(stages.status로 한 줄 알림).
  const stages = await loadDisputeState({rt, workspaceId:workspace, force:true}).catch(() => ({status:'error', stages:[], histories:new Map()}));
  return {stages, me:String(profile?.[0]?.display_name || c?.user?.user_metadata?.display_name || '').trim(), organizations:mine.organizations, orgFallback:mine.fallback, orgFailed:!!mine.failed};
}
// 바탕 고르기(weekly-feedback.mjs pickBase): 보고일 앞의 최신 개인본 → {doc, from:'personal', team(최신 팀 확정본 — '확정본에서 바뀜' 참고용)},
// 없으면 최신 팀 확정본 → {doc, from:'confirmed'}, 둘 다 없으면 null. 개인본을 읽지 못하면 지금처럼 확정본만 본다.
async function latestBase(rt, day) {
  const workspace = rt.context.read()?.workspace?.id;
  const q = (category, limit) => `/rest/v1/app_documents?workspace_id=eq.${encode(workspace)}&category=eq.${encode(category)}&select=id,title,file_name,document_date,created_at&order=created_at.desc,id.desc&limit=${limit}`;
  const [personal, confirmed] = await Promise.all([rt.api(q(PERSONAL_CATEGORY, 5)).catch(() => []), rt.api(q(CONFIRMED_CATEGORY, 1))]);
  return pickBase({personal:Array.isArray(personal) ? personal : [], confirmed:Array.isArray(confirmed) ? confirmed : []}, day);
}

// host: the box journal.js gives; getWeek(): {start, model} (model = journal-weekly.js weeklySummary of the shown week).
// draftDelay: how long typing must pause before the draft is saved (tests may pass a shorter one).
// onMemory(list): [기억하기]로 내 프로필의 주간보고 기억을 쓴 뒤 저장된 목록을 알린다(journal.js가 [주간 정리]를 다시 그림).
export function mountWeeklyHwpx(host, {getWeek, onCopy, onCarry, onMemory, rt = window.KPTURuntime, draftDelay = DRAFT_DELAY}) {
  if (!host) return null;
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = ''; return b; };
  let state = null, engine = null, lib = null, run = 0, confirmed = undefined, sourceRun = 0, weekDraft = null;
  const start = button('주간보고 한글 파일 만들기', 'hwpxStart', 'secondary');
  const panel = el('section', 'journal-hwpx-panel'); panel.hidden = true; panel.setAttribute('aria-labelledby', 'journalHwpxTitle');
  const title = el('h4', 'journal-heading', '주간보고 한글 파일(.hwpx)'); title.id = 'journalHwpxTitle'; title.tabIndex = -1;
  const status = el('p', 'journal-hwpx-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.hwpxStatus = '';
  const body = el('div', 'journal-hwpx-body');
  // 임시저장 한 줄: "임시저장 14:32" / "저장 중…" / "저장 못 함 — [다시]" / 준비 중.
  const draftLine = el('p', 'journal-hwpx-draft'); draftLine.dataset.hwpxDraftStatus = ''; draftLine.hidden = true; draftLine.setAttribute('aria-live', 'polite');
  panel.append(title, draftLine, status, body);
  // UI-눌림느낌: the small [복사] says '✓ 복사됨' for 1.5s once the copy worked.
  // JOURNAL-복사버튼: [주간보고 초안 복사]는 이 줄의 작은 [복사]로 옮김(같은 복사 기능은 journal.js가 onCopy로 넘김). 한글 파일 상자가 열려도 [복사]는 남는다.
  const bar = el('div', 'journal-hwpx-bar');
  if (onCopy) { const copy = button('복사', 'hwpxCopy'); copy.setAttribute('aria-label', '주간보고 초안 복사'); copy.addEventListener('click', async () => { if (await onCopy()) flashDone(copy); }); bar.append(start, copy); } else bar.append(start);
  host.replaceChildren(bar, panel);
  const say = (text, kind = '') => { status.textContent = text || ''; status.dataset.kind = kind; };
  const lazy = () => lib || (lib = Promise.all([import('./weekly-hwpx/draft.mjs'), import('./hwp-drive.js')]).then(([draft, drive]) => ({draft, drive})));

  function close(message = '') {
    if (state?.store?.dirty) void saveDraft(state);
    if (state?.store) clearTimeout(state.store.timer);
    run++; sourceRun++; state = null; weekDraft = null; engine?.close(); engine = null; paintDraft();
    panel.hidden = true; start.hidden = false; body.replaceChildren(); say(message);
  }
  async function open() {
    const {draft} = await lazy();
    start.hidden = true; panel.hidden = false; say('');
    if (!draft.canCompress()) { body.replaceChildren(el('p', 'journal-muted', TEXT.noBrowser), button('닫기', 'hwpxClose')); return; }
    weekDraft = null;
    renderSource();
    title.focus();
  }
  // 바탕 고르기: 자료실에 "주간보고 확정본"이 있으면 [자료실 최신 … 쓰기](채운 버튼)가 앞, 없으면 그 버튼은 흐리게(누를 수 없음) 두고
  // [기기에서 파일 고르기]가 앞(WEEKLY-한글파일다듬기 ①). 찾은 자료는 [쓰기]를 누를 때 다시 찾지 않고 그대로 연다. 자료실을 읽지 못하면
  // [쓰기]를 누를 수 있게 두어 다시 시도한다(누르면 그때 다시 찾음).
  function renderSource() {
    run++;
    const mine = ++sourceRun;
    confirmed = undefined;
    const file = el('input'); file.type = 'file'; file.accept = '.hwp,.hwpx'; file.hidden = true; file.dataset.hwpxFile = '';
    const pick = button('기기에서 파일 고르기', 'hwpxPick');
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) fromFile(f); });
    const library = button(`자료실 최신 "${CONFIRMED_CATEGORY}" 쓰기`, 'hwpxLibrary', 'primary');
    library.disabled = true;
    const intro = el('p', 'journal-muted', TEXT.checking); intro.id = 'journalHwpxIntro'; intro.dataset.hwpxIntro = '';
    library.setAttribute('aria-describedby', intro.id);
    const row = el('div', 'journal-hwpx-actions');
    row.append(library, pick, file, button('닫기', 'hwpxClose'));
    body.replaceChildren(intro, row);
    const week = getWeek().start;
    readDraftFor(week).then(result => {
      if (mine !== sourceRun || !row.isConnected) return;
      const saved = result.row, d = saved?.draft;
      if (!hasContent(d)) return;
      const box = el('div', 'journal-hwpx-resume'); box.dataset.hwpxResume = '';
      const fromFile = d.base?.from === 'file';
      box.append(el('p', '', `이 주 임시저장본(${mdhm(saved.saved_at)})이 있어요.${fromFile ? ` 바탕이 기기 파일(${d.base.file_name})이었어요 — [이어서 고치기]를 누르고 같은 파일을 골라 주세요.` : ''}`));
      const go = button('이어서 고치기', 'hwpxResumeGo', 'primary'), clear = button('처음부터', 'hwpxResumeClear');
      go.addEventListener('click', () => { if (fromFile) file.click(); else fromLibrary(d.base?.document_id ? {id:d.base.document_id, file_name:d.base.file_name, title:d.base.title} : null); });
      clear.addEventListener('click', () => clearSaved(saved, week, box));
      const actions = el('div', 'journal-hwpx-actions'); actions.append(go, clear); box.append(actions);
      body.prepend(box);
    });
    latestBase(rt, reportDay(week)).then(found => ({found}), () => ({failed:true})).then(({found = null, failed = false}) => {
      if (mine !== sourceRun || !library.isConnected) return;
      confirmed = failed ? undefined : found;
      if (found?.from === 'personal') { library.disabled = false; library.textContent = `자료실 최신 "${PERSONAL_CATEGORY}" 쓰기`; library.dataset.hwpxBaseFrom = 'personal'; intro.textContent = TEXT.introPersonal; return; }
      if (found || failed) { library.disabled = false; intro.textContent = TEXT.intro; return; }
      intro.textContent = TEXT.introNoBase;
      row.prepend(pick);
    });
  }

  // pinned: the confirmed report the week's draft was made on ([이어서 고치기] opens the same one again).
  async function fromLibrary(pinned = null) {
    const mine = ++run;
    say('자료실에서 확정본을 찾는 중…');
    try {
      const day = reportDay(getWeek().start);
      // [이어서 고치기]는 그때 바탕을 다시 연다. 그것이 지금 고른 개인본이면 팀 확정본 참고 표시도 함께 본다.
      const pick = pinned ? (confirmed !== undefined ? confirmed : await latestBase(rt, day).catch(() => null)) : (confirmed !== undefined ? confirmed : await latestBase(rt, day));
      const chosen = pinned ? (pick?.doc?.id === pinned.id ? pick : {doc:pinned, from:'confirmed', team:null}) : pick;
      const found = chosen?.doc ?? null;
      if (mine !== run) return;
      if (!found) { say(TEXT.noConfirmed, 'error'); return; }
      const {drive} = await lazy();
      if (!drive.isHwpName(found.file_name)) { say(TEXT.notHwp, 'error'); return; }
      say(`"${found.title || found.file_name}"을(를) 여는 중…`);
      const {bytes, info} = await drive.openHwpFromDrive({kind:'library', document:{id:found.id}}, {rt});
      if (mine !== run) return;
      const personal = chosen.from === 'personal';
      await load(bytes, found.file_name, info.format, `자료실${personal ? ' 개인본' : ''} · ${found.title || found.file_name}`, mine, {from:'library', document_id:String(found.id), file_name:String(found.file_name || ''), title:String(found.title || '')});
      if (mine !== run || !state) return;
      state.baseKind = personal ? 'personal' : 'confirmed';
      if (state.store?.extras && !state.store.extras.proposed) state.store.extras.proposed = proposedNow(state);
      if (personal && teamIsNewer(found, chosen.team)) void loadTeamChanges(state, chosen.team);
    } catch (error) {
      if (mine === run) say(error?.kind ? error.message : TEXT.readFailed, 'error');
    }
  }
  async function fromFile(file) {
    const mine = ++run;
    const {drive} = await lazy();
    if (!drive.isHwpName(file.name)) { say(TEXT.notHwp, 'error'); return; }
    if (file.size > MAX_BYTES) { say(TEXT.tooBig, 'error'); return; }
    say(`"${file.name}"을(를) 여는 중…`);
    await load(new Uint8Array(await file.arrayBuffer()), file.name, /\.hwpx$/i.test(file.name) ? 'hwpx' : 'hwp', `기기 파일 · ${file.name}`, mine, {from:'file', file_name:String(file.name)});
  }
  // Confirmed report bytes → team report + blank template → my base. Nothing is shown from the file but my own rows.
  async function load(bytes, name, format, source, mine, baseInfo) {
    const {draft} = await lazy();
    try {
      let hwpx = bytes;
      // WEEKLY-한글파일다듬기 ②: 이름이 아니라 내용으로 고른다. 내용이 HWPX(ZIP)면 이름이 .hwp여도 엔진 없이 열고, 암호 걸린 HWP 5는 엔진에
      // 넣지 않는다(숨은 칸막이 안에서 암호 묻는 창이 답을 기다리다 시간 초과로 끝나기 때문). 한글 파일이 아니면 고를 수 있는 파일 안내.
      const kind = draft.hwpKind(bytes);
      if (!kind) { if (mine === run) say(TEXT.notHwp, 'error'); return; }
      if (kind !== 'hwpx') {
        if (draft.hwp5Header(bytes)?.password) { say(TEXT.locked, 'error'); return; }
        say('HWP를 한글 파일(.hwpx)로 바꾸는 중…(처음엔 조금 걸려요)');
        engine ||= createEngine();
        try { hwpx = await engine.toHwpx(bytes, name); }
        catch (error) {
          const why = draft.engineReason(error);
          console.warn('weekly hwpx: HWP conversion failed', why);
          // A converter that did not start or ran out of time is not kept: the next try makes a new one.
          if (why !== '파일을 열지 못함') { engine?.close(); engine = null; }
          if (mine === run) say(`${TEXT.engineFailed} (${why})`, 'error');
          return;
        }
        if (mine !== run) return;
      }
      const pkg = await draft.openConfirmed(hwpx);
      const {team, template} = draft.prepareConfirmed(pkg);
      const week = getWeek();
      const [context, saved] = await Promise.all([readContext(rt).catch(() => ({me:'', organizations:[], orgFallback:true, orgFailed:true})), readDraftFor(week.start)]);
      if (mine !== run) return;
      const who = draft.resolveMe(team, context.me);
      state = {draft, team, template, source, start:week.start, me:who.me, meFrom:who.from, meResolved:who.me, meResolvedFrom:who.from, date:draft.reportDate(reportDay(week.start)), context,
        myOrgs:draft.orgNames(context.organizations), aliases:new Map(context.organizations.map(o => [o.name, Array.isArray(o.aliases) ? o.aliases : []])), edits:null, built:null, saved:null, titles:new Map(), drops:new Map(), titleKeys:'', titleRun:0};
      state.defaultDate = state.date;
      rebase();
      await attachDraft(state, baseInfo, saved);
      if (mine !== run) return;
      carry(week);
      say('');
      renderEdit();
    } catch (error) {
      if (mine === run) say(error?.code ? error.message : '확정본을 읽지 못했어요. 아무것도 만들지 않았어요.', 'error');
    }
  }
  // ---- 환류학습 1: 팀 확정본에서 바뀜(참고용) ----
  // 바탕이 개인본일 때, 그보다 나중에 나온 팀 확정본의 내 칸 글과 다르면 칸 옆에 작은 '확정본에서 바뀜'(눌러 그 글 보기·[이 글로 바꾸기]).
  // 열지 못하면 조용히 표시하지 않는다(바탕은 개인본 그대로).
  function rawCells(s, team) {
    const base = s.draft.startDraft(team, {me:s.me, myOrgs:s.myOrgs, orgList:s.context.orgFailed ? null : s.context.organizations, date:s.date});
    const out = new Map();
    for (const [section, list, keyOf] of [['summary', s.draft.editableRows(base, s.me), summaryKey], ['orgs', s.draft.editableOrgs(base, 'orgs'), orgKey], ['sites', s.draft.editableOrgs(base, 'sites'), orgKey]]) {
      const keys = cellKeys(list, keyOf);
      list.forEach((row, i) => out.set(cellId(section, keys[i].key, keys[i].n), row.lines));
    }
    return out;
  }
  async function hwpxBytes(bytes, name) {
    if (state?.draft.hwpKind(bytes) === 'hwpx') return bytes;
    if (state?.draft.hwp5Header(bytes)?.password) throw new Error('locked');
    engine ||= createEngine();
    return engine.toHwpx(bytes, name);
  }
  async function loadTeamChanges(s, teamDoc) {
    try {
      const {drive} = await lazy();
      if (!drive.isHwpName(teamDoc.file_name)) return;
      const {bytes} = await drive.openHwpFromDrive({kind:'library', document:{id:teamDoc.id}}, {rt});
      const {team} = s.draft.prepareConfirmed(await s.draft.openConfirmed(await hwpxBytes(bytes, teamDoc.file_name)));
      if (state !== s) return;
      s.teamDiff = teamChanges(rawCells(s, s.team), rawCells(s, team));
      s.teamTitle = String(teamDoc.title || teamDoc.file_name || '');
      paintTeam();
    } catch { /* 참고 표시만 없음 */ }
  }
  function paintTeam() {
    const s = state;
    if (!s?.teamDiff || panel.hidden) return;
    for (const node of body.querySelectorAll('[data-hwpx-team]')) {
      const [section, index] = node.dataset.hwpxTeam.split(':'), id = s.cellOf?.[section]?.get(Number(index)), lines = id && s.teamDiff.get(id);
      node.hidden = !lines;
      if (!lines) { node.replaceChildren(); continue; }
      const fold = el('details', 'journal-hwpx-team-fold');
      const mark = el('summary', 'journal-exec-carried', '확정본에서 바뀜'); mark.title = `팀 확정본(${s.teamTitle})에서 이 칸 글이 달라요`;
      const use = button('이 글로 바꾸기', 'hwpxTeamUse'); use.dataset.hwpxTeamCell = node.dataset.hwpxTeam;
      fold.append(mark, el('p', 'journal-muted', lines.join(' / ') || '(빈 칸)'), use);
      node.replaceChildren(fold);
    }
  }
  function useTeam(key) {
    const s = state, [section, index] = key.split(':'), id = s?.cellOf?.[section]?.get(Number(index)), lines = id && s.teamDiff?.get(id);
    if (!lines) return;
    s.edits[section].set(Number(index), [...lines]); s.built = null;
    const area = areas[key];
    if (area) area.value = lines.join('\n');
    typed(`row:${id}`);
    say('팀 확정본 글로 바꿨어요. 칸에서 고칠 수 있어요.');
  }
  // 환류학습 2: 그 주 처음 만든 초안 칸 글(proposed). 서버에 따로 쓰지 않고 다음 임시저장·[확정] 때 함께 실린다.
  const nowIso = () => new Date().toISOString();
  function cellsNow(s, from = 'edits') {
    return new Map([...s.cellAt].map(([id, at]) => [id, from === 'initial' ? [...(s.initial.get(id) ?? [])] : [...(s.edits[at.section].get(at.index) ?? [])]]));
  }
  const proposedNow = s => ({at:nowIso(), base:{from:s.baseKind === 'personal' ? 'personal' : s.baseInfo?.from === 'file' ? 'file' : 'confirmed', ...(s.baseInfo?.document_id ? {document_id:s.baseInfo.document_id} : {})}, cells:cellList(cellsNow(s, 'initial'))});

  // (Re)build my base from the team report for the current name; edits start from the base lines.
  function rebase() {
    const {draft, team} = state;
    state.base = draft.startDraft(team, {me:state.me, myOrgs:state.myOrgs, orgList:state.context.orgFailed ? null : state.context.organizations, date:state.date});
    state.rows = draft.editableRows(state.base, state.me);
    state.orgs = draft.editableOrgs(state.base, 'orgs');
    // ORG-쟁의단계 ②: 투쟁 사업장 표는 쟁의 단계에서 채운다(draft.applySiteStages). 단계를 읽지 못했으면 바탕 그대로.
    const st = state.context.stages, stage = draft.applySiteStages(state.base, {orgs:state.context.orgFailed || state.context.orgFallback ? [] : state.context.organizations, stages:st?.status === 'ready' ? st.stages : [], histories:st?.histories, weekStart:state.start});
    state.base = stage.base; state.stageFixes = stage.fixes;
    state.sites = draft.editableOrgs(state.base, 'sites').map(r => stage.starts.has(r.index) ? {...r, lines:stage.starts.get(r.index)} : r);
    // WEEKLY-한글파일다듬기 ⑤: 바탕 줄 가운데 보고일 기준 지난 날짜의 '…예정'은 '예정'만 뺀 채로 시작한다(바탕과 달라 파란 글씨가 됨).
    // 바뀐 줄은 화면 위쪽 접힌 목록(renderEdit)에서 확인한다. 칸에서 다시 고칠 수 있다.
    const day = reportDay(state.start), plans = [];
    const start = (section, list, label) => new Map(list.map(r => { const p = draft.pastPlanLines(r.lines, day); for (const c of p.changed) plans.push({...c, where:label(r)}); return [r.index, p.lines]; }));
    state.edits = {summary:start('summary', state.rows, r => `${r.area} › ${r.task || '—'}`), orgs:start('orgs', state.orgs, r => r.org), sites:start('sites', state.sites, r => r.org)};
    state.plans = plans;
    state.built = null;
    indexCells(state);
  }

  // Last week's request rows that are still to come and relate to my workplaces or projects (the rest are dropped).
  function carry(week) {
    const s = state, day = reportDay(week.start), cutoff = carryCutoff(day, todayKey());
    const orgs = s.context.orgFallback || s.context.orgFailed ? [] : s.myOrgs;
    const projects = [...(week.projects ?? []), ...s.rows.flatMap(r => [r.area, r.task])];
    const {items, counts} = carryOver(s.team.requests ?? [], {cutoff, near:day, orgs, projects, requested:week.requested ?? []});
    s.carry = {items, counts, cutoff, status:onCarry ? 'saving' : 'unsaved', added:0};
    if (!onCarry) return;
    const mine = s;
    Promise.resolve(onCarry(week.start, items)).then(result => { if (state !== mine) return; Object.assign(mine.carry, result); renderRequestNote(); })
      .catch(() => { if (state === mine) { mine.carry.status = 'failed'; renderRequestNote(); } });
  }
  // The rows the file's request table gets: the week's saved rows ([주간 정리] 1. 요청사항 › 1)), or the carried rows when the table
  // is not there yet (or could not be read) — never last week's table as it was.
  function requestRows() {
    const r = getWeek().model?.requests, carried = state.carry?.items ?? [];
    if (!r || r.loading || r.failed?.length || r.missing) return {items:carried, from:'carried'};
    // While the carried rows are still being saved, the file already takes them (the same merge the save makes).
    return {items:state.carry?.status === 'saving' ? mergeCarried(r.items, carried) : r.items, from:'saved'};
  }
  function renderRequestNote() {
    const note = body.querySelector('[data-hwpx-requests]');
    if (!note || !state?.carry) return;
    const c = state.carry, n = c.counts, rows = requestRows();
    const dropped = [n.past ? `지난 날짜 ${n.past}` : '', n.unrelated ? `관련 없음 ${n.unrelated}` : '', n.unread ? `날짜·내용을 못 읽음 ${n.unread}` : ''].filter(Boolean).join(', ');
    const took = c.status === 'before' ? '이 주는 이미 지난주 줄을 가져와서 다시 가져오지 않았어요.'
      : c.status === 'saved' ? `지난주 확정본에서 ${c.added}줄을 가져왔어요${dropped ? `(뺀 줄: ${dropped})` : ''}.`
      : c.status === 'saving' ? '지난주 확정본에서 고른 줄을 저장하는 중이에요.'
      : c.status === 'failed' ? '지난주에서 고른 줄을 저장하지 못했어요. 파일에는 고른 줄만 넣어요.'
      : `지난주 확정본에서 ${c.items.length}줄을 골랐어요${dropped ? `(뺀 줄: ${dropped})` : ''}. 저장 칸 준비 전이라 이 파일에만 넣어요.`;
    note.textContent = `1. 요청사항 표: ${rows.items.length}줄(위 "1) 임원 일정 배정·논의 요청" 표 그대로). ${took} 기준: ${formDay(c.cutoff)}부터, 내 '임원 요청' 기록이 가리키거나 내 담당 사업장·사업 관련 줄만.`;
  }
  // 5. 주요 일정: 기억으로 뺀 일정까지 든 달력(allRows)과 이 주에 실제 들어가는 달력(이번 주 빼기·넣기 반영).
  const fullCalendar = () => { const c = getWeek().model?.calendar; return c && c.allRows ? {...c, rows:c.allRows} : c; };
  const shownCalendar = () => visibleCalendar(getWeek().model?.calendar, state?.drops);
  const areas = {};
  function lineBox(section, row, label) {
    const box = el('div', 'journal-hwpx-row'); box.dataset.hwpxRow = `${section}:${row.index}`;
    const id = `journalHwpx-${section}-${row.index}`;
    const name = el('label', 'journal-hwpx-label', label); name.htmlFor = id;
    const area = el('textarea', 'journal-hwpx-lines'); area.id = id; area.rows = Math.min(12, Math.max(3, row.lines.length + 1));
    area.value = state.edits[section].get(row.index).join('\n'); area.dataset.hwpxLines = '';
    area.addEventListener('input', () => { state.edits[section].set(row.index, area.value.split('\n')); state.built = null; renderMismatches(); typed(`row:${state.cellOf[section].get(row.index)}`); });
    areas[`${section}:${row.index}`] = area;
    const material = el('ul', 'journal-hwpx-material'); material.dataset.hwpxMaterial = `${section}:${row.index}`;
    const team = el('div', 'journal-hwpx-team'); team.dataset.hwpxTeam = `${section}:${row.index}`; team.hidden = true;
    box.append(name, team, area, material);
    return box;
  }
  function append(key, text) {
    const area = areas[key];
    if (!area) return;
    const [section, index] = key.split(':');
    const lines = state.edits[section].get(Number(index)).filter(line => line.trim());
    lines.push(text);
    state.edits[section].set(Number(index), lines); state.built = null;
    typed(`row:${state.cellOf[section].get(Number(index))}`);
    area.value = lines.join('\n');
    area.rows = Math.min(12, Math.max(area.rows, lines.length + 1));
  }
  function renderMaterial() {
    if (!state || panel.hidden) return;
    const {draft} = state, model = getWeek().model;
    const m = draft.weekMaterial(model, state.rows, state.orgs, {aliases:state.aliases});
    const fill = (key, list) => {
      const host_ = body.querySelector(`[data-hwpx-material="${key}"]`);
      if (!host_) return;
      host_.replaceChildren(...list.map(item => {
        const li = el('li');
        li.append(el('span', 'journal-weekly-day', item.day ? shortDay(item.day) : '요약'), doc.createTextNode(item.text + ' '));
        const add = button('붙이기', 'hwpxAppend'); add.dataset.hwpxTarget = key; add.dataset.hwpxText = item.text;
        add.setAttribute('aria-label', `붙이기: ${item.text}`);
        li.append(add);
        return li;
      }));
    };
    for (const row of state.rows) fill(`summary:${row.index}`, m.byRow.get(row.index));
    for (const row of state.orgs) fill(`orgs:${row.index}`, m.byOrg.get(row.index));
    const rest = body.querySelector('[data-hwpx-unmatched]');
    if (rest) {
      const items = [...m.unmatched.map(i => ({...i, section:'summary'})), ...m.orgUnmatched.map(i => ({...i, section:'orgs'}))];
      rest.hidden = !items.length;
      const list = rest.querySelector('ul');
      list.replaceChildren(...items.map((item, n) => {
        const li = el('li');
        li.append(el('span', 'journal-weekly-day', item.day ? shortDay(item.day) : '요약'), el('span', 'journal-weekly-label', `${item.from}: `), doc.createTextNode(item.text + ' '));
        const targets = item.section === 'summary'
          ? state.rows.map(r => ({value:`summary:${r.index}`, label:`${r.area} › ${r.task}`, names:[r.area, r.task], kind:'row'}))
          : state.orgs.map(r => ({value:`orgs:${r.index}`, label:r.org, names:state.draft.rowNames(r.org, state.context.organizations), kind:'org'}));
        if (!targets.length) return li;
        // WEEKLY-한글파일다듬기 ③: 맨 앞 '줄 고르기'(빈 값). 이름이 가장 가까운 줄 하나만 미리 고르고, 없거나 애매하면 빈 값 — 그때 [붙이기]는
        // 줄을 고르기 전엔 누를 수 없다. (전에는 빈 값이 없어 목록 첫 줄이 기본으로 골라져 있었다.)
        const pickId = `journalHwpxPick-${n}`;
        const select = el('select', 'journal-hwpx-target'); select.id = pickId; select.setAttribute('aria-label', '붙일 줄'); select.dataset.hwpxPick = '';
        const none = el('option', '', '줄 고르기'); none.value = ''; select.append(none);
        for (const t of targets) { const o = el('option', '', t.label); o.value = t.value; select.append(o); }
        select.value = state.draft.nearestTarget(item.from, targets);
        const add = button('붙이기', 'hwpxAppend'); add.dataset.hwpxText = item.text; add.dataset.hwpxPickFrom = pickId;
        add.setAttribute('aria-label', `붙이기: ${item.text}`);
        add.disabled = !select.value;
        select.addEventListener('change', () => { add.disabled = !select.value; });
        li.append(select, add);
        return li;
      }));
    }
    const c = model?.calendar, cal = body.querySelector('[data-hwpx-calendar]');
    // UI-기다림표시통일 2차: 달력 일정을 받는 동안은 글자 대신 회색 칸(wait-state.js).
    if (cal && (!c || c.loading)) cal.innerHTML = '5. 주요 일정 표: ' + waitInlineHtml();
    else if (cal) cal.textContent = c.failed?.length ? '5. 주요 일정 표: 달력 일정을 불러오지 못해 날짜만 넣어요. [주간 정리]의 5. 주요 일정에서 [다시 시도]할 수 있어요.'
      : c.noCalendar ? "5. 주요 일정 표: '공공운수노조' 달력을 찾지 못해 날짜만 넣어요."
      : `5. 주요 일정 표: ${shortDay(c.days[0])}~${shortDay(c.days.at(-1))} 일정 ${c.rows.reduce((n, r) => n + r.items.length, 0)}개(참석자 = 내 이름)${c.vacations.length ? `, 휴가 ${c.vacations.length}개는 표 아래 ※ 줄` : ''}로 채워요.`;
    renderTitles(fullCalendar());
    renderMismatches();
    const loading = model && ['summary', 'orgs'].some(k => model[k]?.loading);
    const note = body.querySelector('[data-hwpx-loading]');
    if (note) note.hidden = !loading;
  }
  function renderEdit() {
    for (const key of Object.keys(areas)) delete areas[key];
    const s = state, parts = [];
    parts.push(el('p', 'journal-muted', `바탕: ${s.source}`));
    if (s.store?.resumed) { const r = el('p', 'journal-muted', `임시저장본(${mdhm(s.store.resumed.at)})을 이어서 고쳐요.${s.store.resumed.otherBase ? ' 바탕이 그때와 달라 이름이 맞는 칸만 넣었어요.' : ''}`); r.dataset.hwpxResumed = ''; parts.push(r); }
    if (s.store?.conflicts.length) parts.push(conflictBox(s));
    if (s.store?.keep.length) parts.push(unplacedBox(s));
    const fields = el('div', 'journal-hwpx-fields');
    const field = (label, value, data) => {
      const wrap = el('label', 'journal-hwpx-field'); wrap.append(el('span', '', label));
      const input = el('input'); input.type = 'text'; input.value = value; input.dataset[data] = ''; wrap.append(input);
      fields.append(wrap); return input;
    };
    const me = field('담당 팀원 칸의 내 이름', s.me, 'hwpxMe');
    // 이름을 바꾸면 내 줄이 달라진다: 고친 칸은 이름으로 다시 넣고, 못 넣은 칸은 접어 둔다(버리지 않음).
    me.addEventListener('change', () => { const kept = currentDraft(state); state.me = me.value.trim(); state.meFrom = 'typed'; rebase(); placeCells(state, kept); renderEdit(); typed('me'); });
    const date = field('■ 일시', s.date, 'hwpxDate');
    date.addEventListener('input', () => { state.date = date.value; state.built = null; typed('date'); });
    parts.push(fields);
    const meNote = el('p', 'journal-muted', s.meFrom === 'confirmed' ? '담당 팀원 칸 이름은 직전 주 확정본에 쓴 표기 그대로예요.'
      : s.meFrom === 'profile' ? '직전 주 확정본에서 내 이름 표기를 찾지 못해 프로필 이름을 썼어요.' : '담당 팀원 칸 이름을 직접 고쳤어요.');
    meNote.dataset.hwpxMeFrom = s.meFrom || ''; parts.push(meNote);
    const orgLine = s.context.orgFailed ? '담당 사업장을 읽지 못해 산하조직 표는 비워요.'
      : s.context.orgFallback ? `담당 사업장이 지정되지 않아 모든 조직(${s.context.organizations.length}곳)을 내 조직으로 봤어요. 내 프로필 → 담당 사업장에서 정할 수 있어요.`
      : `내 담당 조직 ${s.context.organizations.length}곳(내 프로필 → 담당 사업장 기준)`;
    const o = el('p', 'journal-muted', orgLine); o.dataset.hwpxOrgs = ''; parts.push(o);
    const req = el('p', 'journal-muted', ''); req.dataset.hwpxRequests = ''; parts.push(req);
    if (s.plans?.length) {
      const plans = el('details', 'journal-hwpx-plans'); plans.dataset.hwpxPlans = '';
      plans.append(el('summary', '', `보고일(${formDay(reportDay(s.start))})보다 지난 날짜의 '예정' ${s.plans.length}줄에서 '예정'만 뺐어요(파란 글씨).`));
      const list = el('ul', 'journal-hwpx-material');
      for (const c of s.plans) { const li = el('li'); li.append(el('span', 'journal-weekly-label', `${c.where}: `), doc.createTextNode(`${c.from.trim()} → ${c.to.trim()}`)); list.append(li); }
      plans.append(list); parts.push(plans);
    }
    // ORG-쟁의단계 ②: 투쟁 사업장 표를 쟁의 단계로 채웠는지(못 읽었으면 직전 확정본 줄 그대로) + 더는 투쟁 중이 아닌데 확정본에 있던 줄('지울까요?').
    const stageState = s.context.stages?.status;
    if (stageState && stageState !== 'ready') { const n = el('p', 'journal-muted', stageState === 'preparing' ? '쟁의 단계가 아직 준비 중이라 투쟁 사업장 표는 직전 확정본 그대로예요.' : '단계를 불러오지 못했어요. 투쟁 사업장 표는 직전 확정본 그대로예요.'); n.dataset.hwpxStageNote = stageState; parts.push(n); }
    if (s.stageFixes?.length) {
      const fix = el('details', 'journal-hwpx-plans'); fix.dataset.hwpxStageFix = ''; fix.open = true;
      fix.append(el('summary', '', `고칠 목록: 직전 확정본에 있던 투쟁 사업장 줄 ${s.stageFixes.length}곳이 더는 투쟁 중이 아니에요. 지울까요?`));
      const list = el('ul', 'journal-hwpx-material');
      for (const f of s.stageFixes) {
        const li = el('li'); li.dataset.hwpxStageFixRow = String(f.index);
        li.append(el('span', 'journal-weekly-label', `${f.org}: `), doc.createTextNode(f.stage ? `지금 단계는 ‘${f.stage}’이에요. ` : ''));
        const clear = button('줄 비우기', 'hwpxStageClear'); clear.dataset.hwpxIndex = String(f.index); li.append(clear); list.append(li);
      }
      fix.append(list); parts.push(fix);
    }
    parts.push(el('p', 'journal-muted', '1. 2) 주요 일정과 세부 내용·집회 표는 비워요. 바탕과 다른 줄은 파란 글씨가 돼요.'));
    const cal = el('p', 'journal-muted', ''); cal.dataset.hwpxCalendar = ''; parts.push(cal);
    const loading = el('div', 'journal-muted'); loading.innerHTML = waitHtml({rows: 1}); loading.dataset.hwpxLoading = ''; loading.hidden = true; parts.push(loading);

    const sum = el('section', 'journal-hwpx-part'); sum.dataset.hwpxPart = 'summary';
    sum.append(el('h5', 'journal-weekly-sub', '2. 1) 요약 — 내 줄'));
    if (!s.me || !s.rows.length) { const p = el('p', 'journal-muted', TEXT.noMine); p.dataset.hwpxNoMine = ''; sum.append(p); }
    for (const row of s.rows) sum.append(lineBox('summary', row, `${row.area} › ${row.task || '—'}`));
    parts.push(sum);
    if (s.sites.length) {
      const sites = el('section', 'journal-hwpx-part'); sites.dataset.hwpxPart = 'sites';
      sites.append(el('h5', 'journal-weekly-sub', '3. 2) 투쟁 사업장 현황 — 내 담당 조직'));
      for (const row of s.sites) sites.append(lineBox('sites', row, row.org));
      parts.push(sites);
    }
    const orgs = el('section', 'journal-hwpx-part'); orgs.dataset.hwpxPart = 'orgs';
    orgs.append(el('h5', 'journal-weekly-sub', '4. 1) 산하조직 현황 — 내 담당 조직'));
    if (!s.orgs.length) orgs.append(emptyEl());
    else orgs.append(el('p', 'journal-muted', '내 담당 조직 전부(가나다순). 확정본에 없던 조직은 현황 칸이 비어요.'));
    for (const row of s.orgs) orgs.append(lineBox('orgs', row, row.org));
    parts.push(orgs);
    // 5. 주요 일정 — 제목 확인(WEEKLY-일정다듬기 ④)과 본문·일정표 다름(⑤). 목록은 달력 일정이 오면 renderTitles가 채운다.
    const sched = el('section', 'journal-hwpx-part'); sched.dataset.hwpxPart = 'schedule'; sched.hidden = true;
    const schedHead = el('div', 'journal-hwpx-schedule-head');
    schedHead.append(el('h5', 'journal-weekly-sub', '5. 주요 일정 — 제목 확인'), button('AI로 다듬기', 'hwpxTitlesAi'));
    const titleStatus = el('p', 'journal-muted'); titleStatus.dataset.hwpxTitlesStatus = ''; titleStatus.setAttribute('role', 'status'); titleStatus.setAttribute('aria-live', 'polite');
    const titleList = el('ul', 'journal-hwpx-titles'); titleList.dataset.hwpxTitles = '';
    const diff = el('details', 'journal-hwpx-plans'); diff.dataset.hwpxMismatch = ''; diff.hidden = true; diff.open = true;
    diff.append(el('summary', ''), el('ul', 'journal-hwpx-material'));
    const memoryFold = el('details', 'journal-hwpx-plans'); memoryFold.dataset.hwpxMemoryDropped = ''; memoryFold.hidden = true;
    memoryFold.append(el('summary', ''), el('ul', 'journal-hwpx-material'));
    sched.append(schedHead, titleStatus, titleList, memoryFold, diff);
    parts.push(sched);
    const rest = el('section', 'journal-hwpx-part'); rest.dataset.hwpxUnmatched = ''; rest.hidden = true;
    rest.append(el('h5', 'journal-weekly-sub', '줄을 찾지 못한 이번 주 기록'), el('p', 'journal-muted', '이름이 확정본 줄과 달라요. 붙일 줄을 골라 주세요.'), el('ul', 'journal-hwpx-material'));
    parts.push(rest);
    const actions = el('div', 'journal-hwpx-actions');
    actions.append(button('한글 파일 만들기(.hwpx)', 'hwpxBuild', 'primary'), button('HWP로 받기', 'hwpxHwp'), button('확정 — 자료실(Drive)에 저장', 'hwpxConfirm'), button('처음부터', 'hwpxRestart'), button('닫기', 'hwpxClose'));
    parts.push(actions);
    const remember = el('div', 'journal-hwpx-remember'); remember.dataset.hwpxRemember = ''; remember.hidden = true;
    parts.push(remember);
    body.replaceChildren(...parts);
    renderRemember();
    renderMaterial();
    renderRequestNote();
    paintTeam();
  }

  // 일정 줄마다: 날짜·시각 · 원래 제목(늘 보임) · 고칠 제목 칸 · 장소 칸(비우면 '미정') · [빼기]. 칸 값은 state.titles(일정 키 → {title, place}),
  // 뺀 일정은 state.drops(일정 키 → 'drop' | 'keep')에 두고 임시저장한다. 칸의 바탕은 기억(있으면) 아니면 달력 제목.
  // 기억으로 뺀 일정은 맨 아래 접힌 목록에만. 같은 일정 목록이면 다시 그리지 않아 쓰던 칸이 그대로다.
  function renderTitles(calendar) {
    const part = body.querySelector('[data-hwpx-part="schedule"]');
    if (!part || !state) return;
    const items = scheduleItems(calendar);
    part.hidden = !items.length;
    // 임시저장의 일정 제목·빼기는 일정 키로 다시 맞춘다. 달력에서 없어진 일정은 조용히 버린다(달력을 다 읽었을 때만).
    if (calendar && !calendar.loading && !calendar.failed?.length && !calendar.noCalendar) {
      const live = new Set(items.map(i => i.key));
      let gone = 0;
      for (const map of [state.titles, state.drops]) for (const key of [...map.keys()]) if (!live.has(key)) { map.delete(key); gone++; }
      if (gone) touchDraft();
    }
    const keys = items.map(i => `${i.key}\u0000${i.memo ? JSON.stringify(i.memo) : ''}\u0000${state.drops.get(i.key) ?? ''}`).join('\n');
    const list = part.querySelector('[data-hwpx-titles]');
    // 상자를 다시 그리면(renderEdit) 목록도 새것이라 열쇠가 같아도 그린다.
    if (keys === state.titleKeys && list.dataset.drawn === keys) return;
    state.titleKeys = keys; list.dataset.drawn = keys;
    state.titleItems = items.filter(i => !isDropped(i, state.drops));
    const remembered = items.filter(i => i.memo?.drop && state.drops.get(i.key) !== 'keep');
    list.replaceChildren(...items.filter(i => !remembered.includes(i)).map((item, n) => titleRow(item, n)));
    const fold = part.querySelector('[data-hwpx-memory-dropped]');
    fold.hidden = !remembered.length;
    if (remembered.length) {
      fold.querySelector('summary').textContent = `기억으로 뺀 일정 ${remembered.length}개`;
      fold.querySelector('ul').replaceChildren(...remembered.map(item => {
        const li = el('li'); li.dataset.hwpxMemoryDroppedItem = item.key;
        li.append(el('span', 'journal-weekly-day', `${item.label} ${item.time}`), doc.createTextNode(`${item.title} `));
        const back = button('이번 주만 넣기', 'hwpxTitleKeep'); back.dataset.hwpxEvent = item.key; back.setAttribute('aria-label', `이번 주만 넣기: ${item.title}`);
        li.append(back); return li;
      }));
    }
  }
  function titleRow(item, n) {
    const li = el('li', 'journal-hwpx-title'); li.dataset.hwpxTitle = item.key;
    const o = state.titles.get(item.key), base = defaultTitle(item), id = `journalHwpxTitle-${n}`, out = isDropped(item, state.drops);
    const when = el('span', 'journal-weekly-day', `${item.label} ${item.time}`);
    const origin = el('span', 'journal-hwpx-origin', `원래: ${item.title}${item.place ? ` / ${item.place}` : ''}`); origin.dataset.hwpxOrigin = '';
    const head = el('div', 'journal-hwpx-title-head'); head.append(when, origin);
    if (item.memo?.title) {
      const tag = el('span', 'journal-exec-carried', '기억'); tag.title = `기억한 이름: ${item.memo.title}`; tag.dataset.hwpxMemoryTag = ''; head.append(' ', tag);
      if (!o) { const back = button('이번 주만 원래대로', 'hwpxTitleOrigin'); back.dataset.hwpxEvent = item.key; back.setAttribute('aria-label', `이번 주만 원래 제목으로: ${item.title}`); head.append(' ', back); }
    }
    if (item.memo?.drop) { const tag = el('span', 'journal-exec-carried', '기억'); tag.title = '기억으로 빼는 일정 — 이번 주만 넣었어요'; tag.dataset.hwpxMemoryTag = ''; head.append(' ', tag); }
    const drop = button(out ? '다시 넣기' : '빼기', out ? 'hwpxTitlePut' : 'hwpxTitleDrop'); drop.dataset.hwpxEvent = item.key;
    drop.setAttribute('aria-label', `${out ? '다시 넣기' : '이번 주 파일에서 빼기'}: ${item.label} ${item.time} ${item.title}`);
    head.append(' ', drop);
    const title = el('input', 'journal-hwpx-title-input'); title.type = 'text'; title.id = id; title.value = o?.title ?? base.title; title.dataset.hwpxTitleInput = '';
    title.setAttribute('aria-label', `${item.label} ${item.time} 일정 제목`);
    const place = el('input', 'journal-hwpx-place-input'); place.type = 'text'; place.value = o?.place ?? base.place; place.placeholder = NO_PLACE; place.dataset.hwpxPlaceInput = '';
    place.setAttribute('aria-label', `${item.label} ${item.time} 일정 장소(비우면 ${NO_PLACE})`);
    title.disabled = place.disabled = out;
    const save = () => setTitle(item, title.value, place.value, li);
    title.addEventListener('input', save); place.addEventListener('input', save);
    const fields = el('div', 'journal-hwpx-title-fields'); fields.append(title, place);
    li.append(head, fields);
    li.dataset.changed = o ? 'true' : 'false';
    if (out) li.dataset.dropped = 'true';
    return li;
  }
  function setTitle(item, title, place, li) {
    const t = title.trim(), p = place.trim(), base = defaultTitle(item);
    if ((t || item.title) === base.title && p === (base.place ?? '')) state.titles.delete(item.key);
    else state.titles.set(item.key, {title:t || item.title, place:p});
    if (li) li.dataset.changed = state.titles.has(item.key) ? 'true' : 'false';
    state.built = null;
    renderMismatches();
    typed(`title:${item.key}`);
  }
  // [빼기]/[다시 넣기]/[이번 주만 넣기]/[이번 주만 원래대로]: 이 주 값만 바꾼다(기억은 [확정] 뒤 [기억하기]에서만).
  function setDrop(key, how) {
    const item = scheduleItems(fullCalendar()).find(i => i.key === key);
    if (!state || !item) return;
    const remembered = !!item.memo?.drop;
    if (how === 'drop') { if (remembered) state.drops.delete(key); else state.drops.set(key, 'drop'); }
    else if (how === 'put') { if (remembered) state.drops.set(key, 'keep'); else state.drops.delete(key); }
    else if (how === 'keep') state.drops.set(key, 'keep');
    else if (how === 'origin') { state.titles.set(key, {title:item.title, place:item.place}); state.titleKeys = ''; }
    state.built = null;
    renderTitles(fullCalendar());
    renderMismatches();
    typed(how === 'origin' ? `title:${key}` : `drop:${key}`);
    say(how === 'drop' ? '이번 주 파일에서 뺐어요. [확정] 뒤 다음 주에도 뺄지 고를 수 있어요.' : how === 'origin' ? '이번 주만 원래 제목으로 넣어요.' : '이번 주 파일에 넣어요.');
  }
  function renderMismatches() {
    const box = body.querySelector('[data-hwpx-mismatch]');
    if (!box || !state) return;
    const sections = [
      ...state.rows.map(r => ({where:`${r.area} › ${r.task || '—'}`, lines:state.edits.summary.get(r.index) ?? []})),
      ...state.sites.map(r => ({where:r.org, lines:state.edits.sites.get(r.index) ?? []})),
      ...state.orgs.map(r => ({where:r.org, lines:state.edits.orgs.get(r.index) ?? []})),
    ];
    const found = scheduleMismatches({sections, calendar:shownCalendar(), overrides:effectiveOverrides(scheduleItems(fullCalendar()), state.titles), orgs:state.context.organizations});
    box.hidden = !found.length;
    if (!found.length) return;
    box.querySelector('summary').textContent = `본문과 일정표가 다른 곳 ${found.length}개 — 확인해 주세요(자동으로 고치지 않아요)`;
    box.querySelector('ul').replaceChildren(...found.map(f => {
      const li = el('li'); li.dataset.hwpxMismatchItem = f.day;
      const cal = f.events.length ? `일정표: ${f.events.join(', ')}` : '일정표: 그날 일정 없음';
      li.append(el('span', 'journal-weekly-day', shortDay(f.day)), el('span', 'journal-weekly-label', `${f.where}${f.sure ? '' : '(같은 일인지 확인)'}: `),
        doc.createTextNode(`본문 ${f.body.join('·')} — ${cal}`));
      return li;
    }));
  }
  async function aiTitles(trigger) {
    const s = state, items = s?.titleItems ?? [];
    const note = body.querySelector('[data-hwpx-titles-status]');
    if (!items.length || !note) return;
    const mine = ++s.titleRun;
    const {body: request, refs, more} = titleRequest(s.start, items);
    trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); note.textContent = 'AI가 업무 기록을 보고 제목을 다듬는 중…';
    let r;
    try { r = await callAiAssist(request, {rt}, TITLE_TEXT); }
    finally { if (trigger.isConnected) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); } }
    if (state !== s || mine !== s.titleRun) return;
    if (!r.ok || r.data.week_start !== s.start) {
      const code = r.ok ? 'ai_invalid_response' : r.code;
      note.textContent = TITLE_TEXT[code] || TITLE_TEXT.internal_error; note.dataset.retry = String(aiSummaryRetryable(code)); return;
    }
    const answer = titleAnswer(r.data, refs);
    let changed = 0;
    // 사람이 이미 고친 칸은 건드리지 않는다. AI 제목이 원래와 같으면 그대로.
    for (const item of items) {
      const a = answer.get(item.key);
      if (!a || s.titles.has(item.key) || item.memo?.title) continue;
      if (a.title === item.title && (a.place || item.place) === item.place) continue;
      s.titles.set(item.key, {title:a.title, place:a.place || item.place});
      changed++;
    }
    s.titleKeys = ''; s.built = null;
    if (changed) touchDraft();
    renderTitles(getWeek().model?.calendar);
    renderMismatches();
    note.textContent = `${changed ? `${changed}개 일정 제목을 다듬었어요. 원래 제목과 비교해 칸에서 고쳐 주세요.` : '다듬을 제목이 없었어요.'}${more > 0 ? ` 한 번에 ${items.length - more}개까지라 ${more}개는 그대로예요.` : ''}${r.data.partial ? ' 기록이 많아 일부만 봤어요.' : ''}`;
  }

  async function build() {
    const {draft} = state;
    if (state.built) return state.built;
    const data = draft.assembleDraft({...state.base, date:state.date, requests:formRequests(requestRows().items), ...scheduleForm(shownCalendar(), state.me, state.titles)}, state.edits);
    const bytes = await draft.buildHwpx(state.template, data);
    // 파일 이름: 주간보고_보고일8자리_이름.hwpx — 이름은 로그인 사용자의 표시 이름(프로필 이름, 없으면 로그인 정보의 표시 이름; readContext).
    state.built = {bytes, changed:draft.changedCount(data), name:draft.fileNameFor(reportDay(state.start), state.context.me)};
    return state.built;
  }
  async function doBuild() {
    try { const b = await build(); download(b.bytes, b.name, 'application/hwp+zip'); say(`"${b.name}"을(를) 내려받았어요. 바뀐 줄 ${b.changed}개는 파란 글씨예요.`, 'ok'); void recordIssued(state, b.bytes); }
    catch (error) { say(error?.code ? error.message : '한글 파일을 만들지 못했어요.', 'error'); }
  }
  async function doHwp() {
    const mine = run;
    try {
      const b = await build();
      say('HWP로 바꾸는 중…');
      engine ||= createEngine();
      const hwp = await engine.toHwp(b.bytes);
      if (mine !== run) return;
      const name = b.name.replace(/\.hwpx$/, '.hwp');
      download(hwp, name, 'application/x-hwp'); say(`"${name}"을(를) 내려받았어요.`, 'ok'); void recordIssued(state, b.bytes);
    } catch (error) { if (mine === run) say(error?.code ? error.message : 'HWP로 바꾸지 못했어요. .hwpx 파일을 써 주세요.', 'error'); }
  }
  async function doConfirm(trigger) {
    const mine = run;
    if (state.saved?.kind === 'created') { say('이 초안은 이미 자료실에 저장했어요. 고친 뒤 다시 저장하려면 [처음부터]로 새로 만들어 주세요.', 'ok'); return; }
    let b;
    try { b = await build(); } catch (error) { say(error?.code ? error.message : '한글 파일을 만들지 못했어요.', 'error'); return; }
    if (!window.confirm(`"${b.name}"을(를) 확정본으로 자료실(Drive)에 저장할까요?`)) return;
    const {drive} = await lazy();
    trigger.disabled = true; trigger.setAttribute('aria-busy', 'true');
    say('자료실에 저장하는 중…');
    try {
      const result = await drive.saveWeeklyReport(b.bytes, {fileName:b.name, title:`주간보고 ${state.date}`, documentDate:reportDay(state.start)}, {rt});
      if (mine !== run) return;
      state.saved = result;
      say(result.message, result.kind === 'created' ? 'ok' : 'error');
      if (result.kind === 'created' && state.store) { state.store.confirmed = {document_id:String(result.document?.id ?? ''), at:new Date().toISOString()}; state.store.dirty = true; await recordIssued(state, b.bytes, false); recordFeedback(state); void saveDraft(state); }
      if (result.kind === 'created') offerMemory(state);
      // An unknown outcome may have saved: the button stays off until the owner checks the library.
      if (result.kind !== 'unknown') trigger.disabled = result.kind === 'created';
    } finally { trigger.removeAttribute('aria-busy'); }
  }

  // ---- 환류: [확정] 뒤 "다음 주에도 쓸까요?" (weekly-schedule-memory.js) ----
  // 후보는 확정한 그 순간의 값으로 정한다(그 뒤에 고친 칸은 다음 확정 때). 기억 칸을 읽지 못한 주(준비 전 포함)는 묻지 않는다.
  function offerMemory(s) {
    const r = getWeek().model?.remembered;
    if (!r?.ready) return; // 칸이 없거나 읽지 못하면 기억 없음 — 지금처럼(묻지 않음)
    const {candidates, used} = memoryCandidates(scheduleItems(fullCalendar()), {titles:s.titles, drops:s.drops});
    const day = reportDay(s.start);
    s.remember = {status:candidates.length ? 'ask' : 'none', candidates, used, day};
    renderRemember();
    // 물을 것이 없어도 이 주에 실제 적용된 기억은 마지막 적용일을 한 번에 갱신한다.
    if (!candidates.length && used.length) void writeMemory(s, []);
  }
  async function writeMemory(s, picked) {
    const m = s.remember;
    m.status = 'saving'; renderRemember();
    const result = await changeMemory(list => withUsed(withEntries(list, picked, m.day), m.used, m.day), rt);
    if (state !== s) return;
    if (result.ok) { m.status = picked.length ? 'saved' : 'none'; m.saved = picked.length; onMemory?.(result.list); }
    else m.status = picked.length ? 'failed' : 'none';
    renderRemember();
  }
  function renderRemember() {
    const box = body.querySelector('[data-hwpx-remember]'), m = state?.remember;
    if (!box) return;
    box.hidden = !m || m.status === 'none';
    if (box.hidden) { box.replaceChildren(); return; }
    if (m.status === 'saved') { const p = el('p', 'journal-muted', `${m.saved}개를 기억했어요. 다음 주 초안에 먼저 넣어요([주간 정리] 맨 아래 ‘주간보고 기억’에서 지울 수 있어요).`); p.dataset.hwpxRememberDone = ''; box.replaceChildren(p); return; }
    const fold = el('details', 'journal-hwpx-plans'); fold.open = true; fold.dataset.hwpxRememberAsk = '';
    fold.append(el('summary', '', `다음 주에도 쓸까요? 달력 제목과 다르게 확정한 일정·뺀 일정 ${m.candidates.length}개`));
    const list = el('ul', 'journal-hwpx-material');
    m.candidates.forEach((c, i) => {
      const li = el('li'); li.dataset.hwpxRememberItem = c.key;
      const label = el('label', 'journal-hwpx-remember-pick');
      const box_ = el('input'); box_.type = 'checkbox'; box_.checked = c.checked; box_.dataset.hwpxRememberCheck = String(i);
      box_.addEventListener('change', () => { c.checked = box_.checked; });
      label.append(box_, ' ', el('span', 'journal-weekly-day', c.label), doc.createTextNode(c.drop ? `${c.origin} → 빼기` : `${c.origin} → ${c.title}${c.place ? `(${c.place})` : ''}`));
      li.append(label); list.append(li);
    });
    const note = el('p', 'journal-muted', '체크를 풀면 이번 주만이에요. 같은 원래 제목 일정에 적용돼요(달력은 그대로).');
    const go = button('기억하기', 'hwpxRememberGo'); go.disabled = m.status === 'saving';
    const say_ = el('p', 'journal-line-status', m.status === 'failed' ? '기억하지 못했어요. 다시 눌러 주세요.' : m.status === 'saving' ? '기억하는 중…' : '');
    say_.setAttribute('role', 'status'); say_.setAttribute('aria-live', 'polite'); say_.dataset.hwpxRememberStatus = '';
    fold.append(list, note, go, say_);
    box.replaceChildren(fold);
  }

  // ---- 환류학습 2: [확정] 때 처음 초안 ↔ 내 최종 개인본 줄 비교(draft.feedback) ----
  // 사람이 확정한 값만 배운다. 그 주 요청 표 행(owner 전용 서버 표)에만 남고 로그·오류 보고에 글을 쓰지 않는다.
  function recordFeedback(s) {
    const st = s?.store;
    if (!st || st.status === 'missing') return null;
    const proposed = st.extras?.proposed ?? proposedNow(s);
    st.extras = {...(st.extras ?? {}), proposed, feedback:feedbackRecord({week:s.start, at:nowIso(), proposed:proposed.cells, final:cellsNow(s)})};
    return st.extras.feedback;
  }

  // ---- 받은 초안 기록 (WEEKLY-개인본대조 W-2, draft.issued) ----
  // 파일을 내줄 때(.hwpx 받기·HWP로 받기·확정) 그 파일의 1~4절 글 줄을 그 주 임시저장 draft.issued 에 적는다. 새 표·새 저장소 없음(같은 서버 길, owner RLS).
  // 같은 줄이면 다시 쓰지 않고, 여러 번 내주면 가장 나중에 내준 것이 기준이다. 읽을 줄이 없거나 너무 길면 적지 않는다(원장 쪽이 그 주를 건너뜀). 실패해도 파일 받기는 그대로다.
  async function recordIssued(s, bytes, save = true) {
    const st = s?.store;
    if (!st || st.status === 'missing') return;
    let issued = null;
    try { issued = await s.draft.issuedFrom(bytes, new Date().toISOString()); } catch { return; }
    if (!issued || sameIssuedLines(st.issued, issued)) return;
    st.issued = issued;
    if (save) { st.dirty = true; void saveDraft(s); }
  }

  // ---- 임시저장 (weekly-draft-store.js) ----
  // The week's saved draft, read once a box opening (a reopen reads it again).
  function readDraftFor(start) {
    if (weekDraft?.start === start) return weekDraft.flight;
    const entry = {start};
    entry.flight = readWeekDraft(start, rt).catch(() => ({failed:true}));
    weekDraft = entry;
    return entry.flight;
  }
  // Cell names (not row numbers): summary 'area›task', organizations by name; the same name twice is told apart by n.
  function indexCells(s) {
    s.cellOf = {}; s.cellAt = new Map(); s.initial = new Map();
    for (const [section, list, keyOf] of [['summary', s.rows, summaryKey], ['orgs', s.orgs, orgKey], ['sites', s.sites, orgKey]]) {
      const keys = cellKeys(list, keyOf), map = new Map();
      list.forEach((row, i) => { const id = cellId(section, keys[i].key, keys[i].n); map.set(row.index, id); s.cellAt.set(id, {section, index:row.index}); s.initial.set(id, [...(s.edits[section].get(row.index) ?? [])]); });
      s.cellOf[section] = map;
    }
  }
  function currentDraft(s) {
    const cells = new Map([...s.cellAt].map(([id, at]) => [id, s.edits[at.section].get(at.index) ?? []]));
    const typedMe = s.meFrom === 'typed';
    return makeDraft({base:s.baseInfo ? {...s.baseInfo, digest:s.digest} : null, me:typedMe ? s.me : '', meFrom:typedMe ? 'typed' : '', date:s.date === s.defaultDate ? '' : s.date, cells, initial:s.initial,
      keep:s.store?.keep ?? [], titles:s.titles, drops:s.drops, docs:s.docs ?? [], areas:s.areas ?? null, confirmed:s.store?.confirmed ?? null, issued:s.store?.issued ?? null, extras:s.store?.extras ?? null});
  }
  // Put a draft's cells into the current base by name; what does not fit is kept aside (shown folded, saved again as it was).
  function placeCells(s, d) {
    const placed = placeDraft(d, new Set(s.cellAt.keys()));
    for (const [id, at] of s.cellAt) s.edits[at.section].set(at.index, placed.cells.has(id) ? placed.cells.get(id) : [...s.initial.get(id)]);
    if (s.store) s.store.keep = placed.unplaced;
    s.built = null;
    return placed;
  }
  // A whole draft into the box: name and date first (my rows depend on the name), then the cells and the schedule titles.
  function applyDraft(s, d) {
    const typedMe = d.me_from === 'typed' && !!d.me, me = typedMe ? d.me : s.meResolved;
    s.meFrom = typedMe ? 'typed' : s.meResolvedFrom;
    if (me !== s.me) { s.me = me; rebase(); }
    s.date = d.date || s.defaultDate;
    const placed = placeCells(s, d);
    s.titles = placed.titles; s.drops = placed.drops; s.docs = draftDocs(d); s.areas = draftAreaSummaries(d); s.titleKeys = '';
    return placed;
  }
  async function attachDraft(s, baseInfo, saved) {
    s.baseInfo = baseInfo ?? null;
    s.store = {status:'idle', known:null, last:null, timer:0, conflicts:[], keep:[], dirty:false, flight:null, again:false, confirmed:null, resumed:null, savedAt:null, issued:null, extras:{}};
    s.digest = await baseDigest(s.initial).catch(() => '');
    if (saved?.missing) { s.store.status = 'missing'; paintDraft(); return; }
    if (saved?.failed) { s.store.status = 'readFailed'; paintDraft(); return; }
    s.store.known = saved.row;
    const d = saved.row?.draft;
    s.store.last = d ?? null;
    s.store.issued = d?.issued ?? null;
    s.store.extras = draftExtras(d); // 처음 초안·고침 기록·규칙 목록: 이 상자는 읽은 그대로 다시 실어 보낸다(처음 초안이 없을 때만 지금 바탕으로 정함)
    s.docs = draftDocs(d);
    s.areas = draftAreaSummaries(d); // 사업영역 한 줄 요약: 이 상자는 고치지 않고 읽은 그대로 다시 실어 보낸다
    s.store.savedAt = saved.row?.saved_at ?? null;
    if (hasContent(d)) {
      applyDraft(s, d);
      s.store.confirmed = d.confirmed ?? null;
      s.store.resumed = {at:saved.row.saved_at, otherBase:!!(d.base?.digest && s.digest && d.base.digest !== s.digest)};
      s.store.status = 'saved';
    }
    paintDraft();
  }
  // Typing in a cell: a question still open about that cell is answered "this device".
  function typed(cell) {
    const st = state?.store;
    if (st?.conflicts.length) { const before = st.conflicts.length; st.conflicts = st.conflicts.filter(c => c.cell !== cell); if (st.conflicts.length !== before) paintConflicts(); }
    touchDraft();
  }
  function touchDraft() {
    const s = state, st = s?.store;
    if (!st || st.status === 'missing') return;
    st.dirty = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { void saveDraft(s); }, draftDelay);
  }
  // Another device's draft (theirs) against mine and the last version both had: one-side changes merge, a cell changed on both asks.
  // Returns the draft to write next. A box already closed (or another week's) is not redrawn: the merged draft is written as it is
  // (a cell changed on both keeps the other device's value — nothing is asked on a closed box).
  function mergeIn(s, theirs, mine = currentDraft(s)) {
    const st = s.store;
    const {draft: merged, conflicts} = merge3(st.last, mine, theirs);
    st.last = theirs ?? null;
    st.issued = merged.issued ?? null; // 받은 초안 기록은 더 나중에 낸 쪽(다른 기기 것일 수 있음)
    st.extras = draftExtras(merged); // 처음 초안·고침 기록·규칙 목록도 칸마다 더 나중 것
    s.areas = draftAreaSummaries(merged); // 사업영역 한 줄 요약도 합친 판(서버가 그사이 쓴 AI 줄 포함)
    if (state !== s) return merged;
    // Nothing came from the other side (e.g. a row made by the request table meanwhile): keep the box as it is.
    if (!conflicts.length && sameDraft(merged, mine)) return currentDraft(s);
    const focus = doc.activeElement?.id, at = [doc.activeElement?.selectionStart, doc.activeElement?.selectionEnd];
    applyDraft(s, merged);
    st.conflicts = [...st.conflicts.filter(c => !conflicts.some(n => n.cell === c.cell)), ...conflicts];
    if (state === s && !panel.hidden && s.cellAt) {
      renderEdit();
      const back = focus && doc.getElementById(focus);
      if (back) { back.focus(); try { back.setSelectionRange(at[0], at[1]); } catch { /* not a text field */ } }
    }
    return currentDraft(s);
  }
  async function saveDraft(s) {
    const st = s?.store;
    if (!st || st.status === 'missing') return;
    clearTimeout(st.timer);
    if (st.flight) { st.again = true; return st.flight; }
    if (!st.dirty) return;
    st.dirty = false; st.status = 'saving'; paintDraft();
    st.flight = (async () => {
      let mine = currentDraft(s);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!st.known) {
          const read = await readWeekDraft(s.start, rt);
          if (read.missing) { st.status = 'missing'; return; }
          st.known = read.row;
          if (read.row.draft) mine = mergeIn(s, read.row.draft, mine);
        }
        if (state === s) mine = currentDraft(s);
        const r = await writeWeekDraft({start:s.start, known:st.known, draft:mine}, rt);
        if (r.missing) { st.status = 'missing'; return; }
        if (r.ok) { st.known = r.row; st.last = mine; st.savedAt = r.row.saved_at; st.status = 'saved'; if (weekDraft?.start === s.start) weekDraft = null; return; }
        st.known = r.row;
        mine = mergeIn(s, r.row.draft, state === s ? currentDraft(s) : mine);
      }
      throw Object.assign(new Error('changed'), {code:'changed'});
    })().catch(() => { st.status = 'failed'; st.dirty = true; })
      .finally(() => { st.flight = null; if (state === s) paintDraft(); if (st.again) { st.again = false; if (st.dirty && state === s) void saveDraft(s); } });
    return st.flight;
  }
  // Back on this screen: the server may hold a newer draft (written on the phone) — merge it the same way.
  async function syncDraft(s) {
    const st = s?.store;
    if (!st || st.flight || st.status === 'missing' || !st.known) return;
    let read;
    try { read = await readWeekDraft(s.start, rt); } catch { return; }
    if (state !== s || read.missing || st.flight) return;
    if ((read.row.saved_at ?? null) === (st.known.saved_at ?? null)) return;
    st.known = read.row;
    mergeIn(s, read.row.draft);
    if (!sameDraft(currentDraft(s), read.row.draft)) { st.dirty = true; void saveDraft(s); }
    paintDraft();
  }
  function paintDraft() {
    const st = state?.store;
    draftLine.hidden = !st || panel.hidden;
    if (!st) { draftLine.replaceChildren(); return; }
    draftLine.dataset.kind = st.status === 'failed' ? 'error' : '';
    if (st.status === 'missing') draftLine.replaceChildren(DRAFT_TEXT.missing);
    else if (st.status === 'saving') draftLine.replaceChildren(DRAFT_TEXT.saving);
    else if (st.status === 'failed') { const again = button('다시', 'hwpxDraftRetry'); again.setAttribute('aria-label', '임시저장 다시'); draftLine.replaceChildren(DRAFT_TEXT.failed, again); }
    else if (st.status === 'readFailed') draftLine.replaceChildren(DRAFT_TEXT.readFailed);
    else if (st.savedAt && st.status === 'saved') draftLine.replaceChildren(`임시저장 ${hm(st.savedAt)}`);
    else draftLine.replaceChildren('고치면 서버에 임시저장해요.');
  }
  const cellLabel = cell => {
    if (cell === 'me') return '담당 팀원 칸의 내 이름';
    if (cell === 'date') return '■ 일시';
    if (cell.startsWith('area:')) return '사업요약표 사업영역 한 줄';
    if (cell.startsWith('title:') || cell.startsWith('drop:')) { const key = cell.slice(cell.indexOf(':') + 1), item = scheduleItems(fullCalendar()).find(i => i.key === key); return `5. 주요 일정 ${item ? `${item.label} ${item.time} ${item.title}` : ''}${cell.startsWith('drop:') ? ' 빼기' : ''}`.trim(); }
    const {section, key, n} = parseCellId(cell.slice(4));
    return `${SECTION_NAME[section] ?? section} · ${key.replace('›', ' › ')}${n ? ` (${n + 1}번째)` : ''}`;
  };
  const cellText = value => (value === 'drop' ? '뺌' : value === 'keep' ? '넣음' : value == null ? '(바탕 그대로)' : Array.isArray(value) ? value.filter(l => l.trim()).join(' / ') || '(빈 칸)' : typeof value === 'object' ? [value.title, value.place].filter(Boolean).join(' / ') : String(value));
  function conflictBox(s) {
    const box = el('details', 'journal-hwpx-plans'); box.dataset.hwpxConflicts = ''; box.open = true;
    box.append(el('summary', '', `다른 기기에서도 고친 칸 ${s.store.conflicts.length}개 — 어느 쪽으로 할까요? (고를 때까지 다른 기기 것을 둬요)`));
    const list = el('ul', 'journal-hwpx-material');
    s.store.conflicts.forEach((c, i) => {
      const li = el('li'); li.dataset.hwpxConflictItem = c.cell;
      li.append(el('span', 'journal-weekly-label', `${cellLabel(c.cell)}: `), doc.createTextNode(`이 기기 ‘${cellText(c.mine)}’ · 다른 기기 ‘${cellText(c.theirs)}’ `));
      const mine = button('이 기기 것', 'hwpxConflictPick'); mine.dataset.hwpxConflictPick = 'mine'; mine.dataset.hwpxConflict = String(i);
      const theirs = button('다른 기기 것', 'hwpxConflictPick'); theirs.dataset.hwpxConflictPick = 'theirs'; theirs.dataset.hwpxConflict = String(i);
      li.append(mine, theirs); list.append(li);
    });
    box.append(list);
    return box;
  }
  function paintConflicts() { if (state && !panel.hidden) renderEdit(); }
  function pickConflict(i, side) {
    const s = state, c = s?.store?.conflicts[i];
    if (!c) return;
    s.store.conflicts.splice(i, 1);
    if (side === 'mine') {
      const v = c.mine;
      if (c.cell === 'me') { const kept = currentDraft(s); s.me = v ?? s.meResolved; s.meFrom = v ? 'typed' : s.meResolvedFrom; rebase(); placeCells(s, kept); }
      else if (c.cell === 'date') s.date = v ?? s.defaultDate;
      else if (c.cell.startsWith('title:')) { const key = c.cell.slice(6); if (v) s.titles.set(key, {title:v.title, place:v.place}); else s.titles.delete(key); s.titleKeys = ''; }
      else if (c.cell.startsWith('area:')) { const id = c.cell.slice(5), areas = {...(s.areas ?? {})}; if (v) areas[id] = {text:v, hash:'', edited:true, at:new Date().toISOString()}; else delete areas[id]; s.areas = areas; }
      else if (c.cell.startsWith('drop:')) { const key = c.cell.slice(5); if (v) s.drops.set(key, v); else s.drops.delete(key); s.titleKeys = ''; }
      else { const at = s.cellAt.get(c.cell.slice(4)); if (at) s.edits[at.section].set(at.index, v ?? [...s.initial.get(c.cell.slice(4))]); }
      s.built = null;
    }
    renderEdit();
    touchDraft();
  }
  function unplacedBox(s) {
    const box = el('details', 'journal-hwpx-plans'); box.dataset.hwpxUnplaced = '';
    box.append(el('summary', '', `넣지 못한 임시저장 칸 ${s.store.keep.length}개 — 바탕에 같은 이름 칸이 없어요(지우지 않고 남겨 둬요, 복사해 붙일 수 있어요)`));
    const list = el('ul', 'journal-hwpx-material');
    for (const r of s.store.keep) { const li = el('li'); li.append(el('span', 'journal-weekly-label', `${cellLabel(`row:${cellId(r.section, r.key, r.n)}`)}: `), doc.createTextNode(r.lines.filter(l => l.trim()).join('\n'))); list.append(li); }
    box.append(list);
    return box;
  }
  async function clearSaved(saved, week, box) {
    if (!window.confirm('이 주 임시저장본을 지우고 처음부터 할까요?')) return;
    try {
      const r = await writeWeekDraft({start:week, known:saved, draft:keepDocsOnly(saved.draft)}, rt);
      if (r.conflict) { say('다른 기기가 그사이 임시저장했어요. 상자를 닫았다 다시 열어 확인해 주세요.', 'error'); return; }
      weekDraft = null; box.remove(); say('임시저장본을 지웠어요.');
    } catch { say('임시저장본을 지우지 못했어요. 잠시 뒤 다시 해 주세요.', 'error'); }
  }
  // [처음부터] in the box: with a saved draft, ask first and empty it on the server.
  async function restart() {
    const s = state, st = s?.store;
    const saved = st && st.status !== 'missing' && (hasContent(st.last) || (st.dirty && hasContent(currentDraft(s))));
    if (saved) {
      if (!window.confirm('이 주 임시저장본을 지우고 처음부터 할까요?')) return;
      clearTimeout(st.timer); st.dirty = false;
      await st.flight;
      try {
        const r = await writeWeekDraft({start:s.start, known:st.known ?? {exists:true, saved_at:null}, draft:keepDocsOnly(putIssued(st.known?.draft ?? st.last, st.issued))}, rt);
        if (r.conflict) { say('다른 기기가 그사이 임시저장했어요. 다시 [처음부터]를 눌러 주세요.', 'error'); st.known = r.row; return; }
      } catch { say('임시저장본을 지우지 못했어요. 잠시 뒤 다시 해 주세요.', 'error'); st.dirty = true; return; }
    }
    if (state !== s) return;
    if (!saved && st?.dirty) void saveDraft(s); // 아직 못 쓴 받은 초안 기록(issued)만 있을 때
    state = null; weekDraft = null; paintDraft(); say(saved ? '임시저장본을 지웠어요.' : ''); renderSource();
  }
  doc.addEventListener('visibilitychange', () => {
    if (!state?.store) return;
    if (doc.visibilityState === 'hidden') { if (state.store.dirty) void saveDraft(state); }
    else void syncDraft(state);
  });
  // A draft that could not be saved yet: warn before the page goes away (what was typed is only on this screen).
  doc.defaultView?.addEventListener('beforeunload', event => { const st = state?.store; if (st && st.status !== 'missing' && (st.dirty || st.flight)) { event.preventDefault(); event.returnValue = ''; } });

  host.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if (b.matches('[data-hwpx-start]')) open();
    else if (b.matches('[data-hwpx-close]')) { close(); start.focus(); }
    else if (b.matches('[data-hwpx-library]')) fromLibrary();
    else if (b.matches('[data-hwpx-team-use]') && state) useTeam(b.dataset.hwpxTeamCell);
    else if (b.matches('[data-hwpx-stage-clear]') && state) { const index = Number(b.dataset.hwpxIndex); state.edits.sites.set(index, []); state.stageFixes = state.stageFixes.filter(f => f.index !== index); state.built = null; renderEdit(); say('줄을 비웠어요.'); typed(`row:${state.cellOf.sites.get(index)}`); }
    else if (b.matches('[data-hwpx-restart]')) void restart();
    else if (b.matches('[data-hwpx-draft-retry]')) { if (state?.store) { state.store.dirty = true; void saveDraft(state); } }
    else if (b.matches('[data-hwpx-conflict-pick]')) pickConflict(Number(b.dataset.hwpxConflict), b.dataset.hwpxConflictPick);
    else if (b.matches('[data-hwpx-append]')) { const key = b.dataset.hwpxTarget || doc.getElementById(b.dataset.hwpxPickFrom)?.value; if (!key) return; append(key, b.dataset.hwpxText); say('붙였어요. 칸에서 고칠 수 있어요.'); }
    else if (!state) return;
    else if (b.matches('[data-hwpx-build]')) doBuild();
    else if (b.matches('[data-hwpx-hwp]')) doHwp();
    else if (b.matches('[data-hwpx-confirm]')) doConfirm(b);
    else if (b.matches('[data-hwpx-titles-ai]')) aiTitles(b);
    else if (b.matches('[data-hwpx-title-drop]')) setDrop(b.dataset.hwpxEvent, 'drop');
    else if (b.matches('[data-hwpx-title-put]')) setDrop(b.dataset.hwpxEvent, 'put');
    else if (b.matches('[data-hwpx-title-keep]')) setDrop(b.dataset.hwpxEvent, 'keep');
    else if (b.matches('[data-hwpx-title-origin]')) setDrop(b.dataset.hwpxEvent, 'origin');
    else if (b.matches('[data-hwpx-remember-go]') && state?.remember) void writeMemory(state, state.remember.candidates.filter(c => c.checked));
  });

  return {
    // The shown week or the owner changed: a draft belongs to one week, so it closes.
    setWeek(week) { if (state && week !== state.start) close('주가 바뀌어 한글 파일 초안을 닫았어요.'); },
    // The week's reads landed: refresh only the candidates beside the rows (what was typed stays).
    refresh() { if (state) state.built = null; renderMaterial(); renderRequestNote(); },
    close,
  };
}
