// WEEKLY-한글초안 2단계: 업무일지 [주간 정리]의 [주간보고 한글 파일 만들기] (docs/design/weekly-hwpx-draft.md 8절 2단계).
// 지난주 팀 확정본(자료실 "주간보고 확정본" 최신 또는 기기 파일) → 내 칸 바탕 → 이번 주 기록을 줄 옆에 보여 주고 사람이 붙이기·고치기
// → .hwpx 내려받기 / [HWP로 받기] / [확정]하면 자료실(Drive)에 저장. AI 없음.
// - 파일은 이 기기 안에서만 다룬다. HWP 5 ↔ .hwpx 바꾸기는 HWP 편집기와 같은 칸막이 엔진(hwp-frame.js, sandbox iframe —
//   Web2 창·로그인 정보에 닿지 못함)이 하고, 표 읽기·빈 서식·보고서 만들기는 weekly-hwpx/*.mjs(외부 라이브러리 없음)가 한다.
//   서버로 가는 것은 자료실 확정본 열기(기존 document-actions hwp-open, owner 확인)와 [확정] 저장(기존 library-files)뿐이다.
// - 내 담당 조직은 my-organizations.js(내 프로필 → 담당 사업장)에서 받는다. 담당 팀원 칸의 내 이름은 프로필 이름(화면에서 고침).
// - 5. 주요 일정 표는 [주간 정리]의 5번 묶음(다음 주 월요일부터 2주, 달력 일정)으로 14일을 한 줄씩 채우고 참석자 칸에 내 이름,
//   휴가는 표 아래 "※ 날짜 이름 연차" 줄로 쓴다(WEEKLY-주요일정, 2026-10-21 사용자 결정 — 금요일 작성·월요일 보고라 "보고 주 + 그다음 주").
//   1. 2) 주요 일정(본부 주요 일정)은 기준이 정해지지 않아 비운다.
// - ■ 일시·파일 이름·자료 날짜는 상집 보고일(보고 있는 주의 다음 월요일, journal-data.js reportDay)로 한다(2026-10-21 사용자 결정).
// - 이 상자 하나만 이 모듈이 그린다(journal.js는 자리만 주고 주·자료가 바뀌면 알려 줌). 브라우저 저장소에 아무것도 두지 않는다.
import {selectMyOrganizations} from './my-organizations.js';
import {shortDay, reportDay} from './journal-data.js';
import {scheduleForm} from './journal-weekly.js';

