import test from 'node:test';
import assert from 'node:assert/strict';
import {fitShares,moveBoundary,encodeTriple,decodeTriple} from '../app/split-resize.js';
// MTG-3칸폭끌기(2026-10-26): 공용 칸 폭 부품(app/split-resize.js)이 경계 여러 개를 다루는 계산. 두 칸은 예전과 같은 결과여야 한다.
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b}`);
const nearAll=(a,b,eps)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>near(v,b[i],eps))};

test('fitShares: 최소 폭 안이면 저장 비율 그대로, 합은 1',()=>{
  nearAll(fitShares([1/3,2/3],[0.2,0.3]),[1/3,2/3]);
  nearAll(fitShares([1/6,1/6,2/3],[0.1,0.1,0.3]),[1/6,1/6,2/3]);
});
test('fitShares: 두 칸은 왼쪽 최소·오른쪽 최소 사이로만 그린다(예전 clamp와 같음)',()=>{
  nearAll(fitShares([0.1,0.9],[0.25,0.4]),[0.25,0.75]);
  nearAll(fitShares([0.9,0.1],[0.25,0.4]),[0.6,0.4]);
});
test('fitShares: 최소보다 좁은 칸은 최소로 고정하고 나머지가 남은 폭을 저장 비율대로 나눈다',()=>{
  const s=fitShares([0.05,0.25,0.7],[0.15,0.15,0.3]);
  near(s[0],0.15);near(s[1]/s[2],0.25/0.7,1e-6);near(s[0]+s[1]+s[2],1);
  const t=fitShares([0.02,0.02,0.96],[0.2,0.2,0.3]);
  nearAll(t,[0.2,0.2,0.6]);
});
test('fitShares: 최소 폭 합이 폭보다 크면 최소 폭 비율로 나눈다',()=>{
  const s=fitShares([0.3,0.3,0.4],[0.5,0.5,0.5]);
  nearAll(s,[1/3,1/3,1/3]);
});
test('moveBoundary: 경계는 이웃 두 칸만 움직이고 나머지 칸 폭은 그대로',()=>{
  const base=[1/6,1/6,2/3],mins=[0.1,0.1,0.3];
  const a=moveBoundary(base,mins,0,0.2);nearAll(a,[0.2,1/3-0.2,2/3]);
  const b=moveBoundary(base,mins,1,0.5);nearAll(b,[1/6,0.5-1/6,0.5]);
});
test('moveBoundary: 이웃 칸의 최소 폭 밑으로는 못 간다(맨 왼쪽·맨 오른쪽 끝까지 끌어도)',()=>{
  const base=[1/6,1/6,2/3],mins=[0.1,0.1,0.3];
  nearAll(moveBoundary(base,mins,0,-5),[0.1,1/3-0.1,2/3]);
  nearAll(moveBoundary(base,mins,0,5),[1/3-0.1,0.1,2/3]);
  nearAll(moveBoundary(base,mins,1,5),[1/6,1-1/6-0.3,0.3]);
  nearAll(moveBoundary(base,mins,1,-5),[1/6,0.1,1-1/6-0.1]);
});
test('moveBoundary: 두 칸 합이 최소 폭 합보다 좁으면 움직이지 않는다',()=>{
  nearAll(moveBoundary([0.05,0.05,0.9],[0.1,0.1,0.3],0,0.07),[0.05,0.05,0.9]);
});
test('세 칸 저장값: 서버가 받는 0 초과 1 미만 숫자 하나에 두 경계가 들어갔다 나온다',()=>{
  const d=[1/6,1/6,2/3];
  for(const shares of [[0.12,0.2,0.68],[0.3,0.1,0.6],[1/6,1/6,2/3],[0.05,0.25,0.7],[0.4,0.35,0.25]]){
    const v=encodeTriple(shares);
    assert.ok(v>0&&v<1,`${v}`);
    const back=decodeTriple(v,d);
    back.forEach((x,i)=>near(x,shares[i],0.002));near(back[0]+back[1]+back[2],1);
  }
});
test('세 칸 저장값: 두 칸 화면이 남긴 4자리 비율은 왼쪽 몫만 따르고 첫 칸 몫은 기본으로 읽는다',()=>{
  const d=[1/6,1/6,2/3];
  for(const plain of [0.4123,0.5,0.25,0.3333]){
    const s=decodeTriple(plain,d);
    near(s[0]+s[1],plain,0.001);near(s[0]/(s[0]+s[1]),0.5,1e-9);
  }
});
test('세 칸 저장값: 숫자가 아니거나 범위 밖이면 기본(null)',()=>{
  for(const bad of [0,1,-0.2,NaN,undefined,'x'])assert.equal(decodeTriple(bad,[1/6,1/6,2/3]),null);
});
test('세 칸 저장값: 첫 칸 몫이 100의 배수 천분율이어도 "저장 안 함"으로 읽히지 않는다',()=>{
  const d=[1/6,1/6,2/3];
  for(const k of [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9]){
    const back=decodeTriple(encodeTriple([0.4*k,0.4*(1-k),0.6]),d);
    near(back[0]/(back[0]+back[1]),k,0.002);
  }
});
