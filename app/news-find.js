import {findWords, FIND_WAIT_MS} from './news-find-model.mjs';
// S63-11 NEWS-서버찾기: [전체](outside-statements.js)·[언론](news-clipping.js) 위 찾기 칸의 서버 찾기 한 벌(그리기 없음 — 그리기는 각 칸 주인).
// 말이 바뀌면 FIND_WAIT_MS 뒤에 한 번(Enter는 바로) run(words)을 부르고, 늦게 온 옛 답은 버린다. 결과는 화면 메모리에만(기기 저장 없음).
// 상태: {query, busy, failed, short(너무 짧음), done, result}. changed()는 상태가 바뀔 때마다 — 칸 주인이 자기 목록만 다시 그린다.
const blank = () => ({query: '', busy: false, failed: false, short: false, done: false, result: null});
export function createFind({run, changed}) {
  let st = blank(), seq = 0, timer = 0;
  function set(raw, {now = false} = {}) {
    const query = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (query === st.query && !now) return;
    clearTimeout(timer);
    const words = query ? findWords(query) : null, my = ++seq;
    st = {...blank(), query, busy: !!words, short: !!query && !words};
    changed();
    if (!words) return;
    timer = setTimeout(async () => {
      let result = null, failed = false;
      try { result = await run(words); } catch { failed = true; }
      if (my !== seq) return;
      st = {...st, busy: false, failed, done: !failed, result};
      changed();
    }, now ? 0 : FIND_WAIT_MS);
  }
  return {
    set,
    get: () => st,
    active: () => !!st.query,
    again: () => set(st.query, {now: true}),
    reset: () => { clearTimeout(timer); seq++; st = blank(); },
  };
}
