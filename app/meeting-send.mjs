// BIZ-저장먼저닫기(요청함 11/11 07:01, 명진 "저장 버튼 누르면 일단 창 닫히고 백그라운드에서 업로드 이어 가는"):
// 사업 보고에 사진·자료 '한 묶음 올리기'. 글 저장이 끝난 뒤 창은 닫히고, 고른 파일은 이 묶음으로 뒤에서 하나씩 올라간다.
// - 줄 세우기는 새로 만들지 않는다: 자료 등록 창이 쓰는 뒤 줄(library-upload.js luBackTail)에 line()으로 선다(#2345와 같은 한 길).
// - 파일은 그 탭 메모리에만 둔다(기기 저장소 없음). 한 번에 하나만 읽어 보낸다(폰 메모리).
// - 놓은 그 사업 보고 id로 올린다. 화면(메뉴)을 옮겨도 멈추지 않는다. 멈추는 것은 계정·작업공간이 바뀔 때뿐(gone).
// - 못 올린 파일만 [다시 올리기]. 결과를 확인하지 못한 파일(이미 붙었을 수 있음)은 저절로 다시 보내지 않고, 확인을 받은 것만 보낸다.
//   ✕로 취소한 파일은 못 올린 파일과 섞어 다시 보내지 않는다(잘못 고른 사진을 뺀 것일 수 있다) — 못 올린 것이 없을 때만 취소한 것을 다시 올릴 수 있다.
// - 폰 앱 뒤에서 올리기(APP-뒤에서올리기 PR-2, S58-12)가 끼어드는 자리는 run()의 handoff 한 곳이다: handoff(target, items, {alive})가
//   {ok:true, jobs:[{id, count}]}를 돌려주면 앞에서부터 그 개수만큼은 앱이 맡는다(state 'handed' — 화면 안 올리기를 건너뜀). 넘기지 못한 뒤쪽 파일과
//   {ok:false}·예외는 지금 길 그대로 올린다. items = [{file, fields}] — fields는 사진일 때만(제목·종류·날짜), app-upload.js appUpload().send가 받는 모양 그대로.
//   앱이 끝을 알려 오면 handedJob(job)이 그 파일을 올림·못 올림으로 옮기고, 넘긴 파일이 다 끝나야 묶음의 끝(done)을 알린다. 앱이 멈췄으면(stopped) 넘긴 채로 둔다
//   (앱이 다시 열릴 때 스스로 잇는다 — 화면이 다시 고르게 하지 않는다).
// - 화면을 벗어난 사이 다 보내기 전에 끊긴 파일(classify가 away: true — 서버가 받지 못한 것): 화면으로 돌아오면(back) 그 자리에서 한 번 저절로 다시 보낸다.
//   그래도 안 되면 보통 실패(그 줄에 [다시 올리기]). 다 보낸 뒤 끊긴 것(결과 불명)은 저절로 다시 보내지 않는다(같은 자료가 두 번 붙지 않게).
// 화면·서버를 모르는 순수 부품이라 단위 시험으로 본다(deps로 받음).

const words = (photos, files) => [photos ? `사진 ${photos}장` : '', files ? `자료 ${files}개` : ''].filter(Boolean).join('·');
// 올리는 중 한 줄: '사진 7장·자료 1개 올리는 중'.
export const sendLiveLine = ({photos = 0, files = 0} = {}) => { const w = words(photos, files); return w ? `${w} 올리는 중` : ''; };
// 다 올림: '사진 7장·자료 1개 올렸어요'.
export const sendDoneLine = ({photos = 0, files = 0} = {}) => { const w = words(photos, files); return w ? `${w} 올렸어요` : ''; };
// 못 올린 것이 있음: '사진 2장 못 올렸어요 · 사진 5장·자료 1개 올렸어요'.
export function sendFailLine({okPhotos = 0, okFiles = 0, badPhotos = 0, badFiles = 0} = {}) {
  const bad = words(badPhotos, badFiles), ok = words(okPhotos, okFiles);
  if (!bad) return sendDoneLine({photos: okPhotos, files: okFiles});
  return `${bad} 못 올렸어요${ok ? ` · ${ok} 올렸어요` : ''}`;
}

