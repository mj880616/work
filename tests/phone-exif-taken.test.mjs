import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// PHOTO-파일시각읽기(요청함 11/03 07:45): 폰 앱이 찍은 시각을 파일 EXIF에서 먼저 읽고, 바뀐 파일만 다시 읽는다. 규칙 본문은 JVM 시험(PhoneMediaRulesTest)이 고정한다.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('폰 앱 목록: 사진은 EXIF 시각을 먼저, 동영상은 사진첩 값, 기억은 고친 시각·크기가 바뀐 것만 다시 읽음', () => {
  const media = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMedia.kt');
  const rules = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMediaRules.kt');
  assert.match(media, /TAG_DATETIME_ORIGINAL/);
  assert.match(media, /TAG_OFFSET_TIME_ORIGINAL/);
  assert.match(media, /if \(video\) null else exifMs\(/, '동영상은 EXIF를 읽지 않음');
  assert.match(media, /PhoneMediaRules\.takenWithExif\(/);
  assert.match(media, /PhoneMediaRules\.exifStale\(memo, modifiedSec, size\)/);
  assert.match(rules, /fun exifTakenMs\(/);
  assert.match(rules, /EXIF_DEFAULT_ZONE: ZoneId = ZoneId\.of\("Asia\/Seoul"\)/, '시간대 칸이 없으면 한국 시각');
  assert.doesNotMatch(media, /Log\.[a-z]\([^)]*(exif|taken)Ms/i, '시각은 로그에 쓰지 않음');
});

test('앱 판: 0.5.0 이상(versionCode 57 이상)', () => {
  const gradle = read('android-app/app/build.gradle');
  assert.match(gradle, /versionName '0\.(?:[5-9]|[1-9][0-9])\.\d+'/);
  assert.ok(Number(gradle.match(/versionCode (\d+)/)?.[1]) >= 57);
});

test('S53-3 PHOTO-폰불러오기느림: 목록 읽기는 EXIF 파일 열기를 잠깐만, 나머지는 뒤에서 읽고 목록 기억을 비운다(앱 0.5.4+)', () => {
  const media = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMedia.kt');
  assert.match(media, /private const val EXIF_INLINE_MS = 300L/);
  assert.match(media, /if \(SystemClock\.elapsedRealtime\(\) >= until\) \{\n\s+later\[id\] = /, '시간이 지나면 사진첩 값으로 먼저 답하고 뒤로 미룸');
  assert.match(media, /exifLater\(context, later\)\n\s+return out/, '목록을 돌려주기 전에 뒤 읽기를 맡김');
  assert.match(media, /newSingleThreadExecutor/, '뒤 읽기는 한 줄 일꾼(목록 잠금 밖)');
  assert.match(media, /if \(changed\) forget\(\)/, '다 읽으면 목록 기억을 비워 다음 읽기가 EXIF 시각');
  const gradle = read('android-app/app/build.gradle');
  assert.ok(Number(gradle.match(/versionCode (\d+)/)?.[1]) >= 61);
});
