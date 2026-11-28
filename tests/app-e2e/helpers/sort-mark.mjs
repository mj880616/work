// LIST-정렬꺾쇠(사용자 결정 2026-11-28 시안 A) 공용 시험 도구: 머리 줄(head-sort.mjs headCellHtml + col-resize.js gripHtml)을 잰다.
// 꺾쇠 = SVG(글자 기호 아님), 칸 이름 글자와 세로 가운데 차이, 칸 이름 글자색·굵기, 너비 금(::before)의 보이기 정도.
import { expect } from '@playwright/test';

export const headLook = head => head.evaluate(h => {
  const out = [];
  for (const c of h.querySelectorAll('[role="columnheader"]')) {
    const btn = c.querySelector('.hs-btn'); if (!btn) continue;
    const text = [...btn.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    const range = document.createRange(); if (text) range.selectNodeContents(text);
    const tr = text ? range.getBoundingClientRect() : null, svg = btn.querySelector('svg.hs-mark'), sr = svg?.getBoundingClientRect();
    const st = getComputedStyle(btn), grip = c.querySelector(':scope > .col-grip');
    out.push({
      key: btn.dataset.headSort, on: c.classList.contains('hs-on'), sort: c.getAttribute('aria-sort'),
      glyph: /[▼▲▽△]/.test(btn.textContent), mark: svg ? svg.dataset.sortMark : null,
      mid: tr && sr ? (sr.top + sr.height / 2) - (tr.top + tr.height / 2) : null,
      gap: tr && sr ? sr.left - tr.right : null, markW: sr?.width ?? null,
      color: st.color, weight: Number(st.fontWeight),
      grip: grip ? Number(getComputedStyle(grip, '::before').opacity) : null,
    });
  }
  return out;
});

// 공통 판정: 정렬 중인 칸 하나만 꺾쇠(SVG)·진한 글자, 꺾쇠는 칸 이름과 세로 가운데 ±1px, 간격 2~6px, 크기 약 10px. 나머지는 꺾쇠 없음·흐린 글자.
export async function expectSortMark(head, { key, dir, why = '' }) {
  const look = await headLook(head);
  const on = look.filter(c => c.on);
  expect(on.map(c => c.key), `${why} 정렬 칸`).toEqual([key]);
  for (const c of look) {
    expect(c.glyph, `${why} ${c.key}: ▼▲ 글자 기호 없음`).toBe(false);
    if (c.on) {
      expect(c.mark, `${why} ${c.key}: 꺾쇠 방향`).toBe(dir);
      expect(Math.abs(c.mid), `${why} ${c.key}: 꺾쇠·칸 이름 세로 가운데 차이`).toBeLessThanOrEqual(1);
      expect(c.gap, `${why} ${c.key}: 칸 이름과 꺾쇠 간격`).toBeGreaterThanOrEqual(2); expect(c.gap).toBeLessThanOrEqual(6);
      expect(Math.abs(c.markW - 10), `${why} ${c.key}: 꺾쇠 크기`).toBeLessThanOrEqual(3);
    } else expect(c.mark, `${why} ${c.key}: 정렬 안 하는 칸은 꺾쇠 없음`).toBeNull();
  }
  const cur = look.find(c => c.on), others = look.filter(c => !c.on);
  for (const c of others) {
    expect(c.weight, `${why} ${c.key}: 흐린 칸은 보통 굵기`).toBeLessThan(cur.weight);
    expect(c.color, `${why} ${c.key}: 흐린 칸 글자색은 정렬 칸과 다름`).not.toBe(cur.color);
  }
  return look;
}

// 너비 금: 평소 안 보임(opacity 0) → 머리 줄에 마우스를 올리면 보임(1). 터치 화면은 늘 보임.
export const gripOpacities = head => head.evaluate(h => [...h.querySelectorAll('[role="columnheader"] > .col-grip')].map(g => Number(getComputedStyle(g, '::before').opacity)));