// 앱에 넘기는 동안(화면이 살아 있어야 하는 몇 초): '사진 7장·자료 1개 앱에 넘기는 중'.
export const sendHandingLine = ({photos = 0, files = 0} = {}) => { const w = words(photos, files); return w ? `${w} 앱에 넘기는 중` : ''; };
// 앱이 맡은 묶음을 기다리는 한 줄: '사진 7장·자료 1개 앱이 뒤에서 올리는 중'.
export const sendHandedLine = ({photos = 0, files = 0} = {}) => { const w = words(photos, files); return w ? `${w} 앱이 뒤에서 올리는 중` : ''; };

/**
 * 폰 앱 다리(app-upload.js appUpload())에 한 묶음을 넘기는 handoff를 만든다. 다리가 없거나(PC·폰 브라우저) 옛 앱·위젯 로그인 없음이면 {ok:false} → 지금 길 그대로.
 * 앱이 한 번에 받는 수(max)를 넘으면 나눠 넘긴다: 첫 묶음부터 못 넘기면 전부 지금 길, 뒤 묶음을 못 넘기면 넘긴 데까지만 앱이 맡는다(jobs의 count 합).
 * ids(target): 대상을 다리가 받는 모양({meeting, project})으로. 넘기는 것은 파일·대상 id·사진 칸뿐이다(로그인 정보는 이 길에 없다).
 */
export function createAppHandoff(up, {max = 20, kind = 'meeting', ids = target => ({meeting: target?.id || '', project: target?.project_id || ''})} = {}) {
  // 옛 앱은 물음에 답하지 않는다(답을 기다리는 시간이 든다): 한 번 답이 없었으면 이 화면에서는 다시 묻지 않는다(올리기가 매번 늦어지지 않게).
  let silent = false;
  // took(job): 묶음 하나를 앱이 맡은 그 자리에서 알린다 — 다음 묶음을 넘기는 사이 앱이 앞 묶음의 끝을 알려 와도 그 파일 줄을 찾을 수 있게.
  return async (target, items, {alive = () => true, started = () => {}, took = () => {}} = {}) => {
    if (!up?.usable || !items?.length || silent) return {ok: false, error: 'off'};
    const on = await up.ready();
    if (!up.known()) silent = true;
    if (!on || !up.can(kind)) return {ok: false, error: 'off'};
    try { started(); } catch { /* 알림뿐 */ }
    const to = {kind, ...ids(target)}, before = new Set(up.jobs().map(job => job.id)), jobs = [];
    let error = '';
    for (let at = 0; at < items.length; at += max) {
      const part = items.slice(at, at + max);
      let r = await up.send(to, part, {alive});
      // 답을 못 받았을 뿐 앱은 이미 맡았을 수 있다(넘긴 직후 앱을 벗어난 때): 앱에 다시 물어 이 대상의 새 묶음이 걸려 있으면 넘긴 것으로 본다
      // (같은 파일을 화면에서 또 올려 두 번 붙지 않게). 새 묶음이 없으면 앱이 받지 못한 것 → 지금 길.
      if (!r?.ok && r?.error === 'timeout' && alive()) {
        await up.ready();
        const kept = up.jobs(to.meeting).find(job => !before.has(job.id) && job.total === part.length);
        if (kept) r = {ok: true, id: kept.id};
      }
      if (!r?.ok) { error = r?.error || 'failed'; break; }
      before.add(r.id);
      const job = {id: r.id, count: part.length};
      jobs.push(job);
      try { took(job); } catch { /* 알림뿐 */ }
    }
    return jobs.length ? {ok: true, jobs, error} : {ok: false, error};
  };
}

/**
 * 앱이 알려 오는 묶음(up.onJob)을 넘긴 파일 줄에 옮긴다(send.handedJob). 끝난 묶음은 화면이 반영한 뒤 앱의 기록을 지운다(up.seen).
 * 이 화면이 넘기지 않은 묶음(화면을 닫았다 다시 연 사이 끝났거나 멈춘 것)은 orphan(job)으로 한 번만 알린다 — 화면은 목록을 새로 읽고 한 줄로 알린다.
 * 앱은 물을 때마다 같은 묶음을 다시 알려 준다 → 같은 끝을 두 번 알리지 않는다. 붙인 때 앱이 이미 알려 둔 묶음도 한 번 본다. 돌려줌: 그만 듣기.
 */