const CONFIRMED_CATEGORY = '주간보고 확정본';
const encode = encodeURIComponent;
const TEXT = Object.freeze({
  intro: '지난주 팀 확정본을 바탕으로 내 칸만 채운 한글 파일을 만들어요. 파일은 이 기기 안에서만 만들고, [확정]을 누를 때만 자료실(Drive)에 저장해요.',
  noBrowser: '이 브라우저는 한글 파일 만들기(압축)를 지원하지 않아요. 최신 크롬·사파리·엣지에서 열어 주세요.',
  noConfirmed: `자료실에 "${CONFIRMED_CATEGORY}" 분류 자료가 없어요. 팀 확정본을 그 분류로 올리거나 [기기에서 파일 고르기]를 써 주세요.`,
  readFailed: '자료실을 읽지 못했어요. 잠시 뒤 다시 시도하거나 [기기에서 파일 고르기]를 써 주세요.',
  engineFailed: 'HWP 파일을 바꾸지 못했어요. 한글에서 .hwpx로 저장한 파일을 골라 주세요. 아무것도 바뀌지 않았어요.',
  notHwp: 'HWP(.hwp) 또는 한글 파일(.hwpx)만 고를 수 있어요.',
  tooBig: '30MB가 넘는 파일은 열지 않아요.',
  noMine: '담당 팀원 칸에서 이 이름을 찾지 못했어요. 이름을 확인해 주세요(요약 표는 틀만 들어가요).',
});
const MAX_BYTES = 30 * 1024 * 1024;

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
  return {me:String(profile?.[0]?.display_name || c?.user?.user_metadata?.display_name || '').trim(), organizations:mine.organizations, orgFallback:mine.fallback, orgFailed:!!mine.failed};
}
async function latestConfirmed(rt) {
  const workspace = rt.context.read()?.workspace?.id;
  const rows = await rt.api(`/rest/v1/app_documents?workspace_id=eq.${encode(workspace)}&category=eq.${encode(CONFIRMED_CATEGORY)}&select=id,title,file_name,created_at&order=created_at.desc,id.desc&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// host: the box journal.js gives; getWeek(): {start, model} (model = journal-weekly.js weeklySummary of the shown week).
export function mountWeeklyHwpx(host, {getWeek, onCopy, rt = window.KPTURuntime}) {
  if (!host) return null;
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = ''; return b; };
  let state = null, engine = null, lib = null, run = 0;
  const start = button('주간보고 한글 파일 만들기', 'hwpxStart', 'secondary');
  const panel = el('section', 'journal-hwpx-panel'); panel.hidden = true; panel.setAttribute('aria-labelledby', 'journalHwpxTitle');
  const title = el('h4', 'journal-heading', '주간보고 한글 파일(.hwpx)'); title.id = 'journalHwpxTitle'; title.tabIndex = -1;
  const status = el('p', 'journal-hwpx-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.hwpxStatus = '';
  const body = el('div', 'journal-hwpx-body');
  panel.append(title, status, body);
  // JOURNAL-복사버튼: [주간보고 초안 복사]는 이 줄의 작은 [복사]로 옮김(같은 복사 기능은 journal.js가 onCopy로 넘김). 한글 파일 상자가 열려도 [복사]는 남는다.
  const bar = el('div', 'journal-hwpx-bar');
  if (onCopy) { const copy = button('복사', 'hwpxCopy'); copy.setAttribute('aria-label', '주간보고 초안 복사'); copy.addEventListener('click', () => onCopy()); bar.append(start, copy); } else bar.append(start);
  host.replaceChildren(bar, panel);
  const say = (text, kind = '') => { status.textContent = text || ''; status.dataset.kind = kind; };
  const lazy = () => lib || (lib = Promise.all([import('./weekly-hwpx/draft.mjs'), import('./hwp-drive.js')]).then(([draft, drive]) => ({draft, drive})));

  function close(message = '') {
    run++; state = null; engine?.close(); engine = null;
    panel.hidden = true; start.hidden = false; body.replaceChildren(); say(message);
  }
  async function open() {
    const {draft} = await lazy();
    start.hidden = true; panel.hidden = false; say('');
    if (!draft.canCompress()) { body.replaceChildren(el('p', 'journal-muted', TEXT.noBrowser), button('닫기', 'hwpxClose')); return; }
    renderSource();
    title.focus();
  }
  function renderSource() {
    const file = el('input'); file.type = 'file'; file.accept = '.hwp,.hwpx'; file.hidden = true; file.dataset.hwpxFile = '';
    const pick = button('기기에서 파일 고르기', 'hwpxPick');
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) fromFile(f); });
    const row = el('div', 'journal-hwpx-actions');
    row.append(button(`자료실 최신 "${CONFIRMED_CATEGORY}" 쓰기`, 'hwpxLibrary', 'primary'), pick, file, button('닫기', 'hwpxClose'));
    body.replaceChildren(el('p', 'journal-muted', TEXT.intro), row);
  }

  async function fromLibrary() {
    const mine = ++run;
    say('자료실에서 확정본을 찾는 중…');
    try {
      const found = await latestConfirmed(rt);
      if (mine !== run) return;
      if (!found) { say(TEXT.noConfirmed, 'error'); return; }
      const {drive} = await lazy();
      if (!drive.isHwpName(found.file_name)) { say(TEXT.notHwp, 'error'); return; }
      say(`"${found.title || found.file_name}"을(를) 여는 중…`);
      const {bytes, info} = await drive.openHwpFromDrive({kind:'library', document:{id:found.id}}, {rt});
      if (mine !== run) return;
      await load(bytes, found.file_name, info.format, `자료실 · ${found.title || found.file_name}`, mine);
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
    await load(new Uint8Array(await file.arrayBuffer()), file.name, /\.hwpx$/i.test(file.name) ? 'hwpx' : 'hwp', `기기 파일 · ${file.name}`, mine);
  }
  // Confirmed report bytes → team report + blank template → my base. Nothing is shown from the file but my own rows.
  async function load(bytes, name, format, source, mine) {
    const {draft} = await lazy();
    try {
      let hwpx = bytes;
      if (format !== 'hwpx') {
        say('HWP를 한글 파일(.hwpx)로 바꾸는 중…(처음엔 조금 걸려요)');
        engine ||= createEngine();
        try { hwpx = await engine.toHwpx(bytes, name); } catch { if (mine === run) say(TEXT.engineFailed, 'error'); return; }
        if (mine !== run) return;
      }
      const pkg = await draft.openConfirmed(hwpx);
      const {team, template} = draft.prepareConfirmed(pkg);
      const context = await readContext(rt).catch(() => ({me:'', organizations:[], orgFallback:true, orgFailed:true}));
      if (mine !== run) return;
      const week = getWeek();
      state = {draft, team, template, source, start:week.start, me:context.me, date:draft.reportDate(reportDay(week.start)), context,
        myOrgs:draft.orgNames(context.organizations), aliases:new Map(context.organizations.map(o => [o.name, Array.isArray(o.aliases) ? o.aliases : []])), edits:null, built:null, saved:null};
      rebase();
      say('');
      renderEdit();
    } catch (error) {
      if (mine === run) say(error?.code ? error.message : '확정본을 읽지 못했어요. 아무것도 만들지 않았어요.', 'error');
    }
  }
  // (Re)build my base from the team report for the current name; edits start from the base lines.
  function rebase() {
    const {draft, team} = state;
    state.base = draft.startDraft(team, {me:state.me, myOrgs:state.myOrgs, date:state.date});
    state.rows = draft.editableRows(state.base, state.me);
    state.orgs = draft.editableOrgs(state.base, 'orgs');
    state.sites = draft.editableOrgs(state.base, 'sites');
    state.edits = {summary:new Map(state.rows.map(r => [r.index, [...r.lines]])), orgs:new Map(state.orgs.map(r => [r.index, [...r.lines]])), sites:new Map(state.sites.map(r => [r.index, [...r.lines]]))};
    state.built = null;
  }

  const areas = {};
  function lineBox(section, row, label) {
    const box = el('div', 'journal-hwpx-row'); box.dataset.hwpxRow = `${section}:${row.index}`;
    const id = `journalHwpx-${section}-${row.index}`;
    const name = el('label', 'journal-hwpx-label', label); name.htmlFor = id;
    const area = el('textarea', 'journal-hwpx-lines'); area.id = id; area.rows = Math.min(12, Math.max(3, row.lines.length + 1));
    area.value = state.edits[section].get(row.index).join('\n'); area.dataset.hwpxLines = '';
    area.addEventListener('input', () => { state.edits[section].set(row.index, area.value.split('\n')); state.built = null; });
    areas[`${section}:${row.index}`] = area;
    const material = el('ul', 'journal-hwpx-material'); material.dataset.hwpxMaterial = `${section}:${row.index}`;
    box.append(name, area, material);
    return box;
  }
  function append(key, text) {
    const area = areas[key];
    if (!area) return;
    const [section, index] = key.split(':');
    const lines = state.edits[section].get(Number(index)).filter(line => line.trim());
    lines.push(text);
    state.edits[section].set(Number(index), lines); state.built = null;
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
        li.append(el('span', 'journal-weekly-day', shortDay(item.day)), doc.createTextNode(item.text + ' '));
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
        li.append(el('span', 'journal-weekly-day', shortDay(item.day)), el('span', 'journal-weekly-label', `${item.from}: `), doc.createTextNode(item.text + ' '));
        const targets = item.section === 'summary' ? state.rows.map(r => [`summary:${r.index}`, `${r.area} › ${r.task}`]) : state.orgs.map(r => [`orgs:${r.index}`, r.org]);
        if (!targets.length) return li;
        const pickId = `journalHwpxPick-${n}`;
        const select = el('select', 'journal-hwpx-target'); select.id = pickId; select.setAttribute('aria-label', '붙일 줄');
        for (const [value, label] of targets) { const o = el('option', '', label); o.value = value; select.append(o); }
        const add = button('붙이기', 'hwpxAppend'); add.dataset.hwpxText = item.text; add.dataset.hwpxPickFrom = pickId;
        li.append(select, add);
        return li;
      }));
    }
    const c = model?.calendar, cal = body.querySelector('[data-hwpx-calendar]');
    if (cal) cal.textContent = !c || c.loading ? '5. 주요 일정 표: 달력 일정을 불러오는 중이에요.'
      : c.failed?.length ? '5. 주요 일정 표: 달력 일정을 불러오지 못해 날짜만 넣어요. [주간 정리]의 5. 주요 일정에서 [다시 시도]할 수 있어요.'
      : `5. 주요 일정 표: ${shortDay(c.days[0])}~${shortDay(c.days.at(-1))} 일정 ${c.rows.reduce((n, r) => n + r.items.length, 0)}개(참석자 = 내 이름)${c.vacations.length ? `, 휴가 ${c.vacations.length}개는 표 아래 ※ 줄` : ''}로 채워요.`;
    const loading = model && ['summary', 'orgs'].some(k => model[k]?.loading);
    const note = body.querySelector('[data-hwpx-loading]');
    if (note) note.hidden = !loading;
  }
  function renderEdit() {
    for (const key of Object.keys(areas)) delete areas[key];
    const s = state, parts = [];
    parts.push(el('p', 'journal-muted', `바탕: ${s.source}`));
    const fields = el('div', 'journal-hwpx-fields');
    const field = (label, value, data) => {
      const wrap = el('label', 'journal-hwpx-field'); wrap.append(el('span', '', label));
      const input = el('input'); input.type = 'text'; input.value = value; input.dataset[data] = ''; wrap.append(input);
      fields.append(wrap); return input;
    };
    const me = field('담당 팀원 칸의 내 이름', s.me, 'hwpxMe');
    me.addEventListener('change', () => { state.me = me.value.trim(); rebase(); renderEdit(); });
    const date = field('■ 일시', s.date, 'hwpxDate');
    date.addEventListener('input', () => { state.date = date.value; state.built = null; });
    parts.push(fields);
    const orgLine = s.context.orgFailed ? '담당 사업장을 읽지 못해 산하조직 표는 비워요.'
      : s.context.orgFallback ? `담당 사업장이 지정되지 않아 모든 조직(${s.context.organizations.length}곳)을 내 조직으로 봤어요. 내 프로필 → 담당 사업장에서 정할 수 있어요.`
      : `내 담당 조직 ${s.context.organizations.length}곳(내 프로필 → 담당 사업장 기준)`;
    const o = el('p', 'journal-muted', orgLine); o.dataset.hwpxOrgs = ''; parts.push(o);
    parts.push(el('p', 'journal-muted', '1. 요청사항 표는 직전 주 확정본 그대로 넣고 "이번 주 확인 필요" 표시를 달아요. 1. 2) 주요 일정과 세부 내용·집회 표는 비워요. 바탕과 다른 줄은 파란 글씨가 돼요.'));
    const cal = el('p', 'journal-muted', ''); cal.dataset.hwpxCalendar = ''; parts.push(cal);
    const loading = el('p', 'journal-muted', '이번 주 기록을 불러오는 중이에요. 다 오면 줄 옆에 보여요.'); loading.dataset.hwpxLoading = ''; loading.hidden = true; parts.push(loading);

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
    if (!s.orgs.length) orgs.append(el('p', 'journal-muted', '확정본 산하조직 표에 내 담당 조직 줄이 없어요.'));
    for (const row of s.orgs) orgs.append(lineBox('orgs', row, row.org));
    parts.push(orgs);
    const rest = el('section', 'journal-hwpx-part'); rest.dataset.hwpxUnmatched = ''; rest.hidden = true;
    rest.append(el('h5', 'journal-weekly-sub', '줄을 찾지 못한 이번 주 기록'), el('p', 'journal-muted', '이름이 확정본 줄과 달라요. 붙일 줄을 골라 주세요.'), el('ul', 'journal-hwpx-material'));
    parts.push(rest);
    const actions = el('div', 'journal-hwpx-actions');
    actions.append(button('한글 파일 만들기(.hwpx)', 'hwpxBuild', 'primary'), button('HWP로 받기', 'hwpxHwp'), button('확정 — 자료실(Drive)에 저장', 'hwpxConfirm'), button('처음부터', 'hwpxRestart'), button('닫기', 'hwpxClose'));
    parts.push(actions);
    body.replaceChildren(...parts);
    renderMaterial();
  }

  async function build() {
    const {draft} = state;
    if (state.built) return state.built;
    const data = draft.assembleDraft({...state.base, date:state.date, ...scheduleForm(getWeek().model?.calendar, state.me)}, state.edits);
    const bytes = await draft.buildHwpx(state.template, data);
    state.built = {bytes, changed:draft.changedCount(data), name:draft.fileNameFor(reportDay(state.start))};
    return state.built;
  }
  async function doBuild() {
    try { const b = await build(); download(b.bytes, b.name, 'application/hwp+zip'); say(`"${b.name}"을(를) 내려받았어요. 바뀐 줄 ${b.changed}개는 파란 글씨예요.`, 'ok'); }
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
      download(hwp, name, 'application/x-hwp'); say(`"${name}"을(를) 내려받았어요.`, 'ok');
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
      // An unknown outcome may have saved: the button stays off until the owner checks the library.
      if (result.kind !== 'unknown') trigger.disabled = result.kind === 'created';
    } finally { trigger.removeAttribute('aria-busy'); }
  }

  host.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if (b.matches('[data-hwpx-start]')) open();
    else if (b.matches('[data-hwpx-close]')) { close(); start.focus(); }
    else if (b.matches('[data-hwpx-library]')) fromLibrary();
    else if (b.matches('[data-hwpx-restart]')) { run++; state = null; say(''); renderSource(); }
    else if (b.matches('[data-hwpx-append]')) { const key = b.dataset.hwpxTarget || doc.getElementById(b.dataset.hwpxPickFrom)?.value; append(key, b.dataset.hwpxText); say('붙였어요. 칸에서 고칠 수 있어요.'); }
    else if (!state) return;
    else if (b.matches('[data-hwpx-build]')) doBuild();
    else if (b.matches('[data-hwpx-hwp]')) doHwp();
    else if (b.matches('[data-hwpx-confirm]')) doConfirm(b);
  });

  return {
    // The shown week or the owner changed: a draft belongs to one week, so it closes.
    setWeek(week) { if (state && week !== state.start) close('주가 바뀌어 한글 파일 초안을 닫았어요.'); },
    // The week's reads landed: refresh only the candidates beside the rows (what was typed stays).
    refresh() { if (state) state.built = null; renderMaterial(); },
    close,
  };
}
