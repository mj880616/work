import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.cwd());
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('민자철도 메인은 조직 현황 스크립트를 로드한다',()=>{
  const html=read('private-rail/index.html');
  assert.match(html,/org-data\.js/);
  assert.match(html,/org-status\.js/);
});

test('조직 데이터는 8개 조직을 정의한다',()=>{
  const src=read('private-rail/org-data.js');
  for(const name of ['공항철도지부','서해선지부','메트로9호선노조','서울교통공사9호선지부','김포도시철도지부','신분당선지부','GTX-A운영지부','용인경전철지부']) assert.ok(src.includes(name),name);
});

test('메인 조직 카드에서 상세 페이지와 수정 기능을 제공한다',()=>{
  const src=read('private-rail/org-status.js');
  assert.match(src,/조직별 현재 상황/);
  assert.match(src,/org\.html\?org=/);
  assert.match(src,/data-org-edit/);
  assert.match(src,/rail_org_/);
});

test('조직 상세 페이지는 주간 업데이트 저장과 수정 삭제를 제공한다',()=>{
  const html=read('private-rail/org.html');
  assert.match(html,/주간 업데이트/);
  assert.match(html,/history/);
  assert.match(html,/action.*save/i);
  assert.match(html,/수정/);
  assert.match(html,/삭제/);
});