export function bindAppJobs(up, send, {orphan = () => {}} = {}) {
  if (!up?.usable) return () => {};
  const own = new Set(), told = new Set();
  const take = job => {
    if (!job?.id) return;
    let mine = false;
    try { mine = !!send.handedJob(job); } catch { mine = false; }
    if (mine) own.add(job.id);
    else if (!own.has(job.id) && job.state !== 'run' && !told.has(`${job.id}:${job.state}`)) { told.add(`${job.id}:${job.state}`); try { orphan(job); } catch { /* 알림뿐 */ } }
    if (job.state === 'done') up.seen(job.id);
  };
  const stop = up.onJob(take);
  for (const job of up.jobs()) take(job);
  return stop;
}

// 못 올린 것(failed) · 결과 불명(unknown) · 앞 실패로 서 있던 것(held) = '못 올렸어요'로 센다. 취소한 것(cancelled)은 따로 센다 — 둘 다 [다시 올리기] 대상.
const BAD = new Set(['failed', 'unknown', 'held']);
const LEFT = new Set([...BAD, 'cancelled']);
const OPEN = new Set(['waiting', 'sending']);
// 앱이 맡은 파일(handed): 화면은 보내지 않고 앱의 끝 알림을 기다린다. 새로 고침 물음·[다시 올리기] 막기에는 세지 않는다(화면이 없어도 앱이 끝까지 올린다).
const HANDED = 'handed';
// 앱이 알려 준 까닭 가운데 같은 파일로 다시 보내도 안 되는 것(다시 골라야 하거나 대상이 안 됨).
const HANDED_FIXED = new Set(['too_big', 'forbidden', 'gone']);

/**
 * @param {object} deps
 * @param {(work: () => Promise<void>) => Promise<void>} deps.line   공용 뒤 줄 끝에 세운다(앞 일이 끝나면 work를 부름)
 * @param {(target, file, opts: {job, gone}) => Promise<any>} deps.upload 파일 하나 올리기(실패면 던짐)
 * @param {(file) => boolean} deps.isPhoto
 * @param {(file) => object} [deps.track]      올리는 중 표시 하나(대기부터). {fail(msg), cancel(), cancelled()}
 * @param {(error) => {kind?: string, stop?: boolean, message?: string}} [deps.classify] 실패 가르기(kind 'unknown' = 결과 불명)
 * @param {(file) => ({message: string}|null)} [deps.preflight]      보내기 전에 알 수 있는 실패(빈 파일·크기 초과)
 * @param {() => any} [deps.scope]             지금 사람·작업공간(묶음을 만들 때 떼어 둠)
 * @param {(scope) => boolean} [deps.gone]     그 사람·작업공간이 아니게 됨(남은 파일을 보내지 않고 알리지도 않음)
 * @param {(count: number) => Promise<boolean>} [deps.confirmUnknown] 결과 불명 파일을 다시 보낼지 묻기
 * @param {(target, items, opts: {alive, started}) => Promise<{ok: boolean, jobs?: {id: string, count: number}[]}>} [deps.handoff] 폰 앱 다리(없으면 화면 안에서 올림)
 * @param {(file, target) => object|undefined} [deps.fields]         handoff에 넘길 사진 칸
 * @param {() => Promise<void>} [deps.back]    화면이 다시 보이면 풀리는 약속(없으면 돌아와도 저절로 다시 보내지 않음)
 * @param {(code: string) => string} [deps.handedText]               앱이 알려 준 까닭 코드 → 화면 글
 * @param {(event) => void} [deps.report]      queued · file · done · handing · handing-failed · handed · handed-stopped · paused · resumed (화면이 그림)
 */
