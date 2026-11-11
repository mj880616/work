// BIZ-저장먼저닫기(요청함 11/11 07:01, 명진 "저장 버튼 누르면 일단 창 닫히고 백그라운드에서 업로드 이어 가는"):
// 사업 보고에 사진·자료 '한 묶음 올리기'. 글 저장이 끝난 뒤 창은 닫히고, 고른 파일은 이 묶음으로 뒤에서 하나씩 올라간다.
// - 줄 세우기는 새로 만들지 않는다: 자료 등록 창이 쓰는 뒤 줄(library-upload.js luBackTail)에 line()으로 선다(#2345와 같은 한 길).
// - 파일은 그 탭 메모리에만 둔다(기기 저장소 없음). 한 번에 하나만 읽어 보낸다(폰 메모리).
// - 놓은 그 사업 보고 id로 올린다. 화면(메뉴)을 옮겨도 멈추지 않는다. 멈추는 것은 계정·작업공간이 바뀔 때뿐(gone).
// - 못 올린 파일만 [다시 올리기]. 결과를 확인하지 못한 파일(이미 붙었을 수 있음)은 저절로 다시 보내지 않고, 확인을 받은 것만 보낸다.
// - 폰 앱 뒤에서 올리기(APP-뒤에서올리기 PR-2)가 끼어드는 자리는 run()의 handoff 한 곳이다: handoff(target, items)가 {ok:true}를 돌려주면
//   화면 안 올리기를 건너뛴다. items = [{file, fields}] — fields는 사진일 때만(제목·종류·날짜), app-upload.js appUpload().send가 받는 모양 그대로.
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

// 못 올린 것(failed) · 결과 불명(unknown) · 앞 실패로 서 있던 것(held) = '못 올렸어요'로 센다. 취소한 것(cancelled)은 따로 센다 — 둘 다 [다시 올리기] 대상.
const BAD = new Set(['failed', 'unknown', 'held']);
const LEFT = new Set([...BAD, 'cancelled']);
const OPEN = new Set(['waiting', 'sending']);

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
 * @param {(target, items) => Promise<{ok: boolean}>} [deps.handoff] 폰 앱 다리(없으면 화면 안에서 올림)
 * @param {(file, target) => object|undefined} [deps.fields]         handoff에 넘길 사진 칸
 * @param {(event) => void} [deps.report]      queued · file · done · handed (화면이 그림)
 */
