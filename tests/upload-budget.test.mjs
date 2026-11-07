// UPLOAD-올리기안됨(S52-13): 올리기 시간 한도는 한 곳(app/upload-budget.mjs)이고, 파일을 보내는 곳은 모두 그 값을 쓴다.
// 불러오기 기본 한도(runtime-client.js config.timeoutMs 15초)로 파일을 보내는 곳이 없어야 한다(폰 큰 사진은 보내는 도중 끊김).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uploadTimeoutMs, UPLOAD_BASE_MS, UPLOAD_MAX_MS} from '../app/upload-budget.mjs';

const read = name => readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8');

test('올리기 한도: 크기에 맞게 늘고 10분에서 멈춘다(불러오기 15초보다 늘 길다)', () => {
  assert.equal(uploadTimeoutMs(0), UPLOAD_BASE_MS);
  assert.equal(uploadTimeoutMs(undefined), UPLOAD_BASE_MS);
  assert.equal(uploadTimeoutMs(-5), UPLOAD_BASE_MS);
  assert.equal(uploadTimeoutMs(1), 94000);
  assert.equal(uploadTimeoutMs(12 * 1048576), 90000 + 12 * 4000);
  assert.equal(uploadTimeoutMs(100 * 1048576), 490000);
  assert.equal(uploadTimeoutMs(10 * 1024 * 1048576), UPLOAD_MAX_MS);
  assert.ok(uploadTimeoutMs(0) > 15000);
});

test('파일을 보내는 곳은 모두 공용 올리기 한도를 쓴다(손으로 쓴 같은 식이 남아 있지 않다)', () => {
  for (const name of ['basket-upload.js', 'library-upload.js', 'task-files.js', 'meeting-from-files.js']) {
    const src = read(name);
    assert.match(src, /from '\.\/upload-budget\.mjs'/, `${name}: upload-budget.mjs를 불러야 한다`);
    assert.match(src, /uploadTimeoutMs\(/, `${name}: uploadTimeoutMs를 써야 한다`);
    assert.doesNotMatch(src, /90000\s*\+\s*Math\.ceil/, `${name}: 같은 식을 따로 두지 않는다`);
  }
});

test('공용 보내기(sendUploadApi)로 파일을 보내는 곳은 timeoutMs(올리기 한도)를 함께 준다', () => {
  // UI-올리기진행표시 ②: 할 일 첨부·회의 파일은 runtime api(fetch) 대신 실제 보낸 양을 아는 sendUploadApi로 보낸다(합치지 않는 한 번 요청).
  // 노트·일기·업데이트·담당조직 기록(basket-upload.js)과 자료실(library-upload.js)은 sendUpload + 올리기 한도라 여기 해당하지 않는다.
  const calls = [
    ['meeting-from-files.js', /sendUploadApi\(rt\(\),'\/functions\/v1\/meeting-files',\{[^}]*\}/],
    ['task-files.js', /sendUploadApi\(rt, endpoint\('attach'\), \{[^}]*\}/],
  ];
  for (const [name, pattern] of calls) {
    const hit = read(name).match(pattern);
    assert.ok(hit, `${name}: 올리기 호출을 찾지 못함`);
    assert.match(hit[0], /timeoutMs:\s*uploadTimeoutMs\(/, `${name}: 올리기 호출에 timeoutMs: uploadTimeoutMs(...)`);
  }
});