export function createMeetingSend({line, upload, isPhoto, track = () => null, classify = () => ({}), preflight = () => null,
  scope = () => null, gone = () => false, confirmUnknown = async () => false, handoff = null, fields = () => undefined, report = () => {},
  back = null, handedText = code => String(code || '')}) {
  const batches = new Set();
  let seq = 0;
  const tell = event => { try { report(event); } catch { /* 그리기 실패가 올리기를 막지 않는다 */ } };
  const count = (batch, states) => {
    let photos = 0, files = 0;
    for (const e of batch.entries) if (states.has(e.state)) { if (e.photo) photos++; else files++; }
    return {photos, files};
  };
  const tally = batch => {
    const ok = count(batch, new Set(['done'])), bad = count(batch, BAD), open = count(batch, OPEN), off = count(batch, new Set(['cancelled'])), app = count(batch, new Set([HANDED]));
    return {okPhotos: ok.photos, okFiles: ok.files, badPhotos: bad.photos, badFiles: bad.files, openPhotos: open.photos, openFiles: open.files, cancelled: off.photos + off.files,
      handedPhotos: app.photos, handedFiles: app.files, unknown: batch.entries.filter(e => e.state === 'unknown').length, retry: batch.entries.some(again)};
  };
  // 다시 보낼 수 있는 것: 못 올린 것·취소한 것·앞 실패로 서 있던 것·결과 불명(확인 뒤). 다시 골라야 하는 파일(fixed: 빈 파일·읽지 못함)은 아니다.
  const again = e => LEFT.has(e.state) && !e.fixed;
  const live = batch => batch.entries.some(e => OPEN.has(e.state));
  const waitsApp = batch => batch.entries.some(e => e.state === HANDED);
  const drop = batch => { if (!batch.entries.some(e => OPEN.has(e.state) || e.state === HANDED || again(e))) batches.delete(batch); };
  const fail = (entry, state, message = '') => { entry.state = state; entry.message = String(message || ''); try { entry.job?.fail?.(entry.message); } catch { /* 표시뿐 */ } };
  // 앱이 맡은 파일의 표시: '앱이 뒤에서 올리는 중'(표시 부품이 모르면 그 줄을 지운다).
  const showHanded = (entry, state = {}) => { try { if (typeof entry.job?.hand === 'function') entry.job.hand(state); else entry.job?.cancel?.(); } catch { /* 표시뿐 */ } };
  // 묶음의 끝: 이번에 새로 올라간 수(sent)는 한 번만 센다(앱이 맡은 파일이 뒤늦게 끝나도 같은 파일을 또 세지 않게).
  const finish = batch => {
    const fresh = batch.entries.filter(e => e.state === 'done' && !e.counted);
    for (const e of fresh) e.counted = true;
    const stopped = batch.stopped || null; batch.stopped = null;
    tell({type: 'done', batch, ...tally(batch), sent: fresh.length, message: stopped?.message || batch.entries.find(e => LEFT.has(e.state) && e.message)?.message || '', stopped});
    drop(batch);
  };

  async function run(batch) {
    const mine = batch.entries.filter(e => e.state === 'waiting');
    const quiet = () => { for (const e of mine) if (OPEN.has(e.state)) { e.state = 'gone'; try { e.job?.cancel?.(); } catch { /* 표시뿐 */ } } batches.delete(batch); };
    if (gone(batch.scope)) { quiet(); return; }
    if (handoff) {
      let handed = null, handing = false, at = 0;
      // started: 다리가 받겠다고 해 넘기기 시작한 때(화면이 살아 있어야 하는 동안) — 화면이 '앱에 넘기는 중'을 알린다.
      const started = () => { handing = true; tell({type: 'handing', batch, ...tally(batch)}); };
      // took: 앱이 묶음 하나를 맡은 그 자리에서 앞에서부터 그 개수만큼 넘긴 것으로 둔다(20개씩 나눠 넘기는 사이 앞 묶음의 끝이 와도 줄을 찾게).
      const took = job => { for (let i = 0; i < job.count && at < mine.length; i++, at++) { const e = mine[at]; e.state = HANDED; e.hand = {id: String(job.id || ''), index: i}; showHanded(e); } };
      try { handed = await handoff(batch.target, mine.map(e => ({file: e.file, fields: e.photo ? fields(e.file, batch.target) : undefined})), {alive: () => !gone(batch.scope), started, took}); } catch { handed = null; }
      const left = gone(batch.scope);
      if (handing && (left || !at)) tell({type: 'handing-failed', batch});
      if (left) { quiet(); return; }
      // took을 부르지 않는 다리(묶음 이름만 돌려줌)는 여기서 넘긴 것으로 둔다. 못 넘긴 뒤쪽 파일은 아래에서 지금 길로 올린다.
      if (handed?.ok && !at) for (const job of (Array.isArray(handed.jobs) && handed.jobs.length ? handed.jobs : [{id: handed.id, count: mine.length}])) took(job);
      if (at) tell({type: 'handed', batch, handed, count: at, ...tally(batch)});
    }
    let stopped = null;
    for (const entry of mine) {
      if (gone(batch.scope)) { quiet(); return; }
      if (entry.state !== 'waiting') continue;
      if (entry.job?.cancelled?.()) { entry.state = 'cancelled'; continue; }
      if (stopped) { fail(entry, 'held', stopped.message); continue; }
      const early = preflight(entry.file);
      if (early) { fail(entry, 'failed', early.message); entry.fixed = true; continue; }
      entry.state = 'sending';
      try { entry.job?.start?.(); } catch { /* 표시뿐 */ }
      tell({type: 'file', batch, entry});
      let resumed = false, cancelled = false;
      for (;;) {
        try {
          entry.doc = await upload(batch.target, entry.file, {job: entry.job, gone: () => gone(batch.scope)});
          entry.state = 'done'; entry.message = '';
        } catch (error) {
          if (error?.code === 'upload_cancelled') { entry.state = 'cancelled'; cancelled = true; break; }
          const why = classify(error) || {};
          // 화면을 벗어난 사이 다 보내기 전에 끊김(서버가 받지 못함): 돌아오면 이 자리에서 한 번만 저절로 다시 보낸다. 줄은 그동안 서 있다(뒤 파일이 앞지르지 않음).
          if (why.away && back && !resumed) {
            resumed = true; entry.message = String(why.message || '');
            if (entry.job && entry.job.phase !== 'failed') { try { entry.job.fail?.(entry.message); } catch { /* 표시뿐 */ } }
            tell({type: 'paused', batch, entry});
            try { await back(); } catch { /* 돌아옴을 알 수 없으면 바로 다시 */ }
            if (gone(batch.scope)) { quiet(); return; }
            try { entry.job?.cancel?.(); } catch { /* 표시뿐 */ }
            entry.job = track(entry.file, batch); entry.message = '';
            try { entry.job?.start?.(); } catch { /* 표시뿐 */ }
            tell({type: 'resumed', batch, entry});
            continue;
          }
          entry.state = why.kind === 'unknown' ? 'unknown' : 'failed'; entry.message = String(why.message || error?.message || '');
          entry.fixed = why.retry === false;
          // 보내기 전에 멈춘 실패(파일을 읽지 못함 등)는 올리기 길이 표시를 바꾸지 못했다: 여기서 실패로 바꾼다(끝없이 '올리는 중'으로 남지 않게).
          if (entry.job && entry.job.phase !== 'failed') { try { entry.job.fail?.(entry.message); } catch { /* 표시뿐 */ } }
          if (why.stop) stopped = {message: entry.message, error, type: why.type || ''};
        }
        break;
      }
      if (cancelled) continue;
      tell({type: 'file', batch, entry});
    }
    if (gone(batch.scope)) { quiet(); return; }
    if (stopped) batch.stopped = stopped;
    // 앱이 맡은 파일이 남아 있으면 묶음의 끝은 앱이 알려 올 때(handedJob) 알린다.
    if (waitsApp(batch)) return;
    finish(batch);
  }
  const stand = batch => { const p = Promise.resolve(line(() => run(batch))).catch(() => {}); batch.settled = p; return p; };

  return {
    /**
     * target: 붙일 사업 보고(그때 값 {id, project_id, kind, day}). files: 고른 파일. 돌려줌: 묶음(settled = 이 묶음이 끝나는 약속 — 앱이 맡은 파일은 넘긴 때까지).
     * quiet: 부른 곳이 진행·끝 알림을 스스로 한다(report를 듣는 쪽이 본다 — 회의자료 놓기 줄).
     */
    send(target, files, {quiet = false} = {}) {
      const batch = {id: 'ms' + (++seq), target, scope: scope(), settled: null, quiet: !!quiet, stopped: null,
        entries: Array.from(files || []).map(file => ({file, photo: !!isPhoto(file), state: 'waiting', message: '', job: null, doc: null}))};
      if (!batch.entries.length) { batch.settled = Promise.resolve(); return batch; }
      for (const e of batch.entries) e.job = track(e.file, batch);
      batches.add(batch);
      tell({type: 'queued', batch, ...tally(batch)});
      stand(batch);
      return batch;
    },
    /** [다시 올리기]: 못 올린 파일만(올라간 것은 다시 보내지 않는다). 결과 불명은 확인을 받은 것만. 못 올린 것이 없으면 ✕로 취소한 것을 다시. */
    async retry(batch) {
      if (!batch || !batches.has(batch) || live(batch) || gone(batch.scope)) return false;
      const bad = batch.entries.filter(e => BAD.has(e.state) && !e.fixed);
      const pool = bad.length ? bad : batch.entries.filter(e => e.state === 'cancelled');
      const unknown = pool.filter(e => e.state === 'unknown');
      const include = unknown.length ? await Promise.resolve(confirmUnknown(unknown.length)).catch(() => false) : false;
      if (!batches.has(batch) || live(batch) || gone(batch.scope)) return false;
      const list = pool.filter(e => LEFT.has(e.state) && (e.state !== 'unknown' || include));
      if (!list.length) { tell({type: 'kept', batch, ...tally(batch)}); return false; }
      // 옛 '실패' 표시는 지우고 새 표시(대기)로 바꾼다(같은 파일 줄이 실패·대기 두 줄로 겹치지 않게).
      for (const e of list) { try { e.job?.cancel?.(); } catch { /* 표시뿐 */ } e.state = 'waiting'; e.message = ''; e.job = track(e.file, batch); }
      tell({type: 'queued', batch, ...tally(batch), again: true});
      stand(batch);
      return true;
    },
    /**
     * 앱이 알려 준 묶음 하나(app-upload.js onJob의 job: {id, state, reason, docs, errors}). 이 화면이 넘긴 파일이면 그 줄을 올림·못 올림으로 옮긴다.
     * 올라간 파일은 그때그때(올리는 중에도), 못 올린 파일은 까닭과 함께. 멈춤(stopped)은 넘긴 채로 둔다. 돌려줌: 이 화면이 넘긴 묶음이었나.
     */
    handedJob(job) {
      const id = String(job?.id || '');
      if (!id) return false;
      let found = false;
      for (const batch of [...batches]) {
        const mine = batch.entries.filter(e => e.state === HANDED && e.hand?.id === id);
        if (!mine.length) continue;
        found = true;
        if (gone(batch.scope)) { for (const e of mine) { e.state = 'gone'; try { e.job?.cancel?.(); } catch { /* 표시뿐 */ } } if (!live(batch)) batches.delete(batch); continue; }
        for (const e of mine) {
          const doc = String(job.docs?.[e.hand.index] || ''), code = String(job.errors?.[e.hand.index] || '');
          if (doc) { e.state = 'done'; e.message = ''; e.doc = {id: doc}; e.byApp = true; try { e.job?.done?.(); } catch { /* 표시뿐 */ } }
          else if (code || job.state === 'done') {
            // 끝났는데 결과가 적히지 않은 파일은 결과 불명으로 둔다(붙었을 수 있다 — 저절로 다시 보내지 않음).
            const why = code || 'unknown';
            e.byApp = true; e.fixed = HANDED_FIXED.has(why);
            fail(e, why === 'unknown' ? 'unknown' : 'failed', handedText(why));
          } else { showHanded(e, job.state === 'stopped' ? {stopped: true, reason: String(job.reason || '')} : {}); continue; }
          tell({type: 'file', batch, entry: e});
        }
        if (job.state === 'stopped' && waitsApp(batch)) tell({type: 'handed-stopped', batch, job, ...tally(batch)});
        if (!waitsApp(batch) && !live(batch)) finish(batch);
      }
      return found;
    },
    /** 그 사업 보고로 올라가는 중이거나(앱이 맡은 것 포함) 못 올린 파일인가(상세의 올리는 줄이 자기 것을 찾는 열쇠). */
    has: (targetId, file) => [...batches].some(b => b.target?.id === targetId && b.entries.some(e => e.file === file && (OPEN.has(e.state) || LEFT.has(e.state) || e.state === HANDED))),
    going: targetId => [...batches].some(b => b.target?.id === targetId && live(b)),
    any: () => [...batches].some(live),
    /** 알림을 닫았거나 계정이 바뀜: 못 올린 파일을 메모리에서 놓는다(올리는 중인 묶음은 그대로 끝까지). */
    forget(batch) { if (batch && !live(batch)) batches.delete(batch); },
    /** 계정·작업공간이 바뀜: 그 사람의 묶음이 아니게 된 것(when)을 놓는다. 올리는 중이던 것은 run()이 gone으로 멈춘다. */
    clear(when = () => true) { for (const b of [...batches]) if (when(b)) { for (const e of b.entries) if (OPEN.has(e.state) && e.state !== 'sending') e.state = 'gone'; if (!live(b)) batches.delete(b); } },
    /** 화면 알림 듣기(win = window): 올리는 동안 새로 고치려 하면 먼저 묻게 하고(줄은 메모리뿐), 계정·작업공간이 바뀌면 그 사람 것이 아니게 된 묶음을 놓는다. */
    watch(win) {
      win?.addEventListener?.('kptu:before-reload', event => { if (event?.detail && [...batches].some(live)) event.detail.otherDraft = true; });
      win?.addEventListener?.('kptu:session-changed', () => this.clear(batch => gone(batch.scope)));
    },
    tally,
  };
}
