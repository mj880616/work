// S69-98 NOTE-에버노트 ⑥ 문서 스캔(사용자 11/25 "좋아 모두 다 넣어!"): 노트 [넣기] → [문서 스캔].
// 폰은 카메라로 종이를 찍고(PC는 사진 고르기) → 이 창에서 네 모서리를 종이 끝에 맞춘다(끌기, 또는 모서리에 초점을 두고 화살표 키) →
// [넣기]를 누르면 반듯하게 펴고(원근 펴기) [밝게]가 켜져 있으면 밝기를 고른 JPEG 한 장을 돌려준다. 그 사진은 노트의 기존 [사진] 길로
// 비공개 노트 첨부에 올라가고, 올라간 뒤 글자 읽기(④)가 뒤따른다. 계산은 doc-scan-model.mjs.
// - 다시 그린 사진이라 찍은 곳(EXIF 위치 등) 정보는 남지 않는다. 기기에 저장하지 않는다(메모리에서만 그리고 버림).
// - 창 틀·뒤로가기·Esc·초점은 공용 작은 창(small-form-modal.js). 닫으면 null.
import {openFormModal} from './small-form-modal.js';
import {partStyles} from './part-styles.js';
import {defaultCorners, clampPoint, isConvexQuad, outputSize, warp, levels, fitScale, scanName, JPEG_QUALITY} from './doc-scan-model.mjs';

await partStyles('doc-scan');
const NAMES = ['왼쪽 위', '오른쪽 위', '오른쪽 아래', '왼쪽 아래'];
const READ_MAX = 3200; // 펴기 전에 읽는 원본의 긴 변 상한(폰 사진 4000px+를 줄여 메모리·시간을 아낀다)

async function decode(file) {
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
  const k = Math.min(1, READ_MAX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * k)), height = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas;
}
const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('blob'))), type, quality));

/** 찍은(고른) 사진 한 장 → 펴진 JPEG File, 닫으면 null. */
export async function openDocScan(file, {trigger = document.activeElement} = {}) {
  let source;
  try { source = await decode(file); } catch { return {error: '사진을 읽지 못했어요. 다른 사진으로 해 주세요.'}; }
  const W = source.width, H = source.height;
  let quad = defaultCorners(W, H), scale = 1, done = false, finish;
  const result = new Promise(resolve => { finish = value => { if (!done) { done = true; resolve(value); } }; });
  let stage, view, outline, handles = [], bright;
  const paint = () => {
    if (!view) return;
    outline.setAttribute('points', quad.map(p => `${p.x * scale},${p.y * scale}`).join(' '));
    quad.forEach((p, i) => { handles[i].style.left = p.x * scale + 'px'; handles[i].style.top = p.y * scale + 'px'; });
    stage.classList.toggle('is-bad', !isConvexQuad(quad));
  };
  const layout = () => {
    if (!stage?.isConnected) return;
    const box = stage.parentElement.getBoundingClientRect();
    const room = Math.max(160, Math.min(window.innerHeight * 0.62, 640));
    scale = fitScale(W, H, Math.max(120, box.width), room);
    view.width = Math.round(W * scale); view.height = Math.round(H * scale);
    stage.style.width = view.width + 'px'; stage.style.height = view.height + 'px';
    const svg = outline.ownerSVGElement; svg.setAttribute('width', view.width); svg.setAttribute('height', view.height);
    view.getContext('2d').drawImage(source, 0, 0, view.width, view.height);
    paint();
  };
  const ui = openFormModal({
    id: 'docScanModal', title: '문서 스캔', okLabel: '넣기', className: 'dscan', trigger,
    foot: '모서리 네 개를 종이 끝에 맞춰 주세요. 반듯하게 펴서 사진으로 넣고, 글자도 읽어 둬요.',
    fill(body) {
      body.innerHTML = `<div class="dscan-wrap"><div class="dscan-stage" data-dscan-stage><canvas class="dscan-view" data-dscan-view aria-hidden="true"></canvas>
<svg class="dscan-lines" aria-hidden="true"><polygon data-dscan-outline></polygon></svg>
${NAMES.map((n, i) => `<button type="button" class="icon-btn dscan-dot" data-dscan-dot="${i}" aria-label="${n} 모서리 (화살표 키로 옮기기)"></button>`).join('')}</div></div>
<label class="dscan-bright"><input type="checkbox" data-dscan-bright checked> 밝게 보정</label>`;
      stage = body.querySelector('[data-dscan-stage]'); view = body.querySelector('[data-dscan-view]'); outline = body.querySelector('[data-dscan-outline]');
      handles = [...body.querySelectorAll('[data-dscan-dot]')]; bright = body.querySelector('[data-dscan-bright]');
      return '[data-dscan-dot="0"]';
    },
    async onSubmit() {
      if (!isConvexQuad(quad)) return '모서리가 꼬였어요. 네 모서리를 종이 끝에 차례로 맞춰 주세요.';
      try {
        const size = outputSize(quad);
        const data = source.getContext('2d').getImageData(0, 0, W, H);
        const flat = warp({width: W, height: H, data: data.data}, quad, size);
        if (!flat) return '모서리가 꼬였어요. 네 모서리를 종이 끝에 차례로 맞춰 주세요.';
        if (bright.checked) levels(flat.data);
        const out = document.createElement('canvas'); out.width = flat.width; out.height = flat.height;
        out.getContext('2d').putImageData(new ImageData(flat.data, flat.width, flat.height), 0, 0);
        const blob = await toBlob(out, 'image/jpeg', JPEG_QUALITY);
        finish(new File([blob], scanName(), {type: 'image/jpeg'}));
        return true;
      } catch { return '펴지 못했어요. 다시 해 주세요.'; }
    },
  });
  // 끌기: 모서리 점을 누른 채 옮기면 그 모서리가 따라온다(손가락·마우스·펜 같은 길).
  let drag = null;
  const at = e => { const r = stage.getBoundingClientRect(); return {x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale}; };
  stage.addEventListener('pointerdown', e => {
    const dot = e.target.closest?.('[data-dscan-dot]');
    if (!dot) return;
    e.preventDefault(); drag = Number(dot.dataset.dscanDot); dot.setPointerCapture?.(e.pointerId); dot.focus({preventScroll: true});
  });
  stage.addEventListener('pointermove', e => { if (drag === null) return; quad[drag] = clampPoint(at(e), W, H); paint(); });
  const stop = () => { drag = null; };
  stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', stop);
  // 키보드: 모서리에 초점 → 화살표(1%) · Shift+화살표(5%).
  stage.addEventListener('keydown', e => {
    const dot = e.target.closest?.('[data-dscan-dot]');
    const d = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
    if (!dot || !d) return;
    e.preventDefault();
    const i = Number(dot.dataset.dscanDot), step = Math.max(W, H) * (e.shiftKey ? 0.05 : 0.01);
    quad[i] = clampPoint({x: quad[i].x + d[0] * step, y: quad[i].y + d[1] * step}, W, H); paint();
  });
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  // 닫힘(✕·취소·뒤로가기·Esc): 공용 창이 숨기고 지운다 → null.
  const gone = new MutationObserver(() => { if (!ui.modal.isConnected || ui.modal.classList.contains('hidden')) { gone.disconnect(); window.removeEventListener('resize', onResize); finish(null); } });
  gone.observe(ui.modal, {attributes: true, attributeFilter: ['class']});
  requestAnimationFrame(layout);
  const value = await result;
  source.width = source.height = 0; // 메모리에서 버림
  return value;
}
