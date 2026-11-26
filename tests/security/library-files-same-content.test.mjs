import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SC from '../../supabase/functions/library-files/same-content.mjs';
const { hashKey, fileKey, hashable, lookupKeys, SameFail } = SC;

// S69-45 같은 내용 판정(md5 + 크기). S70-29에서 [같은 내용 자료 정리], S70-73에서 [드라이브에서 가져오기]를 지웠고,
// 남은 쓰는 곳은 드라이브 자동 등록(drive-auto.mjs) 하나다. 가짜 데이터만(네트워크·운영 DB 없음).
const M1 = 'a'.repeat(32);
const fid = s => (s + '__________').slice(0, 12);

test('hashKey·fileKey·hashable: md5 32자 + 양의 크기만, 휴지통·링크형은 비교 안 함', () => {
  assert.equal(hashKey(M1, '100'), `${M1}:100`);
  assert.equal(hashKey(M1, 0), null);
  assert.equal(hashKey('xyz', 10), null);
  assert.equal(hashKey(undefined, 10), null);
  assert.equal(fileKey({ md5Checksum: M1, size: '5' }), `${M1}:5`);
  assert.equal(fileKey({ md5Checksum: M1, size: '5', trashed: true }), null);
  assert.equal(hashable({ file_id: fid('a'), mime_type: 'application/pdf' }), true);
  assert.equal(hashable({ file_id: fid('a'), mime_type: 'application/vnd.google-apps.document' }), false);
  assert.equal(hashable({ file_id: null }), false);
});

test('lookupKeys: 메타데이터만 묻고(내용 안 엶), 404는 열쇠 없음, 401·403은 멈춤, 한도 넘으면 partial', async () => {
  const seen = [];
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  const fetch = async url => { seen.push(String(url)); const id = decodeURIComponent(String(url).match(/files\/([^?]+)/)[1]); return id === fid('gone') ? json({}, 404) : json({ id, md5Checksum: M1, size: '9' }); };
  const r = await lookupKeys([fid('a'), fid('gone'), fid('a'), 'bad id'], { fetch, token: 't', max: 5 });
  assert.equal(r.keys.get(fid('a')), `${M1}:9`); assert.equal(r.keys.get(fid('gone')), null); assert.equal(r.partial, false);
  assert.ok(seen.every(u => u.includes('fields=id,md5Checksum,size,trashed')));
  assert.equal((await lookupKeys([fid('x'), fid('y')], { fetch, token: 't', max: 1 })).partial, true);
  await assert.rejects(lookupKeys([fid('a')], { fetch: async () => json({}, 401), token: 't' }), e => e instanceof SameFail && e.code === 'drive_auth_expired');
});

test('지운 갈래·부품이 없다(같은 내용 정리·드라이브에서 가져오기)', () => {
  for (const name of ['createSameContent', 'parseSameRequest', 'planSameContent', 'folderInfo', 'markSame', 'SAME_FOLDER_PREFIX']) assert.equal(SC[name], undefined, name);
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /same-content-|createSameContent|parseSameRequest|top-files-|createTopFiles|parseTopFilesRequest|drive-import|createDriveImport/);
  assert.match(src, /if\(input\?\.action!=='previous-keep'\)throw new UploadError\('지원하지 않는 작업입니다\.'/, '지운 요청은 지원하지 않는 작업으로 거절');
});
