// UI-기다림표시통일 2차: 찾는 동안의 상태 값(정리함 맨 위 줄이 글자 없는 회색 칸으로 그린다).
const RADAR_WAIT = '\u0000wait';
// JOURNAL-챙길것 1단계 + AI-서버연동 S5 → HOME-업무일지홈: '챙길 것'을 찾는 길(서버 ai-assist kind=todo_radar)과 정리함이 같이 쓰는 부품.
// - 찾기는 서버가 한다: 그날 이 탭에서 처음 홈을 열 때 한 번(autoFindToday, 서버도 그날 이미 찾았으면 건너뜀)과 정리함 [다시 찾기].
// - 후보 줄을 그리는 곳은 정리함 [챙길 것](inbox-todos.js) 하나다. 옛 홈·업무일지 상자(mountRadar)는 화면째 없앴다.
// - 브라우저 기기 저장 없음.
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import {findTodos, radarScope} from './todo-radar-data.js';
import {formatSeoulTime, seoulDateKey} from './meeting-time.js';
import {requestBasketNote, requestNoteDocOpen} from './basket-note-tasks.js';

const rt = window.KPTURuntime;
const clock = value => formatSeoulTime(value, {hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const CHANGED = 'kptu:todo-radar-changed';

// Shared by every host in this tab, for the signed-in owner only.
const shared = {scope:'', autoDay:'', fnMissing:false, finding:null, promises:[], status:'', checkedAt:null, partial:false};
function sameScope() {
  const scope = radarScope(rt);
  if (shared.scope !== scope) Object.assign(shared, {scope, autoDay:'', fnMissing:false, finding:null, promises:[], status:'', checkedAt:null, partial:false});
  return scope;
}
// reload:true when candidates changed (other hosts read again); false when only the shared status line changed.
const notify = (reload = true) => window.dispatchEvent(new CustomEvent(CHANGED, {detail:{reload}}));
const toast = message => { const box = document.querySelector('#toast'); if (!box) return; box.textContent = message; kptuHoldToast(box); };

async function find(mode) {
  const scope = sameScope();
  if (shared.finding) return shared.finding;
  shared.status = RADAR_WAIT; notify(false);
  shared.finding = findTodos(mode).then(result => {
    if (scope !== radarScope(rt)) return result;
    if (!result.ok && result.code === 'not_ready') shared.fnMissing = true;
    if (result.ok) { shared.checkedAt = result.checkedAt; shared.partial = result.partial; }
    if (result.ok && !result.skipped) shared.promises = result.promises;
    shared.status = result.ok ? (result.skipped ? '' : result.added ? `새로 ${result.added}개 찾았어요.` : '새로 찾은 것은 없어요.') : result.message;
    return result;
  }).then(result => { shared.finding = null; if (scope === radarScope(rt)) notify(result.ok && !result.skipped); return result; },
    error => { shared.finding = null; if (scope === radarScope(rt)) notify(false); throw error; });
  return shared.finding;
}

// 정리함 [챙길 것] shows the same promises (INBOX-상대약속): read-only view of what the last finding in this tab returned.
// Same scope guard as the radar itself; nothing is stored, so after a reload they are gone until the next finding.
export function radarPromises() { sameScope(); return shared.promises; }
// BASKET-정리함한화면: the 정리함 top line shows the same last-find time and has the same [다시 찾기] (one finder for every place).
export function radarFindState() { sameScope(); return {checkedAt: shared.checkedAt, finding: !!shared.finding, status: shared.status, missing: shared.fnMissing}; }
export const radarFindAgain = () => find('again');
export const radarClock = value => clock(value);

export function openSource(c) {
  const go = view => window.KPTURouter?.go?.(view, {source:'delegated'});
  if (c.source_kind === 'basket') { requestBasketNote(c.source_id, rt); go('basket'); return; }
  if (c.source_kind === 'note') { requestNoteDocOpen(c.source_id, rt); go('basket'); return; }
  if (c.source_kind === 'work') { go('home'); return; }
  const open = async () => {
    if (c.source_kind === 'meeting') {
      await window.KPTUViewLoader?.prepare?.('meetings'); await import('./meeting-round-detail.js');
      if (!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__)) throw new Error('meeting');
      await window.KPTUMeetingRoundDetail.open(c.source_id);
    } else if (c.source_kind === 'org_update' && c.organization_id) {
      await window.KPTUViewLoader.load('team'); await window.KPTUWorkplace.open(c.organization_id);
    } else if (c.source_kind === 'project_update' && c.project_id) {
      await window.KPTUAreaWindow.open({id: c.project_id}); // MTG-프로젝트합치기 ①: 사업영역 관리 창
    } else if (c.source_kind === 'telegram') {
      // FEAT-1029 ⑤: the telegram screen on that room·day with the news row open (the same opener the 조직 주요 인물 list uses).
      await window.KPTUViewLoader.load('telegram'); go('telegram');
      if (c.tg?.room_key) await window.KPTUTelegramFeed?.show?.(c.tg.room_key, c.source_day, c.source_id);
    }
  };
  open().catch(() => toast('출처를 열지 못했어요. 다시 시도해 주세요.'));
}

// HOME-업무일지홈: 홈·업무일지의 '챙길 것' 상자(mountRadar)는 화면째 없앴다(홈 요약 줄 '챙길 것 n'이 정리함으로 간다).
// D7: 그 상자가 하던 '이 탭에서 그날 처음 열 때 서버에 한 번 찾기'는 홈 요약 줄(home-summary.js)이 부른다. 서버도 그날 이미 찾았으면 건너뛴다.
export async function autoFindToday() {
  sameScope();
  const today = seoulDateKey();
  if (shared.fnMissing || shared.autoDay === today) return null;
  shared.autoDay = today;
  return find('auto').catch(() => null);
}
