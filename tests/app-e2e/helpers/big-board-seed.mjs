// S71-52 NOTE-큰생각지도: 큰 시험 보드(가짜 글) — 주제 1,000개(뿌리 8개 · 넓게 퍼진 4단계 가지)와 선 1,000개.
// 같은 씨앗이면 늘 같은 보드(시험·잰 값이 실행마다 같게). 글은 지어낸 낱말 조합.
const WORDS = ['계획', '정리', '생각', '모임', '자료', '흐름', '질문', '목표', '방법', '기록', '확인', '다음', '연결', '갈래', '묶음', '주제'];
const uid = (k, n) => `00000000-0000-4000-${k}000-${String(n).padStart(12, '0')}`; // 서버 id 모양(uuid)
const rng = seed => () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
export function bigBoardSeed({ bid, topics = 1000, lines = 1000, roots = 8, spread = 5000, seed = 7, origin = { x: 3000, y: 3000 } } = {}) {
  const r = rng(seed), texts = [], word = () => WORDS[Math.floor(r() * WORDS.length)];
  const add = (parent, depth, ord, x = 0, y = 0) => {
    const t = { id: uid(8, texts.length + 1), board_id: bid, body: `${word()} ${word()} ${texts.length + 1}`, parent_id: parent?.id ?? null, ord, side: depth === 1 ? (ord % 2 ? 'left' : 'right') : null,
      font: depth === 0 ? 4 : depth === 1 ? 3 : 2, x, y, depth };
    texts.push(t); return t;
  };
  const queue = [];
  for (let i = 0; i < roots; i++) queue.push(add(null, 0, 0, origin.x + (i % 4) * spread, origin.y + Math.floor(i / 4) * spread));
  const fan = [6, 5, 4, 3];
  while (queue.length && texts.length < topics) {
    const n = queue.shift();
    for (let i = 0; i < (fan[n.depth] || 0) && texts.length < topics; i++) queue.push(add(n, n.depth + 1, i));
  }
  const ids = texts.map(t => t.id), links = [];
  for (let i = 0; links.length < lines && i < lines * 4; i++) {
    const a = ids[Math.floor(r() * ids.length)], b = ids[Math.floor(r() * ids.length)];
    if (a !== b) links.push({ id: uid(9, links.length + 1), board_id: bid, from_text: a, to_text: b, shape: 'line', dash: 'solid', ends: 'end' });
  }
  return { texts: texts.map(({ depth, ...t }) => t), links };
}

// 판 좌표 (bx, by)를 화면 가운데로(휠 = 판 이동, 화면 px 그대로).
export async function centerBoardPoint(page, bx, by) {
  const d = await page.evaluate(([bx, by]) => {
    const s = document.querySelector('[data-note-board] [data-nb-scroll]').getBoundingClientRect(), m = document.querySelector('[data-nb-board]').style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([\d.]+)\)/);
    return { x: Number(m[1]) + bx * Number(m[3]) - s.width / 2, y: Number(m[2]) + by * Number(m[3]) - s.height / 2 };
  }, [bx, by]);
  // 휠 한 번에 너무 크게 보내면 브라우저가 잘라 내므로 나눠 보낸다.
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(d.x), Math.abs(d.y)) / 400));
  for (let i = 0; i < n; i++) await page.mouse.wheel(d.x / n, d.y / n);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
