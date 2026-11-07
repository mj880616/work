// S52-11 CAL-폰달력핀치: 두 손가락 칸 키우기 배율 계산(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import {clampZoom,pinchZoom,releaseZoom,fontScale,focalScroll,ZOOM_MIN,ZOOM_MAX,ZOOM_BACK_MS} from '../app/calendar-pinch-model.mjs';

test('배율은 1~2.5 사이(최대 약 2.5배)',()=>{
  assert.equal(ZOOM_MIN,1);assert.equal(ZOOM_MAX,2.5);
  assert.equal(clampZoom(0.4),1);assert.equal(clampZoom(9),2.5);assert.equal(clampZoom('x'),1);assert.equal(clampZoom(1.7),1.7);
});
test('벌린 만큼 이어서 커지고, 떨림은 무시',()=>{
  assert.equal(pinchZoom(1,100,102),null);
  assert.equal(pinchZoom(1,100,150),1.5);
  assert.equal(pinchZoom(1.5,100,200),2.5);
  assert.equal(pinchZoom(2,100,25),1);
  assert.equal(pinchZoom(1,0,50),null);
});
test('손을 떼면: 오므린 손짓·거의 처음 크기는 처음 크기, 벌린 손짓은 그대로',()=>{
  assert.equal(releaseZoom(1,1.8),1.8);
  assert.equal(releaseZoom(1,1.05),1);
  assert.equal(releaseZoom(2,1.6),1);
  assert.equal(releaseZoom(1.6,1.6),1.6);
  assert.equal(ZOOM_BACK_MS,200);
});
test('글자는 칸보다 덜 커진다',()=>{
  assert.equal(fontScale(1),1);
  assert.ok(Math.abs(fontScale(2.5)-1.525)<1e-9);
  assert.ok(fontScale(2)<2);
});
test('손가락 가운데 아래 자리가 그대로 있게 스크롤을 옮긴다',()=>{
  // 400px 칸, 손가락 가운데 200px, 내용 400 → 800: 가운데(400)가 그대로 200px 자리에 오려면 스크롤 200.
  assert.equal(focalScroll(0,200,400,800,400),200);
  assert.equal(focalScroll(0,0,400,800,400),0);
  assert.equal(focalScroll(300,100,800,400,400),0); // 줄면 끝을 넘지 않음
  assert.equal(focalScroll(0,390,400,1000,400),585);
  assert.equal(focalScroll(0,400,400,1000,400),600); // 끝(1000-400)을 넘지 않음
  assert.equal(focalScroll(5,10,0,100),5);
});
