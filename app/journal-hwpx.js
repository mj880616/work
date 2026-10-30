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
// - WEEKLY-주요일정칸(요청함 10/30 13:17·13:38, weekly-schedule-rows.mjs): 5. 주요 일정 줄마다 날짜(달력)·시간('종일' 가능)·제목·장소·참석·[빼기] 칸이
//   따로다(원래: 줄 그대로). 고친 값은 일정 키 열쇠의 칸별 고침(draft.titles)으로 임시저장하고, [주간 정리] 1. 2) 주요 일정 수기 표에서 달력으로 넣은
//   줄도 같은 항목을 고친다(두 곳 같은 자료). 한글 파일에는 지금처럼 '10:30 / 제목 / 장소' 한 줄. 기억은 제목·장소만(날짜·시간·참석은 그 회차 값).
//   1. 2) 주요 일정 칸에는 [주간 정리] 수기 표 줄(draft.hq)을 '- 11.6.(금) 13:00 / 내용 / 장소'로 넣는다(이 상자는 그 줄을 읽은 그대로 다시 실어 보냄).
//   3. 2) 투쟁 사업장 현황: 사업장 줄 ⋯ → [이번 주 보고에서 빼기](위쪽 "○○을 뺐어요 [되돌리기]", 적은 글은 칸에 그대로), 맨 아래 [+ 사업장 추가]
//   (내 담당 조직에서만), ⠿로 끌어 순서. 구성은 draft.site_layout — 그 주에 없으면 가장 가까운 지난주 구성을 이어 쓴다. 파일에는 들어간 사업장만.
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
import {cellKeys, cellId, parseCellId, summaryKey, orgKey, makeDraft, putIssued, placeDraft, merge3, sameDraft, hasContent, baseDigest, readWeekDraft, writeWeekDraft, draftDocs, draftAreaSummaries, keepDocsOnly, draftExtras, draftHq, draftSiteLayout, readCarriedLayout} from './weekly-draft-store.js';
import {eventFields, editFrom, cleanTime, hqLines, arrangeSites, missingSites, siteHidden, siteShown, siteMoved, layoutSiteData, readSiteLayout, siteKey, ALL_DAY} from './weekly-schedule-rows.mjs';
import {mountReorder} from './reorder-drag.js';
import {sameIssuedLines} from './weekly-lines.mjs';
// LIB-파일이름그대로(2026-10-30 사용자 결정 A): [확정] 자료명은 파일 이름 그대로(주간보고_YYYYMMDD_이름 → "주간보고 YYYYMMDD 이름"). 본문 ■ 일시 글자(손으로 고칠 수 있음)로 정하지 않는다.
import {fileNameTitle} from './library-file-name.mjs';
import {pickBase, teamIsNewer, teamChanges, cellList, feedbackRecord, compareTest, whereOf, TEST_STATUS, readFeedback} from './weekly-feedback.mjs';
import {reviewCard, answerSuggestion, readLearnRows} from './weekly-learn-panel.js';
import {caretLine, askTargets, lineRequest, readAnswer, replaceLine, suggestKey, PICK_MS, PAUSE_MS, PER_OPEN} from './weekly-line-suggest.mjs';
import {isDropped, visibleCalendar, effectiveOverrides, memoryCandidates, withEntries, withUsed, changeMemory} from './weekly-schedule-memory.js';

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
// WEEKLY-환류학습 3·4·6: ai-assist weekly_draft(AI 초안·학습 시험)·weekly_review(환류 보고) 답의 일상어. 배포 전이면 바탕 그대로.
const LEARN_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready: 'AI 초안은 아직 준비 중이에요. 바탕 그대로 시작해요.',
  unsupported_kind: 'AI 초안은 아직 준비 중이에요. 바탕 그대로 시작해요.',
  not_found: '이 주 고침 기록을 서버에서 찾지 못했어요.',
  daily_limit: '오늘 AI를 쓸 수 있는 횟수를 다 썼어요. 바탕 그대로 시작해요.',
  monthly_limit: '이번 달 AI 한도에 닿았어요. 바탕 그대로 시작해요.',
});
const LEARN_BODY_BYTES = 60 * 1024; // 서버 상한(64KB)보다 조금 작게
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
export function mountWeeklyHwpx(host, {getWeek, onCopy, onCarry, onMemory, onDraft, rt = window.KPTURuntime, draftDelay = DRAFT_DELAY}) {
  if (!host) return null;
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = ''; return b; };
  let state = null, engine = null, lib = null, run = 0, confirmed = undefined, sourceRun = 0, weekDraft = null, siteDrag = null;
  const start = button('주간보고 한글 파일 만들기', 'hwpxStart', 'secondary');
  const panel = el('section', 'journal-hwpx-panel'); panel.hidden = true; panel.setAttribute('aria-labelledby', 'journalHwpxTitle');
  const title = el('h4', 'journal-heading', '주간보고 한글 파일(.hwpx)'); title.id = 'journalHwpxTitle'; title.tabIndex = -1;
  const status = el('p', 'journal-hwpx-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.hwpxStatus = '';
  const body = el('div', 'journal-hwpx-body');
  // 임시저장 한 줄: "임시저장 14:32" / "저장 중…" / "저장 못 함 — [다시]" / 준비 중. 상자 맨 위 제목 줄 오른쪽 끝에 작은 글씨로 둔다
  // (JOURNAL-임시저장자리, 요청함 10/30). 제목은 길면 말줄임, 이 줄은 글자만([다시]만 누름). 상자 안 다른 자리에는 두지 않는다.
  const head = el('div', 'journal-hwpx-head'); head.dataset.hwpxHead = '';
  const draftLine = el('p', 'journal-hwpx-draft'); draftLine.dataset.hwpxDraftStatus = ''; draftLine.hidden = true; draftLine.setAttribute('aria-live', 'polite');
  head.append(title, draftLine);
  // 사업장 빼기 뒤 "○○을 뺐어요 [되돌리기]" 한 줄(위쪽, 다음 바꿈까지).
  const undoLine = el('p', 'journal-hwpx-undo'); undoLine.dataset.hwpxUndo = ''; undoLine.hidden = true; undoLine.setAttribute('role', 'status'); undoLine.setAttribute('aria-live', 'polite');
  panel.append(head, status, undoLine, body);
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
    run++; sourceRun++; state = null; weekDraft = null; engine?.close(); engine = null; paintDraft(); undoLine.hidden = true; siteDrag?.destroy(); siteDrag = null;
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
      await load(bytes, found.file_name, info.format, `자료실${personal ? ' 개인본' : ''} · ${found.title || found.file_name}`, mine, {from:'library', document_id:String(found.id), file_name:String(found.file_name || ''), title:String(found.title || '')}, personal ? 'personal' : 'confirmed');
      if (mine !== run || !state) return;
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
  async function load(bytes, name, format, source, mine, baseInfo, baseKind = baseInfo?.from === 'file' ? 'file' : 'confirmed') {
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
      const [context, saved, carriedLayout] = await Promise.all([readContext(rt).catch(() => ({me:'', organizations:[], orgFallback:true, orgFailed:true})), readDraftFor(week.start), readCarriedLayout(week.start, rt)]);
      if (mine !== run) return;
      const who = draft.resolveMe(team, context.me);
      state = {draft, team, template, source, start:week.start, me:who.me, meFrom:who.from, meResolved:who.me, meResolvedFrom:who.from, date:draft.reportDate(reportDay(week.start)), context,
        myOrgs:draft.orgNames(context.organizations), aliases:new Map(context.organizations.map(o => [o.name, Array.isArray(o.aliases) ? o.aliases : []])), edits:null, built:null, saved:null, titles:new Map(), drops:new Map(), titleKeys:'', titleRun:0};
      state.defaultDate = state.date;
      state.baseKind = baseKind;
      // 3. 2) 투쟁 사업장 구성: 이 주 것 > 지난주에서 이어 쓴 것. 이 주에 구성이 생기면(바꾸면) layoutOwn.
      const ownLayout = draftSiteLayout(saved?.row?.draft);
      state.carriedLayout = carriedLayout; state.layout = ownLayout ?? carriedLayout; state.layoutOwn = !!ownLayout;
      state.hq = draftHq(saved?.row?.draft);
      rebase();
      await attachDraft(state, baseInfo, saved);
      if (mine !== run) return;
      carry(week);
      say('');
      // 환류학습 3: 그 주 처음 초안이 아직 없으면(처음 연 주) AI 초안을 한 번 쓴다(기록을 다 읽은 뒤 — renderMaterial). 있으면 그대로.
      state.ai = {status:state.store?.extras?.proposed ? (state.store.extras.proposed.ai ? 'done' : 'base') : 'wait', note:''};
      if (state.store?.status === 'missing' || state.store?.status === 'readFailed') state.ai.status = 'base';
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
    // 구성에 넣은 사업장이 바탕에 없으면 빈 칸으로 더한다(내 담당 조직 이름만).
    const add = missingSites(draft.editableOrgs(state.base, 'sites'), state.layout, state.context.organizations.map(o => o.name));
    if (add.length) state.base = {...state.base, sites:[...(state.base.sites ?? []), ...add.map(name => ({org:[name], status:[], paras:[]}))]};
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
    const key = `${section}:${row.index}`;
    area.addEventListener('input', () => { state.edits[section].set(row.index, area.value.split('\n')); state.built = null; renderMismatches(); typed(`row:${state.cellOf[section].get(row.index)}`); suggestSoon(key, PAUSE_MS); });
    // WEEKLY-환류입력창 ②: 줄을 고르면(초점·누름·화살표) 잠시 뒤 그 줄 옆 제안. 타자마다 묻지 않는다.
    for (const type of ['focus', 'click']) area.addEventListener(type, () => suggestSoon(key, PICK_MS));
    area.addEventListener('keyup', event => { if (/^(Arrow|Home|End|Page)/.test(event.key)) suggestSoon(key, PICK_MS); });
    areas[key] = area;
    const material = el('ul', 'journal-hwpx-material'); material.dataset.hwpxMaterial = key;
    const team = el('div', 'journal-hwpx-team'); team.dataset.hwpxTeam = key; team.hidden = true;
    const hint = el('p', 'journal-hwpx-suggest'); hint.dataset.hwpxSuggest = key; hint.hidden = true;
    box.append(name, team, area, hint, material);
    return box;
  }
  // ---- 환류입력창 ②: 줄 옆 '이렇게 바꾸면?'(ai-assist weekly_line) ----
  // 고르는 칸 한 개의 줄만, 이미 받은 줄은 다시 묻지 않는다(상자를 열 때마다 PER_OPEN 번까지). 서버가 없거나(배포 전) 한 번 실패하면 이 상자에선 조용히 끈다.
  // 누르면 그 줄만 바뀌고(칸 input 그대로 → 자동저장 2초 길), [되돌리기]로 원래 줄. 무시하면 아무 일 없다. 줄 글은 기록에 남기지 않는다.
  const suggestOf = s => (s.suggest ??= {cache:new Map(), asked:0, off:false, flight:false, timer:0, focus:'', undo:null});
  function suggestSoon(key, ms) {
    const s = state;
    if (!s) return;
    const g = suggestOf(s);
    g.focus = key;
    clearTimeout(g.timer);
    if (g.undo?.key !== key || (ms === PAUSE_MS && !g.applying)) g.undo = null; // 다른 칸으로 가거나 이어서 고치면 [되돌리기]는 거둔다
    for (const [k, node] of Object.entries(hints())) if (k !== key) node.hidden = true;
    g.timer = setTimeout(() => { if (state === s) void suggestNow(s, key); }, ms);
  }
  const hints = () => Object.fromEntries([...body.querySelectorAll('[data-hwpx-suggest]')].map(n => [n.dataset.hwpxSuggest, n]));
  function cellMaterial(s, key) {
    const [section, index] = key.split(':');
    if (section === 'sites') return [];
    const m = s.draft.weekMaterial(getWeek().model, s.rows, s.orgs, {aliases:s.aliases});
    const list = (section === 'summary' ? m.byRow : m.byOrg).get(Number(index)) ?? [];
    return list.map(x => `${x.day ? `${shortDay(x.day)} ` : ''}${x.text}`);
  }
  async function suggestNow(s, key) {
    const g = suggestOf(s), area = areas[key];
    if (!area || !area.isConnected || g.focus !== key) return;
    const [section, index] = key.split(':'), id = s.cellOf?.[section]?.get(Number(index));
    if (!id) return;
    const caret = caretLine(area.value, area.selectionStart), lines = area.value.split('\n');
    const ck = suggestKey(id, caret.text);
    if (g.cache.has(ck) || g.off || g.flight || g.asked >= PER_OPEN) { paintSuggest(s, key); return; }
    const targets = askTargets(lines, caret.index, g.cache, id);
    if (!targets.length) { paintSuggest(s, key); return; }
    const {request, refs} = lineRequest({week:s.start, where:whereOf(id), lines, targets, material:cellMaterial(s, key)});
    g.asked++; g.flight = true;
    let r;
    try { r = await callAiAssist(request, {rt}, LEARN_TEXT); } catch { r = {ok:false}; }
    g.flight = false;
    if (state !== s) return;
    if (!r.ok || r.data?.kind !== 'weekly_line' || r.data.week_start !== s.start) { g.off = true; return; }
    for (const [k, v] of readAnswer(r.data, refs, lines, id)) g.cache.set(k, v);
    if (g.focus === key) paintSuggest(s, key);
  }
  function paintSuggest(s, key) {
    const g = suggestOf(s), area = areas[key], hint = hints()[key];
    if (!area || !hint) return;
    const [section, index] = key.split(':'), id = s.cellOf?.[section]?.get(Number(index));
    if (g.undo?.key === key) {
      const u = g.undo;
      const back = button('되돌리기', 'hwpxSuggestUndo'); back.setAttribute('aria-label', `${u.index + 1}번째 줄 되돌리기`);
      back.addEventListener('click', () => {
        const next = replaceLine(area.value, u.index, u.text, u.before);
        g.undo = null; hint.hidden = true;
        if (next == null) return;
        area.value = next; area.focus(); area.dispatchEvent(new Event('input', {bubbles:true}));
      });
      hint.replaceChildren(el('span', 'journal-muted', `${u.index + 1}번째 줄을 바꿨어요.`), ' ', back);
      hint.hidden = false; return;
    }
    const caret = caretLine(area.value, area.selectionStart), text = id ? g.cache.get(suggestKey(id, caret.text)) : null;
    if (!text) { hint.hidden = true; hint.replaceChildren(); return; }
    const apply = el('button', 'mini journal-hwpx-suggest-apply'); apply.type = 'button'; apply.dataset.hwpxSuggestApply = '';
    apply.setAttribute('aria-label', `${caret.index + 1}번째 줄을 이렇게 바꾸기: ${text}`);
    apply.append(el('span', 'journal-hwpx-suggest-mark', '이렇게 바꾸면?'), ' ', el('span', null, text));
    apply.addEventListener('click', () => {
      const next = replaceLine(area.value, caret.index, caret.text, text);
      if (next == null) { hint.hidden = true; return; }
      g.cache.set(suggestKey(id, text), null); // 바꾼 줄은 다시 묻지 않는다
      g.undo = {key, index:caret.index, before:caret.text, text};
      g.applying = true;
      try { area.value = next; area.dispatchEvent(new Event('input', {bubbles:true})); } finally { g.applying = false; }
      clearTimeout(g.timer); // input 이 건 다음 제안 대기는 거둔다(되돌리기 줄을 남긴다)
      paintSuggest(s, key);
    });
    hint.replaceChildren(apply);
    hint.hidden = false;
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
    if (model && !loading && state.ai?.status === 'wait') void aiDraft(state, false);
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
    const hqNote = el('p', 'journal-muted'); hqNote.dataset.hwpxHq = ''; parts.push(hqNote);
    const ai = el('p', 'journal-muted'); ai.dataset.hwpxAiDraft = ''; ai.setAttribute('role', 'status'); ai.setAttribute('aria-live', 'polite'); parts.push(ai);
    const cal = el('p', 'journal-muted', ''); cal.dataset.hwpxCalendar = ''; parts.push(cal);
    const loading = el('div', 'journal-muted'); loading.innerHTML = waitHtml({rows: 1}); loading.dataset.hwpxLoading = ''; loading.hidden = true; parts.push(loading);

    const sum = el('section', 'journal-hwpx-part'); sum.dataset.hwpxPart = 'summary';
    sum.append(el('h5', 'journal-weekly-sub', '2. 1) 요약 — 내 줄'));
    if (!s.me || !s.rows.length) { const p = el('p', 'journal-muted', TEXT.noMine); p.dataset.hwpxNoMine = ''; sum.append(p); }
    for (const row of s.rows) sum.append(lineBox('summary', row, `${row.area} › ${row.task || '—'}`));
    parts.push(sum);
    if (s.sites.length || s.context.organizations.length) parts.push(sitesPart(s));
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
    actions.append(button('한글 파일 만들기(.hwpx)', 'hwpxBuild', 'primary'), button('HWP로 받기', 'hwpxHwp'), button('확정 — 자료실(Drive)에 저장', 'hwpxConfirm'), button('학습 시험', 'hwpxLearnTest'), button('처음부터', 'hwpxRestart'), button('닫기', 'hwpxClose'));
    parts.push(actions);
    // 환류학습 6·4: [학습 시험] 결과(저장하지 않음)와 [확정] 뒤 이번 주 환류 보고 한 장.
    const learn = el('div', 'journal-hwpx-learn'); learn.dataset.hwpxLearn = ''; learn.hidden = true; parts.push(learn);
    const review = el('div', 'journal-hwpx-learn'); review.dataset.hwpxReview = ''; review.hidden = true; parts.push(review);
    const remember = el('div', 'journal-hwpx-remember'); remember.dataset.hwpxRemember = ''; remember.hidden = true;
    parts.push(remember);
    body.replaceChildren(...parts);
    mountSiteDrag();
    paintHqNote();
    renderRemember();
    renderMaterial();
    renderRequestNote();
    paintTeam();
    paintAi();
    paintLearn();
    paintReview();
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
  // WEEKLY-주요일정칸: 줄마다 '원래:' 줄 아래 [날짜][시간][제목][장소][참석][빼기]. 칸의 바탕은 기억(제목·장소) 아니면 달력, 참석은 내 이름.
  function titleRow(item, n) {
    const li = el('li', 'journal-hwpx-title'); li.dataset.hwpxTitle = item.key;
    const o = state.titles.get(item.key), id = `journalHwpxTitle-${n}`, out = isDropped(item, state.drops);
    const f = eventFields(item, o, state.me);
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
    const label = `${item.label} ${item.time}`;
    const input = (cls, data, value, aria, type = 'text') => { const x = el('input', cls); x.type = type; x.value = value ?? ''; x.dataset[data] = ''; x.setAttribute('aria-label', `${label} ${aria}`); x.disabled = out; return x; };
    const days = getWeek().model?.calendar?.days ?? [];
    const day = input('journal-hwpx-day-input', 'hwpxDayInput', f.day, '날짜', 'date');
    if (days.length) { day.min = days[0]; day.max = days.at(-1); }
    const time = input('journal-hwpx-time-input', 'hwpxTimeInput', f.time, `시간(예: 10:30, ${ALL_DAY})`); time.placeholder = `10:30·${ALL_DAY}`; time.maxLength = 5; time.autocomplete = 'off';
    const title = input('journal-hwpx-title-input', 'hwpxTitleInput', f.title, '일정 제목'); title.id = id;
    const place = input('journal-hwpx-place-input', 'hwpxPlaceInput', f.place, `일정 장소(비우면 ${NO_PLACE})`); place.placeholder = NO_PLACE;
    const who = input('journal-hwpx-who-input', 'hwpxWhoInput', f.who, '참석(쉼표로 여럿)'); who.placeholder = '참석';
    const save = () => setFields(item, {day:day.value, time:time.value, title:title.value, place:place.value, who:who.value}, li);
    for (const x of [time, title, place, who]) x.addEventListener('input', save);
    day.addEventListener('change', save);
    // 시간은 칸을 떠날 때 모양을 맞춘다(0930 → 09:30). 읽을 수 없으면 표시만(값은 바탕 시간 그대로).
    time.addEventListener('change', () => { const t = cleanTime(time.value); if (t === null) time.setAttribute('aria-invalid', 'true'); else { time.removeAttribute('aria-invalid'); if (t) time.value = t; } save(); });
    const fields = el('div', 'journal-hwpx-title-fields'); fields.append(day, time, title, place, who, drop);
    li.append(head, fields);
    li.dataset.changed = o ? 'true' : 'false';
    if (out) li.dataset.dropped = 'true';
    return li;
  }
  function setFields(item, next, li) {
    const edit = editFrom(item, next, state.me);
    if (edit) state.titles.set(item.key, edit); else state.titles.delete(item.key);
    if (li) li.dataset.changed = state.titles.has(item.key) ? 'true' : 'false';
    state.built = null;
    renderMismatches();
    paintHqNote();
    typed(`title:${item.key}`);
  }
  // ---- 1. 2) 주요 일정 줄(draft.hq — [주간 정리] 수기 표가 쓴다, 이 상자는 읽은 그대로 다시 실어 보냄) ----
  const hqContext = () => ({events:new Map(scheduleItems(fullCalendar()).map(i => [i.key, i])), titles:state?.titles ?? new Map()});
  const hqFileLines = () => (state ? hqLines(state.hq ?? [], hqContext()) : []);
  function paintHqNote() {
    const p = body.querySelector('[data-hwpx-hq]');
    if (!p || !state) return;
    const n = hqFileLines().length;
    p.textContent = `1. 2) 주요 일정: ${n ? `[주간 정리] 2) 주요 일정 표 ${n}줄을 넣어요.` : '[주간 정리] 2) 주요 일정 표가 비어 있어 비워요.'} 세부 내용·집회 표는 비워요. 바탕과 다른 줄은 파란 글씨가 돼요.`;
  }
  // ---- 3. 2) 투쟁 사업장 현황 구성 ----
  const siteRows = s => s.sites.map(r => ({index:r.index, org:r.org}));
  function sitesPart(s) {
    const sites = el('section', 'journal-hwpx-part'); sites.dataset.hwpxPart = 'sites';
    sites.append(el('h5', 'journal-weekly-sub', '3. 2) 투쟁 사업장 현황 — 내 담당 조직'));
    const {shown} = arrangeSites(siteRows(s), s.layout);
    const list = el('div', 'journal-hwpx-sites'); list.dataset.reorderList = 'sites'; list.dataset.hwpxSites = '';
    for (const r of shown) {
      const row = s.sites.find(x => x.index === r.index), box = lineBox('sites', row, row.org);
      box.dataset.reorderId = String(row.index); box.dataset.hwpxSite = row.org;
      const tools = el('div', 'journal-hwpx-site-tools');
      const grip = el('button', 'mini journal-hwpx-grip', '⠿'); grip.type = 'button'; grip.dataset.reorderHandle = ''; grip.setAttribute('aria-label', `${row.org} 순서 옮기기(위·아래 화살표)`);
      const more = el('details', 'journal-kind-more'); more.dataset.hwpxSiteMore = row.org;
      const sum = el('summary'); const dots = el('span', 'more-dots', '⋯'); dots.setAttribute('aria-hidden', 'true'); sum.append(dots); sum.setAttribute('aria-label', `${row.org} 사업장 칸 메뉴`);
      const hide = button('이번 주 보고에서 빼기', 'hwpxSiteHide'); hide.dataset.hwpxSiteName = row.org;
      more.append(sum, hide); tools.append(grip, more);
      box.prepend(tools);
      list.append(box);
    }
    sites.append(list);
    if (!shown.length) sites.append(emptyEl('넣은 사업장이 없어요'));
    // [+ 사업장 추가]: 내 담당 조직 가운데 지금 칸에 없는 것(뺀 사업장 포함 — 넣으면 적어 둔 글이 돌아옴).
    const shownKeys = new Set(shown.map(r => siteKey(r.org)));
    const options = s.context.organizations.map(o => o.name).filter(n => n && !shownKeys.has(siteKey(n)));
    const bar = el('div', 'journal-hwpx-site-add');
    const add = button('+ 사업장 추가', 'hwpxSiteAdd'); add.disabled = !options.length; add.setAttribute('aria-expanded', 'false');
    const pick = el('select', 'journal-hwpx-target'); pick.dataset.hwpxSitePick = ''; pick.hidden = true; pick.setAttribute('aria-label', '넣을 사업장(내 담당 조직)');
    const none = el('option', '', '사업장 고르기'); none.value = ''; pick.append(none);
    for (const n of options) { const o = el('option', '', n); o.value = n; pick.append(o); }
    pick.addEventListener('change', () => { if (pick.value) setSite('show', pick.value); });
    bar.append(add, pick);
    sites.append(bar);
    return sites;
  }
  function mountSiteDrag() {
    siteDrag?.destroy(); siteDrag = null;
    const part = body.querySelector('[data-hwpx-part="sites"]');
    if (!part) return;
    const nameOf = id => state?.sites.find(r => String(r.index) === String(id))?.org;
    siteDrag = mountReorder(part, {onDrop:({id, index}) => { const n = nameOf(id); if (n) setSite('move', n, index); },
      onStep:(id, dir) => { const n = nameOf(id), shown = arrangeSites(siteRows(state), state.layout).shown, at = shown.findIndex(r => String(r.index) === String(id)); if (n && at >= 0) setSite('move', n, Math.max(0, at + dir), true); }});
  }
  // how: 'hide' | 'show' | 'move'. 구성이 바뀌면 이 주 구성(layoutOwn)으로 임시저장한다. 바탕에 없는 사업장을 넣으면 바탕을 다시 만들고 고친 칸은 이름으로 다시 넣는다.
  function setSite(how, name, index = Infinity, keyboard = false) {
    const s = state;
    if (!s) return;
    const rows = siteRows(s), at = new Date().toISOString();
    const before = arrangeSites(rows, s.layout).shown.findIndex(r => siteKey(r.org) === siteKey(name));
    s.layout = how === 'hide' ? siteHidden(rows, s.layout, name, at) : how === 'show' ? siteShown(rows, s.layout, name, at, index) : siteMoved(rows, s.layout, name, index, at);
    s.layoutOwn = true; s.built = null;
    if (missingSites(rows, s.layout, s.context.organizations.map(o => o.name)).length) { const kept = currentDraft(s); rebase(); placeCells(s, kept); }
    renderEdit();
    if (how === 'hide') {
      undoLine.replaceChildren(doc.createTextNode(`${name}${particle(name)} 뺐어요 `));
      const back = button('되돌리기', 'hwpxSiteUndo'); back.dataset.hwpxSiteName = name; back.dataset.hwpxSiteIndex = String(Math.max(0, before)); undoLine.append(back); undoLine.hidden = false;
    } else undoLine.hidden = true;
    if (how === 'show') say(`${name}${particle(name)} 넣었어요.`);
    if (keyboard) [...body.querySelectorAll('[data-hwpx-site]')].find(n => n.dataset.hwpxSite === name)?.querySelector('[data-reorder-handle]')?.focus();
    typed('sites_layout');
  }
  const particle = name => { const code = String(name).charCodeAt(String(name).length - 1); return code >= 0xAC00 && code <= 0xD7A3 ? ((code - 0xAC00) % 28 ? '을' : '를') : '을(를)'; };
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
      ...arrangeSites(siteRows(state), state.layout).shown.map(r => ({where:r.org, lines:state.edits.sites.get(r.index) ?? []})),
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
    const data = draft.assembleDraft({...state.base, date:state.date, requests:formRequests(requestRows().items), schedule:hqFileLines(), ...scheduleForm(shownCalendar(), state.me, state.titles)}, state.edits);
    // 3. 2) 투쟁 사업장 현황: 들어간 사업장만, 구성 순서로(뺀 사업장의 글은 칸에 남아 있고 파일에만 없다).
    data.sites = layoutSiteData(data.sites ?? [], siteRows(state), state.layout);
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
      const result = await drive.saveWeeklyReport(b.bytes, {fileName:b.name, title:fileNameTitle(b.name), documentDate:reportDay(state.start)}, {rt});
      if (mine !== run) return;
      state.saved = result;
      say(result.message, result.kind === 'created' ? 'ok' : 'error');
      if (result.kind === 'created' && state.store) { state.store.confirmed = {document_id:String(result.document?.id ?? ''), at:new Date().toISOString()}; state.store.dirty = true; await recordIssued(state, b.bytes, false); recordFeedback(state); void saveDraft(state).then(() => askReview(state)); }
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

  // ---- 환류학습 3: AI 초안(ai-assist weekly_draft) ----
  // 칸마다 바탕 줄(처음 바탕 initial — 고친 칸 글이 아님)과 그 칸 옆 이번 주 기록 줄을 보낸다. 서버는 그 주 '앞' 주들의 고침 기록·규칙만 읽는다.
  const sendLine = (v, max) => [...String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]+/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
  function aiRequest(s, mode) {
    const m = s.draft.weekMaterial(getWeek().model, s.rows, s.orgs, {aliases:s.aliases});
    const refs = new Map(), cells = [];
    for (const [id, at] of s.cellAt) {
      if (cells.length >= 80) break;
      const ref = `c${cells.length + 1}`; refs.set(ref, id);
      const material = at.section === 'summary' ? m.byRow.get(at.index) : at.section === 'orgs' ? m.byOrg.get(at.index) : [];
      cells.push({ref, where:sendLine(whereOf(id), 120) || '칸', lines:(s.initial.get(id) ?? []).map(l => sendLine(l, 300)).filter(Boolean).slice(0, 20),
        material:(material ?? []).map(x => sendLine(`${x.day ? `${shortDay(x.day)} ` : ''}${x.text}`, 400)).filter(Boolean).slice(0, 20)});
    }
    const unmatched = [...(m.unmatched ?? []), ...(m.orgUnmatched ?? [])].map(x => sendLine(`${x.from ? `${x.from}: ` : ''}${x.text}`, 400)).filter(Boolean).slice(0, 40);
    const request = {kind:'weekly_draft', week_start:s.start, mode, cells, unmatched};
    // 몸통이 크면 기록 줄을 뒤에서부터 덜어 낸다(칸 글은 그대로).
    const size = () => new TextEncoder().encode(JSON.stringify(request)).length;
    while (size() > LEARN_BODY_BYTES && request.unmatched.length) request.unmatched.pop();
    for (let k = cells.length - 1; size() > LEARN_BODY_BYTES && k >= 0; k--) while (size() > LEARN_BODY_BYTES && cells[k].material.length) cells[k].material.pop();
    return {request, refs, cells:cells.length};
  }
  async function callLearn(s, mode) {
    const {request, refs, cells} = aiRequest(s, mode);
    if (!cells) return {ok:false, code:'empty'};
    const r = await callAiAssist(request, {rt}, LEARN_TEXT);
    if (!r.ok) return r;
    if (r.data.week_start !== s.start || !Array.isArray(r.data.cells)) return {ok:false, code:'ai_invalid_response'};
    const out = new Map();
    for (const c of r.data.cells) { const id = refs.get(c?.ref); if (id && Array.isArray(c.lines)) out.set(id, c.lines.map(l => String(l ?? '')).filter(l => l.trim())); }
    return {ok:true, cells:out, learned:r.data.learned ?? {weeks:0, rules:0}};
  }
  // again=true: [AI 초안 다시 쓰기]. 사람이 손대지 않은 칸(지금 글 = 바탕)만 바꾼다. 처음 초안은 AI 칸으로 다시 정한다.
  async function aiDraft(s, again) {
    if (!s?.ai || s.ai.status === 'running') return;
    s.ai.status = 'running'; s.ai.note = 'AI가 지난 고침 기록과 규칙을 보고 이번 주 초안을 쓰는 중…'; paintAi();
    const r = await callLearn(s, 'draft');
    if (state !== s) return;
    const st = s.store;
    if (!r.ok) {
      s.ai.status = 'base'; s.ai.note = r.code === 'empty' ? '' : (LEARN_TEXT[r.code] || LEARN_TEXT.internal_error);
      if (st?.extras && !st.extras.proposed) st.extras.proposed = proposedNow(s);
      paintAi(); return;
    }
    let changed = 0;
    const proposed = cellsNow(s, 'initial');
    for (const [id, lines] of r.cells) {
      proposed.set(id, lines);
      const at = s.cellAt.get(id); if (!at) continue;
      const now = s.edits[at.section].get(at.index) ?? [];
      const same = (a, b) => JSON.stringify(a.filter(x => x.trim())) === JSON.stringify(b.filter(x => x.trim()));
      if (!same(now, s.initial.get(id) ?? []) || same(lines, now)) continue;
      s.edits[at.section].set(at.index, [...lines]); changed++;
      const area = areas[`${at.section}:${at.index}`];
      if (area) { area.value = lines.join('\n'); area.rows = Math.min(12, Math.max(3, lines.length + 1)); }
    }
    if (st?.extras) st.extras.proposed = {...proposedNow(s), ai:true, cells:cellList(proposed)};
    s.built = null;
    s.ai.status = 'done';
    s.ai.note = `AI 초안: 지난 ${r.learned.weeks}주 고침 기록·규칙 ${r.learned.rules}줄을 보고 ${changed}칸을 고쳐 썼어요(바탕과 다른 줄은 파란 글씨). 칸에서 고쳐 주세요.`;
    if (changed || again) touchDraft(); else if (st) st.dirty = true; // 처음 초안도 다음 저장에 실리게
    paintAi(); renderMismatches();
  }
  function paintAi() {
    const p = body.querySelector('[data-hwpx-ai-draft]'), a = state?.ai;
    if (!p) return;
    p.hidden = !a?.note && a?.status !== 'done';
    p.replaceChildren(a?.note ?? '');
    if (a && a.status !== 'running' && a.status !== 'wait') { const again = button('AI 초안 다시 쓰기', 'hwpxAiAgain'); again.setAttribute('aria-label', 'AI 초안 다시 쓰기(손대지 않은 칸만)'); p.append(' ', again); p.hidden = false; }
  }

  // ---- 환류학습 6: [학습 시험] — 저장하지 않고 이번 주 개인본과 나란히 ----
  // 이번 주(보고일이 같은) 개인본을 찾아 연다. 재료는 지금 바탕(이번 주 개인본을 뺀 것)과 이번 주 기록, 서버가 읽는 앞 주들 기록뿐이다.
  async function thisWeekPersonal(s) {
    const workspace = rt.context.read()?.workspace?.id, day = reportDay(s.start);
    const rows = await rt.api(`/rest/v1/app_documents?workspace_id=eq.${encode(workspace)}&category=eq.${encode(PERSONAL_CATEGORY)}&document_date=eq.${day}&select=id,title,file_name,document_date,created_at&order=created_at.desc,id.desc&limit=1`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  async function learnTest(s, trigger) {
    const t = s.learn = {status:'running', note:'이번 주 개인본과 견줄 준비를 해요.'}; paintLearn();
    trigger.disabled = true;
    try {
      const doc_ = await thisWeekPersonal(s).catch(() => undefined);
      if (state !== s || s.learn !== t) return;
      if (doc_ === undefined) { t.status = 'failed'; t.note = '자료실을 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.'; return; }
      if (!doc_) { t.status = 'failed'; t.note = `이번 주 "${PERSONAL_CATEGORY}"가 자료실에 없어요. 개인본을 올린 뒤 눌러 주세요.`; return; }
      t.note = 'AI가 이번 주 재료로 초안을 새로 쓰는 중…(이번 주 개인본은 보지 않아요)'; paintLearn();
      const [ai, mine] = await Promise.all([callLearn(s, 'test'), (async () => {
        const {drive} = await lazy();
        const {bytes} = await drive.openHwpFromDrive({kind:'library', document:{id:doc_.id}}, {rt});
        const {team} = s.draft.prepareConfirmed(await s.draft.openConfirmed(await hwpxBytes(bytes, doc_.file_name)));
        return rawCells(s, team);
      })().catch(() => null)]);
      if (state !== s || s.learn !== t) return;
      if (!ai.ok) { t.status = 'failed'; t.note = ai.code === 'empty' ? '시험할 칸이 없어요.' : (LEARN_TEXT[ai.code] || LEARN_TEXT.internal_error); return; }
      if (!mine) { t.status = 'failed'; t.note = '이번 주 개인본을 열지 못했어요.'; return; }
      const aiCells = cellsNow(s, 'initial');
      for (const [id, lines] of ai.cells) aiCells.set(id, lines);
      t.status = 'done'; t.result = compareTest(aiCells, mine); t.learned = ai.learned; t.title = String(doc_.title || doc_.file_name || ''); t.note = '';
    } finally { if (trigger.isConnected) trigger.disabled = false; paintLearn(); }
  }
  function paintLearn() {
    const box = body.querySelector('[data-hwpx-learn]'), t = state?.learn;
    if (!box) return;
    box.hidden = !t;
    if (!t) { box.replaceChildren(); return; }
    if (t.status !== 'done') {
      const p = el('p', t.status === 'failed' ? 'journal-muted journal-failed' : 'journal-muted'); p.dataset.hwpxLearnNote = t.status;
      if (t.status === 'running') p.innerHTML = waitInlineHtml(); // UI-기다림표시통일: 회색 칸 + 한 줄
      p.append(doc.createTextNode(` ${t.note}`)); box.replaceChildren(p); return;
    }
    const r = t.result, counts = Object.fromEntries(Object.keys(TEST_STATUS).map(k => [k, r.rows.filter(x => x.status === k).length]));
    const fold = el('details', 'journal-hwpx-plans'); fold.open = true; fold.dataset.hwpxLearnResult = '';
    const head = el('summary', '', `학습 시험 — 그대로 쓸 수 있는 줄 ${r.usable}/${r.total}(${r.pct}%)`); head.dataset.hwpxLearnScore = ''; fold.append(head);
    if ((t.learned?.weeks ?? 0) < 3) { const few = el('p', 'journal-muted', `학습 기록이 아직 ${t.learned?.weeks ?? 0}주뿐이에요(지난 개인본·규칙 ${t.learned?.rules ?? 0}줄로만 만들었어요).`); few.dataset.hwpxLearnFew = ''; fold.append(few); }
    const sum = el('p', 'journal-muted', `${Object.entries(TEST_STATUS).map(([k, label]) => `${label} ${counts[k]}`).join(' · ')} · 비교: 이번 주 개인본 "${t.title}" (저장하지 않음)`); sum.dataset.hwpxLearnCounts = ''; fold.append(sum);
    const ul = el('ul', 'journal-hwpx-material'); let where = '';
    for (const row of r.rows) {
      if (row.where !== where) { where = row.where; const h = el('li', 'journal-weekly-label', where); h.dataset.hwpxLearnWhere = ''; ul.append(h); }
      const li = el('li'); li.dataset.hwpxLearnRow = row.status;
      const tag = el('span', 'journal-weekly-day', TEST_STATUS[row.status]);
      const text = row.status === 'same' ? row.mine : row.status === 'missing' ? `내 개인본: ${row.mine}` : row.status === 'ai_only' ? `AI: ${row.ai}` : `AI: ${row.ai}  /  내 개인본: ${row.mine}`;
      li.append(tag, ' ', doc.createTextNode(text)); ul.append(li);
    }
    fold.append(ul);
    box.replaceChildren(fold);
  }

  // ---- 환류학습 4: [확정] 뒤 이번 주 환류 보고(ai-assist weekly_review) ----
  // 고침 기록이 서버에 저장된 뒤 한 번 부른다. 서버가 같은 행에 규칙·보고를 쓰면 이 상자는 다시 읽어 합친다(syncDraft).
  async function askReview(s) {
    // 고침 기록이 서버에 실린 뒤에만(다른 저장이 돌고 있었으면 끝나기를 기다려 한 번 더).
    for (let i = 0; i < 3 && state === s && s.store && (s.store.flight || s.store.dirty); i++) await (s.store.flight ?? saveDraft(s));
    if (state !== s || s.store?.status !== 'saved' || !s.store.extras?.feedback) return;
    s.review = {status:'running', feedback:s.store.extras.feedback, previous:[]}; paintReview();
    const [r, rows] = await Promise.all([callAiAssist({kind:'weekly_review', week_start:s.start}, {rt}, LEARN_TEXT), readLearnRows(s.start, rt).catch(() => null)]);
    if (state !== s) return;
    s.review.previous = (rows ?? []).filter(x => x.week_start < s.start).map(x => x.feedback).filter(Boolean);
    if (r.ok && r.data.week_start === s.start) {
      s.review.feedback = readFeedback({...s.review.feedback, review:r.data.review}) ?? s.review.feedback;
      s.review.status = 'done';
      if (r.data.saved) { void syncDraft(s); try { window.dispatchEvent(new CustomEvent('kptu:weekly-learn-changed', {detail:{start:s.start}})); } catch { /* 다시 그리기만 못 함 */ } }
    } else { s.review.status = 'failed'; s.review.note = r.ok ? LEARN_TEXT.ai_invalid_response : (LEARN_TEXT[r.code] || LEARN_TEXT.internal_error); }
    paintReview();
  }
  function paintReview() {
    const box = body.querySelector('[data-hwpx-review]'), v = state?.review;
    if (!box) return;
    box.hidden = !v;
    if (!v) { box.replaceChildren(); return; }
    const card = reviewCard(doc, v.feedback, v.previous, {answerable:v.status === 'done', busy:!!v.busy});
    const parts = card ? [card] : [];
    if (v.status === 'running') { const p = el('p', 'journal-muted', '규칙 후보·개선 제안을 정리하는 중…'); p.dataset.hwpxReviewNote = 'running'; parts.push(p); }
    if (v.status === 'failed') { const p = el('p', 'journal-muted', `규칙 후보·개선 제안은 만들지 못했어요(${v.note}). 고침 기록은 저장했어요.`); p.dataset.hwpxReviewNote = 'failed'; parts.push(p); }
    if (v.msg) { const p = el('p', 'journal-line-status', v.msg); p.setAttribute('role', 'status'); parts.push(p); }
    box.replaceChildren(...parts);
    if (card) card.querySelector('[data-learn-review-pending]')?.remove();
  }
  async function answerReview(s, b) {
    const [week, id, answer] = b.dataset.learnAnswer.split(':');
    if (!s.review || week !== s.start) return;
    s.review.busy = true; s.review.msg = '저장하는 중…'; paintReview();
    try {
      const r = await answerSuggestion(week, id, answer, rt);
      if (r.missing) throw new Error('missing');
      s.review.feedback = readFeedback(r.row?.draft?.feedback) ?? s.review.feedback;
      s.review.msg = answer === 'yes' ? '승인했어요. 다음 개발 후보로 올라가요.' : '아니로 답했어요.';
      void syncDraft(s);
      try { window.dispatchEvent(new CustomEvent('kptu:weekly-learn-changed', {detail:{start:week}})); } catch { /* 다시 그리기만 못 함 */ }
    } catch { s.review.msg = '답을 저장하지 못했어요. 다시 눌러 주세요.'; }
    finally { s.review.busy = false; paintReview(); }
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
      keep:s.store?.keep ?? [], titles:s.titles, drops:s.drops, docs:s.docs ?? [], areas:s.areas ?? null, confirmed:s.store?.confirmed ?? null, issued:s.store?.issued ?? null, extras:s.store?.extras ?? null,
      hq:s.hq ?? [], siteLayout:s.layoutOwn ? s.layout : null});
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
    // 투쟁 사업장 구성·2) 주요 일정 줄: 합친 판(다른 기기·[주간 정리]가 쓴 것 포함). 구성에 바탕에 없는 사업장이 생기면 바탕을 다시 만든다.
    s.hq = draftHq(d);
    const own = draftSiteLayout(d);
    if (own) { s.layout = own; s.layoutOwn = true; }
    const needSites = missingSites(s.sites ?? [], s.layout, s.context.organizations.map(o => o.name)).length > 0;
    if (me !== s.me || needSites) { s.me = me; rebase(); }
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
        if (r.ok) { st.known = r.row; st.last = mine; st.savedAt = r.row.saved_at; st.status = 'saved'; if (weekDraft?.start === s.start) weekDraft = null; try { onDraft?.(s.start, r.row); } catch { /* 화면 다시 그리기만 못 함 */ } return; }
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
    if (!st) { draftLine.replaceChildren(); draftLine.removeAttribute('title'); return; }
    draftLine.dataset.kind = st.status === 'failed' ? 'error' : '';
    // 글은 말줄임 칸 하나에 넣고(제목 줄이 좁으면 잘림), 전체 글은 title로 둔다.
    const text = value => { const t = el('span', 'journal-hwpx-draft-text', value); draftLine.title = value; return t; };
    if (st.status === 'missing') draftLine.replaceChildren(text(DRAFT_TEXT.missing));
    else if (st.status === 'saving') draftLine.replaceChildren(text(DRAFT_TEXT.saving));
    else if (st.status === 'failed') { const again = button('다시', 'hwpxDraftRetry'); again.setAttribute('aria-label', '임시저장 다시'); draftLine.replaceChildren(text(DRAFT_TEXT.failed), again); }
    else if (st.status === 'readFailed') draftLine.replaceChildren(text(DRAFT_TEXT.readFailed));
    else if (st.savedAt && st.status === 'saved') draftLine.replaceChildren(text(`임시저장 ${hm(st.savedAt)}`));
    else draftLine.replaceChildren(text('고치면 서버에 임시저장해요.'));
  }
  const cellLabel = cell => {
    if (cell === 'me') return '담당 팀원 칸의 내 이름';
    if (cell === 'date') return '■ 일시';
    if (cell.startsWith('area:')) return '사업요약표 사업영역 한 줄';
    if (cell === 'hq') return '1. 2) 주요 일정 줄';
    if (cell === 'sites_layout') return '3. 2) 투쟁 사업장 넣고 뺀 구성';
    if (cell.startsWith('title:') || cell.startsWith('drop:')) { const key = cell.slice(cell.indexOf(':') + 1), item = scheduleItems(fullCalendar()).find(i => i.key === key); return `5. 주요 일정 ${item ? `${item.label} ${item.time} ${item.title}` : ''}${cell.startsWith('drop:') ? ' 빼기' : ''}`.trim(); }
    const {section, key, n} = parseCellId(cell.slice(4));
    return `${SECTION_NAME[section] ?? section} · ${key.replace('›', ' › ')}${n ? ` (${n + 1}번째)` : ''}`;
  };
  const cellText = value => (value === 'drop' ? '뺌' : value === 'keep' ? '넣음' : value == null ? '(바탕 그대로)'
    : Array.isArray(value) ? value.map(l => (typeof l === 'string' ? l : [l?.day, l?.time, l?.title].filter(Boolean).join(' '))).filter(l => l.trim()).join(' / ') || '(빈 칸)'
    : typeof value === 'object' && Array.isArray(value.order) ? `넣음 ${value.order.join(', ') || '없음'}${value.hidden?.length ? ` · 뺌 ${value.hidden.join(', ')}` : ''}`
    : typeof value === 'object' ? [value.day, value.time, value.title, value.place, value.who].filter(Boolean).join(' / ') : String(value));
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
      else if (c.cell.startsWith('title:')) { const key = c.cell.slice(6); if (v) s.titles.set(key, {...v}); else s.titles.delete(key); s.titleKeys = ''; }
      else if (c.cell === 'hq') s.hq = v ?? [];
      else if (c.cell === 'sites_layout') { s.layout = v ? readSiteLayout({...v, at:new Date().toISOString()}) : s.carriedLayout; s.layoutOwn = !!v; const kept = currentDraft(s); rebase(); placeCells(s, kept); }
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
    else if (b.matches('[data-hwpx-ai-again]') && state) void aiDraft(state, true);
    else if (b.matches('[data-hwpx-learn-test]') && state) void learnTest(state, b);
    else if (b.matches('[data-learn-answer]') && state) void answerReview(state, b);
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
    else if (b.matches('[data-hwpx-site-hide]')) setSite('hide', b.dataset.hwpxSiteName);
    else if (b.matches('[data-hwpx-site-undo]')) setSite('show', b.dataset.hwpxSiteName, Number(b.dataset.hwpxSiteIndex));
    else if (b.matches('[data-hwpx-site-add]')) { const pick = body.querySelector('[data-hwpx-site-pick]'); if (pick) { pick.hidden = !pick.hidden; b.setAttribute('aria-expanded', String(!pick.hidden)); if (!pick.hidden) pick.focus(); } }
    else if (b.matches('[data-hwpx-remember-go]') && state?.remember) void writeMemory(state, state.remember.candidates.filter(c => c.checked));
  });

  return {
    // The shown week or the owner changed: a draft belongs to one week, so it closes.
    setWeek(week) { if (state && week !== state.start) close('주가 바뀌어 한글 파일 초안을 닫았어요.'); },
    // The week's reads landed: refresh only the candidates beside the rows (what was typed stays).
    refresh() { if (state) state.built = null; renderMaterial(); renderRequestNote(); paintHqNote(); },
    // [주간 정리]가 그 주 임시저장(2) 주요 일정 줄·일정 칸별 고침)을 썼다: 열린 상자는 서버 판과 맞춘다(3자 비교, 고치던 칸은 그대로).
    sync(start) { if (state?.store && state.start === start) { if (state.store.flight) state.store.again = true; else void syncDraft(state); } },
    close,
  };
}
