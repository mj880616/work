// UI-칩줄두줄(2026-10-31 명진 결정, 요청함 11:14): 앱 전체 칩 줄의 공용 부품 하나.
// 칩 줄은 폰·PC 모두 줄바꿈으로 두 줄까지만 보이고, 넘치면 끝에 작은 [더보기 ▾] → 누르면 전부, [접기 ▴]로 다시 두 줄.
// 옆으로 미는 칩 줄(가로 스크롤·끝 흐림)은 없앴다. 고른 칩(keep)은 접혀 있어도 늘 보이며, 숨는 칩 자리를 건너 앞쪽에 붙는다.
// 펼침은 기기에 저장하지 않는다: 열어 둔 동안만 메모리에 두고, 화면을 옮기면(kptu:view-changed) 모두 두 줄로 돌아간다.
// 숨는 칩은 data-chip-cut 하나로만 표시하고 모양은 ui-standard.css "UI-칩줄두줄" 한 묶음이 그린다(칩의 hidden은 부른 쪽 몫이라 건드리지 않음).
import {lineCount} from './chip-rows-model.mjs';

export const CHIP_ROWS = 2;
const opened = new Map(); // 펼친 줄: key(부른 쪽 이름) 또는 줄 요소 → true
let resize = null;
const widths = new WeakMap();
const hosts = new Set(); // 글꼴을 다 읽은 뒤 다시 잴 줄(끊긴 줄은 그때 뺀다)

const isShown = el => el.getClientRects().length > 0;
const boxes = els => els.filter(isShown).map(el => el.getBoundingClientRect());
const defaultKeep = el => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';

// host: 칩이 바로 안에 든 줄. keep(el): 접혀도 남길 칸(고른 칩·끝의 ⋯ 같은 줄 도구). key: 줄을 다시 만들어도 펼침을 이어 갈 이름.
// 칩을 다시 그릴 때마다 부른 쪽이 다시 부르고, 줄 폭이 바뀌면 저절로 다시 잰다.
export function fitChipRows(host, {keep = defaultKeep, key = null, rows = CHIP_ROWS} = {}) {
  if (!host) return;
  host.dataset.chipRows = '';
  host._chipRows = {keep, key, rows};
  if (hosts.size > 40) for (const h of hosts) if (!h.isConnected) hosts.delete(h);
  hosts.add(host);
  let toggle = host.querySelector(':scope > [data-chip-rows-more]');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'chip-rows-more'; toggle.dataset.chipRowsMore = '';
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const k = host._chipRows?.key || host;
      if (opened.get(k)) opened.delete(k); else opened.set(k, true);
      layout(host);
    });
  }
  if (host.lastElementChild !== toggle) host.append(toggle);
  if (typeof ResizeObserver === 'function') {
    resize ||= new ResizeObserver(entries => entries.forEach(entry => {
      const w = Math.round(entry.contentRect.width);
      if (widths.get(entry.target) !== w) { widths.set(entry.target, w); layout(entry.target); }
    }));
    resize.observe(host);
  }
  layout(host);
}

// 부른 쪽이 화면 첫 상태로 돌아갈 때(원장 [처음으로] 등) 그 줄의 펼침을 접는다. 다시 그릴 때 두 줄로 잰다.
export function foldChipRows(key) { if (key) opened.delete(key); }

// 고른 칩이 바뀌었을 때처럼 칩은 그대로이고 남길 칸만 바뀌면 다시 잰다.
export function refitChipRows(host) { if (host?._chipRows) layout(host); }

function layout(host) {
  const opts = host._chipRows, toggle = host.querySelector(':scope > [data-chip-rows-more]');
  if (!opts || !toggle) return;
  const items = [...host.children].filter(el => el !== toggle);
  for (const el of items) if (el.hasAttribute('data-chip-cut')) el.removeAttribute('data-chip-cut');
  toggle.hidden = true;
  // 숨은 화면(폭 0)은 재지 않는다. 보이게 되면 폭이 바뀌어 ResizeObserver가 다시 부른다.
  if (!host.isConnected || !host.clientWidth) return;
  const shown = items.filter(isShown);
  if (lineCount(boxes(shown)) <= opts.rows) return;
  const open = !!opened.get(opts.key || host);
  toggle.hidden = false;
  toggle.textContent = open ? '접기 ▴' : '더보기 ▾';
  toggle.setAttribute('aria-expanded', String(open));
  if (open) return;
  // 뒤에서부터 남기지 않아도 되는 칩을 하나씩 접어, [더보기]까지 두 줄 안에 들 때 멈춘다. 초점이 있는 칩은 남긴다.
  const active = document.activeElement;
  const cuttable = shown.filter(el => el !== active && !el.contains(active) && !opts.keep(el)).reverse();
  for (const el of cuttable) {
    if (lineCount(boxes([...shown, toggle])) <= opts.rows) break;
    el.setAttribute('data-chip-cut', '');
  }
}

// 화면을 옮기면 펼친 줄을 모두 두 줄로 되돌린다(펼침은 열어 둔 동안만).
if (typeof window !== 'undefined') window.addEventListener('kptu:view-changed', () => opened.clear());
// 글꼴이 늦게 들어오면 칩 폭이 바뀌므로 한 번 더 잰다.
try { document.fonts?.ready?.then?.(() => { for (const h of hosts) { if (h.isConnected) layout(h); else hosts.delete(h); } }); } catch { /* 다시 재는 것뿐 */ }
