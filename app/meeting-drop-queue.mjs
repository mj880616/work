// UX-먼저묻고뒤에처리(요청함 11/09 18:04, 명진 원칙 "화면 표시 먼저 → 결정·입력 먼저 → 처리는 뒤에서(화면 옮겨도 끝까지)").
// 사업 보고 창에 놓은 파일의 뒤처리 줄 하나. 묻기는 놓자마자 부르는 쪽(meeting-round-detail.js)이 끝내고, 여기는 정해진 일만 순서대로 한다:
//   ① 파일 올리기(파일마다, 같은 자료실 올리기 길 library-files + meeting_id) → ② 결과 파일 본문 읽기(넣기로 했을 때만) → ③ 결과 칸에 더하기.
// - 일은 놓은 그 사업 보고 id로 한다. 다른 사업 보고·다른 화면으로 옮겨도 멈추지 않는다(지금 보이는 창을 보지 않음).
// - 처리 중에 또 놓으면 줄 끝에 선다(다시 놓아 달라고 하지 않음). 한 번에 한 묶음씩.
// - 실패하면 알리고 [다시]로 그 단계부터 다시 한다(올린 파일은 다시 올리지 않음). 기기에 아무것도 저장하지 않는다(메모리뿐).
// 화면·서버를 모르는 순수 부품이라 단위 시험으로 본다(deps로 받음).

/**
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.ready            자료실 올리기 준비(못 하면 false)
 * @param {(meeting, file) => Promise<any>} deps.upload  파일 하나 올리기(실패면 던짐)
 * @param {(files) => Promise<string>} deps.read         결과 파일 본문 읽기('' = 못 읽음)
 * @param {(meeting, text) => Promise<boolean>} deps.append 결과 칸에 더하기(성공 true)
 * @param {(event) => void} [deps.report]               진행·끝·실패 알림(화면이 그림)
 */
export function createDropQueue({ready, upload, read, append, report = () => {}}) {
  const waiting = [];
  let running = null;

  async function runUploads(job) {
    const left = job.files.filter(f => !job.sent.has(f));
    for (const [i, file] of left.entries()) {
      report({type: 'uploading', job, file, index: job.sent.size + 1, total: job.files.length, step: i});
      try { await upload(job.meeting, file); job.sent.add(file); job.failed.delete(file); }
      catch (err) { job.failed.set(file, err?.message || ''); }
    }
  }
  async function runText(job) {
    if (!job.readFiles.length || job.textDone) return;
    report({type: 'reading', job});
    let text = '';
    try { text = await read(job.readFiles); } catch { text = ''; }
    if (!text) { job.textDone = true; job.textState = 'unread'; return; }
    let ok = false;
    try { ok = await append(job.meeting, text); } catch { ok = false; }
    job.textState = ok ? 'added' : 'failed';
    if (ok) job.textDone = true;
  }
  async function runJob(job) {
    if (!(await ready().catch(() => false))) { job.blocked = true; report({type: 'blocked', job}); return; }
    job.blocked = false;
    await runUploads(job);
    await runText(job);
    report({type: 'done', job, sent: job.sent.size, failed: job.failed.size, text: job.textState});
  }
  async function pump() {
    if (running) return running;
    running = (async () => {
      while (waiting.length) {
        const job = waiting.shift();
        try { await runJob(job); } catch (err) { report({type: 'done', job, sent: job.sent.size, failed: job.files.length - job.sent.size, text: job.textState, error: err?.message || ''}); }
      }
    })().finally(() => { running = null; });
    return running;
  }
  return {
    /** meeting: 놓은 사업 보고(그때 값). files: 올릴 파일. readFiles: 본문을 넣기로 한 결과 파일(없으면 []). */
    add(meeting, files, readFiles = []) {
      const job = {meeting, files: [...(files || [])], readFiles: [...(readFiles || [])], sent: new Set(), failed: new Map(), textDone: false, textState: readFiles?.length ? 'waiting' : 'none', blocked: false};
      waiting.push(job);
      report({type: 'queued', job, ahead: waiting.length - 1 + (running ? 1 : 0)});
      void pump();
      return job;
    },
    /** 실패한 단계만 다시(못 올린 파일·못 더한 본문). */
    retry(job) {
      if (!job || waiting.includes(job)) return false;
      if (!job.blocked && !job.failed.size && (job.textDone || job.textState === 'none')) return false;
      waiting.push(job);
      void pump();
      return true;
    },
    idle: () => running || Promise.resolve(),
    get size() { return waiting.length + (running ? 1 : 0); },
  };
}
