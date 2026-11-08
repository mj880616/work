// ORG/BIZ-기록하나로 O-4 ②·B-3 ②(설계 docs/design/record-one.md 4·4-1절, 시안 docs/design/mockups/journal-week-tables.html, JOURNAL-이번주보고표):
// 업무일지 [하루]의 '이번 주 보고' — 표 두 개를 붙이기만 한다(새 저장 없음). 왼쪽 = 4. 조직보고(조직보고 창 record-window-view.js),
// 오른쪽 = 2. 사업요약(사업요약 창 weekly-summary-table.js createBizSummaryBox, app_business_now 이어 쓰기). PC·폴드 펼침은 좌우, 폰은 위아래(journal.css).
// - 두 표 모두 담당조직 [전체 표]·사업 보고 '이번 주 주간보고'·홈 [주간 정리]와 같은 부품·같은 자료라 어디서 고쳐도 같은 글이 보인다.
// - 이 상자는 journal.js renderDay()가 주간보고 재료 자리에 붙인다. 상자 마디는 하나라 다시 그려도 쓰던 칸·초점이 그대로다.
// - 기기에 아무것도 저장하지 않는다. 글은 로그에 쓰지 않는다.
import {createRecordWindow, windowTableHtml} from './record-window-view.js';
import {createBizSummaryBox} from './weekly-summary-table.js';
import {fitAll} from './auto-grow.js';
import {readWeekDraft} from './weekly-draft-store.js';
import {reportOrgNames, orderForReport} from './weekly-org-order-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const md = day => { const [, m, d] = String(day).split('-'); return `${Number(m)}.${Number(d)}.`; };
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const NONE = Object.freeze([]);

// rt = 앱 실행기, openOrg({org, record}, trigger) = [기록 열기](업무일지의 원본 열기 길).
export function createWeekReport({rt, openOrg = null} = {}) {
  const el = document.createElement('section');
  el.className = 'journal-week-report'; el.dataset.journalWeekReport = '';
  el.setAttribute('aria-labelledby', 'journalWeekReportTitle');
  el.innerHTML = '<div class="journal-week-report-head"><h4 class="journal-heading journal-report-title" id="journalWeekReportTitle">이번 주 보고</h4><small class="journal-week-report-range" data-jwr-range></small></div>'
    + '<div class="journal-week-report-cols"><section class="journal-week-report-col" data-jwr-org aria-label="4. 조직보고"><h5 class="journal-heading">4. 조직보고</h5><div class="wd-st" data-jwr-org-table></div></section>'
    + '<section class="journal-week-report-col" data-jwr-biz aria-label="2. 사업요약"><h5 class="journal-heading">2. 사업요약</h5></section></div>';
  const orgHost = el.querySelector('[data-jwr-org-table]');
  let ctl = null, orgs = [], msg = {text: '', error: false}, painted = '', names = [], nameWeek = '';
  // 조직 순서 = 주간보고(개인본) 순서(담당조직 [전체 표]와 같은 한 곳 weekly-org-order-model.mjs). 그 주 임시저장을 못 읽으면 앱 조직 순서.
  const ordered = () => orderForReport(orgs, names);
  function loadNames(week) {
    if (nameWeek === week) return;
    nameWeek = week;
    void readWeekDraft(week, rt).then(r => { if (nameWeek === week) { names = r.missing ? [] : reportOrgNames(r.row?.draft); paint(); } }, () => { if (nameWeek === week) { names = []; paint(); } });
  }
  const biz = createBizSummaryBox();
  el.querySelector('[data-jwr-biz]').append(biz.el);

  const say = (text, error = false) => { msg = {text, error}; const s = orgHost.querySelector('[data-wl-status]'); if (s) { s.textContent = text; s.classList.toggle('is-error', error); } };
  // 그리는 곳은 이 함수 하나. 같은 결과면 마디를 갈지 않는다(누르려던 단추·입력 칸이 그대로).
  function paint() {
    if (!ctl) return;
    const html = windowTableHtml(ctl, ordered(), {msg: msg.text, error: msg.error, tableClass: 'oa-table jwr-org-table', headRows: '조직현황'});
    if (html !== painted || !orgHost.childElementCount) {
      painted = html;
      const f = document.activeElement, field = f?.matches?.('[data-rw-field]') && orgHost.contains(f) ? f.dataset.rwField : '';
      const caret = field && typeof f.selectionStart === 'number' ? [f.selectionStart, f.selectionEnd] : null;
      orgHost.innerHTML = html;
      if (field) { const back = orgHost.querySelector(`[data-rw-field="${field}"]`); if (back) { back.focus({preventScroll: true}); if (caret) try { back.setSelectionRange(...caret); } catch { /* 날짜 칸 */ } } }
    }
    ctl.afterPaint();
    fitAll(orgHost);
  }
  // week = 보이는 날이 든 주(월요일), list = 내 담당조직 [{id, name}](보고 순서), meetings() = 업무일지가 이미 읽은 그 주 사업 보고.
  function show({week, orgs: list = [], meetings = () => NONE, tree = null} = {}) {
    if (!week) return;
    el.querySelector('[data-jwr-range]').textContent = `${md(week)} ~ ${md(addDays(week, 6))}`;
    const ws = rt?.context?.read?.()?.workspace?.id || '';
    if (!ctl || ctl.workspaceId !== ws) {
      ctl = createRecordWindow({rt, workspaceId: ws, week, repaint: paint, say, openSource: typeof openOrg === 'function' ? openOrg : null});
      ctl.bind(orgHost);
    }
    const same = list.length === orgs.length && list.every((o, i) => o.id === orgs[i]?.id && o.name === orgs[i]?.name);
    orgs = list;
    if (ctl.week !== week) { ctl.orgs = list; ctl.setWeek(week); }
    else if (!same || ctl.status === 'idle') void ctl.load(list, {quiet: ctl.status === 'ready'});
    else paint();
    loadNames(week);
    biz.update({meetings, week, tree: tree || (() => null)});
  }
  return {el, show, get window() { return ctl; }};
}