export function createMeetingSend({line, upload, isPhoto, track = () => null, classify = () => ({}), preflight = () => null,
  scope = () => null, gone = () => false, confirmUnknown = async () => false, handoff = null, fields = () => undefined, report = () => {}}) {
  const batches = new Set();
  let seq = 0;
  const tell = event => { try { report(event); } catch { /* 그리기 실패가 올리기를 막지 않는다 */ } };
  const count = (batch, states) => {
    let photos = 0, files = 0;
    for (const e of batch.entries) if (states.has(e.state)) { if (e.photo) photos++; else files++; }
    return {photos, files};
  };
  const tally = batch => {
    const ok = count(batch, new Set(['done'])), bad = count(batch, BAD), open = count(batch, OPEN), off = count(batch, new Set(['cancelled']));
    return {okPhotos: ok.photos, okFiles: ok.files, badPhotos: bad.photos, badFiles: bad.files, openPhotos: open.photos, openFiles: open.files, cancelled: off.photos + off.files,
      unknown: batch.entries.filter(e => e.state === 'unknown').length, retry: batch.entries.some(again)};
  };
  // 다시 보낼 수 있는 것: 못 올린 것·취소한 것·앞 실패로 서 있던 것·결과 불명(확인 뒤). 다시 골라야 하는 파일(fixed: 빈 파일·읽지 못함)은 아니다.
  const again = e => LEFT.has(e.state) && !e.fixed;
  const live = batch => batch.entries.some(e => OPEN.has(e.state));
  const drop = batch => { if (!batch.entries.some(e => OPEN.has(e.state) || again(e))) batches.delete(batch); };
  const fail = (entry, state, message = '') => { entry.state = state; entry.message = String(message || ''); try { entry.job?.fail?.(entry.message); } catch { /* 표시뿐 */ } };

  async function run(batch) {
    const mine = batch.entries.filter(e => e.state === 'waiting');
    const quiet = () => { for (const e of mine) if (OPEN.has(e.state)) { e.state = 'gone'; try { e.job?.cancel?.(); } catch { /* 표시뿐 */ } } batches.delete(batch); };
    if (gone(batch.scope)) { quiet(); return; }
    if (handoff) {
      let handed = null;
      try { handed = await handoff(batch.target, mine.map(e => ({file: e.file, fields: e.photo ? fields(e.file, batch.target) : undefined}))); } catch { handed = null; }
      if (handed?.ok) { for (const e of mine) { e.state = 'handed'; try { e.job?.cancel?.(); } catch { /* 표시뿐 */ } } tell({type: 'handed', batch, handed}); drop(batch); return; }
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
      try {
        entry.doc = await upload(batch.target, entry.file, {job: entry.job, gone: () => gone(batch.scope)});
        entry.state = 'done'; entry.message = '';
      } catch (error) {
        if (error?.code === 'upload_cancelled') { entry.state = 'cancelled'; continue; }
        const why = classify(error) || {};
        entry.state = why.kind === 'unknown' ? 'unknown' : 'failed'; entry.message = String(why.message || error?.message || '');
        entry.fixed = why.retry === false;
        // 보내기 전에 멈춘 실패(파일을 읽지 못함 등)는 올리기 길이 표시를 바꾸지 못했다: 여기서 실패로 바꾼다(끝없이 '올리는 중'으로 남지 않게).
        if (entry.job && entry.job.phase !== 'failed') { try { entry.job.fail?.(entry.message); } catch { /* 표시뿐 */ } }
        if (why.stop) stopped = {message: entry.message, error, type: why.type || ''};
      }
      tell({type: 'file', batch, entry});
    }
    if (gone(batch.scope)) { quiet(); return; }
    tell({type: 'done', batch, ...tally(batch), sent: mine.filter(e => e.state === 'done').length, message: stopped?.message || batch.entries.find(e => LEFT.has(e.state) && e.message)?.message || '', stopped});
    drop(batch);
  }
  const stand = batch => { const p = Promise.resolve(line(() => run(batch))).catch(() => {}); batch.settled = p; return p; };

  return {
    /** target: 붙일 사업 보고(그때 값 {id, project_id, kind, day}). files: 고른 파일. 돌려줌: 묶음(settled = 이 묶음이 끝나는 약속). */
    send(target, files) {
      const batch = {id: 'ms' + (++seq), target, scope: scope(), settled: null,
        entries: Array.from(files || []).map(file => ({file, photo: !!isPhoto(file), state: 'waiting', message: '', job: null, doc: null}))};
      if (!batch.entries.length) { batch.settled = Promise.resolve(); return batch; }
      for (const e of batch.entries) e.job = track(e.file, batch);
      batches.add(batch);
      tell({type: 'queued', batch, ...tally(batch)});
      stand(batch);
      return batch;
    },
    /** [다시 올리기]: 못 올린 파일만(올라간 것은 다시 보내지 않는다). 결과 불명은 확인을 받은 것만. */
    async retry(batch) {
      if (!batch || !batches.has(batch) || live(batch) || gone(batch.scope)) return false;
      const unknown = batch.entries.filter(e => e.state === 'unknown');
      const include = unknown.length ? await confirmUnknown(unknown.length).catch(() => false) : false;
      if (!batches.has(batch) || live(batch) || gone(batch.scope)) return false;
      const list = batch.entries.filter(e => again(e) && (e.state !== 'unknown' || include));
      if (!list.length) { tell({type: 'kept', batch, ...tally(batch)}); return false; }
      for (const e of list) { e.state = 'waiting'; e.message = ''; e.job = track(e.file, batch); }
      tell({type: 'queued', batch, ...tally(batch), again: true});
      stand(batch);
      return true;
    },
    /** 그 사업 보고로 올라가는 중이거나 못 올린 파일인가(상세의 올리는 줄이 자기 것을 찾는 열쇠). */
    has: (targetId, file) => [...batches].some(b => b.target?.id === targetId && b.entries.some(e => e.file === file && (OPEN.has(e.state) || LEFT.has(e.state)))),
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
