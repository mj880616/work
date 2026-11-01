// S47-32 PHOTO-비슷한사진: 작은 미리보기 그림 → 64비트 지각 해시(dHash). 기기에서만 계산하고 결과는 부른 곳 메모리에만 둔다.
// 그림은 화면이 이미 받는 작은 미리보기 주소(폰 앱 __phone/…/thumb ?s=small, 앱이 폰 사진첩에서 답함)만 쓴다. 원본은 받지 않는다.
// 9×8 캔버스 하나를 다시 쓴다. 못 읽으면 ''(그 사진은 묶지 않음).
import {dHashHex, grayOf, HASH_W, HASH_H} from './photo-tidy-model.mjs';

const WAIT_MS = 15000;
export function createThumbHasher(doc = globalThis.document) {
  let ctx = null;
  const canvasCtx = () => {
    if (ctx) return ctx;
    const c = doc.createElement('canvas');
    c.width = HASH_W; c.height = HASH_H;
    ctx = c.getContext('2d', {willReadFrequently:true});
    return ctx;
  };
  return function hash(url) {
    if (!url) return Promise.resolve('');
    return new Promise(done => {
      const img = new Image();
      let timer = 0;
      const end = v => { clearTimeout(timer); img.onload = img.onerror = null; img.src = ''; done(v); };
      timer = setTimeout(() => end(''), WAIT_MS);
      img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => end('');
      img.onload = () => {
        try {
          const c = canvasCtx();
          if (!c) return end('');
          c.clearRect(0, 0, HASH_W, HASH_H);
          c.drawImage(img, 0, 0, HASH_W, HASH_H);
          end(dHashHex(grayOf(c.getImageData(0, 0, HASH_W, HASH_H).data)));
        } catch { end(''); }
      };
      img.src = url;
    });
  };
}
