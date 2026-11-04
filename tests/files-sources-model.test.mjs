import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFlags, toggleFlag, SOURCES_OFF_TEXT} from '../app/source-flags.mjs';
import {parseSources, toggleSource, sourcesValue} from '../app/photo-sources-model.mjs';
import {FILES_SOURCES_KEY, FILES_SRC, parseFilesSources, filesSourcesValue, toggleFilesSource, visibleSources, chipInfo, FILES_DEVICES, filesDeviceKind, PHONE_WIDTH_QUERY} from '../app/files-sources-model.mjs';
import {KEYS, validValue, parsePrefs, applyChanges, createViewPrefs} from '../app/view-prefs.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// FILES-출처켜고끄기(S49-21): 켜기/끄기 규칙은 사진 화면과 공용(source-flags.mjs). 화면 없이 규칙만 본다.

test('공용 규칙: 모양이 틀린 칸은 기본값, 하나만 뒤집고 모르는 이름은 그대로', () => {
  const names = ['a', 'b'], def = {a: true, b: false};
  assert.deepEqual(parseFlags(null, names, def), {a: true, b: false});
  assert.deepEqual(parseFlags({a: 'x', b: true, c: true}, names, def), {a: true, b: true});
  assert.deepEqual(parseFlags([], names, def), {a: true, b: false});
  assert.deepEqual(toggleFlag({a: true}, names, def, 'a'), {a: false, b: false});
  assert.deepEqual(toggleFlag({a: true}, names, def, 'zzz'), {a: true, b: false});
  assert.equal(SOURCES_OFF_TEXT, '위 출처 아이콘을 켜 주세요');
});
test('사진 화면 규칙은 공용 규칙 위에서 그대로(기본값·뒤집기·값 모양)', () => {
  assert.deepEqual(parseSources(null), {onedrive: true, gdrive: false, phone: true});
  assert.deepEqual(toggleSource({onedrive: true, gdrive: false, phone: true}, 'gdrive'), {onedrive: true, gdrive: true, phone: true});
  assert.deepEqual(sourcesValue({gdrive: true}), {onedrive: true, gdrive: true, phone: true});
  assert.match(read('app/photo-sources-model.mjs'), /from '\.\/source-flags\.mjs'/);
  assert.match(read('app/files-sources-model.mjs'), /from '\.\/source-flags\.mjs'/);
});
test('[파일] 출처: 없으면 둘 다 켜짐, 끄면 연결돼 있어도 보기에서 빠짐, 연결 안 된 출처는 켜졌어도 안 보임', () => {
  assert.deepEqual(FILES_SRC, ['od', 'gd']);
  assert.deepEqual(parseFilesSources(undefined), {od: true, gd: true});
  assert.deepEqual(visibleSources(undefined, ['od', 'gd']), ['od', 'gd']);
  assert.deepEqual(visibleSources({od: true, gd: false}, ['od', 'gd']), ['od']);
  assert.deepEqual(visibleSources({od: false, gd: false}, ['od', 'gd']), []);
  assert.deepEqual(visibleSources({od: true, gd: true}, ['od']), ['od']);
  assert.deepEqual(visibleSources({od: true, gd: true}, []), []);
  const next = toggleFilesSource({od: true}, 'gd');
  assert.deepEqual(filesSourcesValue(next), {od: true, gd: false});
  assert.deepEqual(toggleFilesSource(next, 'od'), {od: false, gd: false});
});
test('[파일] 아이콘 상태(눌림 = 연결됨 + 켜짐), 줄 거르기는 서버가', () => {
  assert.doesNotMatch(read('app/files-sources-model.mjs'), /export const filterBySource/);
  assert.deepEqual(chipInfo({gd: false}, ['od', 'gd'], 'gd'), {name: 'gd', on: false, linked: true, pressed: false});
  assert.deepEqual(chipInfo(null, ['od'], 'gd'), {name: 'gd', on: true, linked: false, pressed: false});
  assert.deepEqual(chipInfo(null, ['od', 'gd'], 'od'), {name: 'od', on: true, linked: true, pressed: true});
});
test('files_sources는 서버 칸(view_prefs): 기기 칸(app·phone·pc)마다 od·gd 참·거짓만, 그 밖은 그 기기 칸만 버림', () => {
  assert.equal(FILES_SOURCES_KEY, 'files_sources');
  assert.ok(KEYS.includes('files_sources'));
  for (const v of [{}, {app: {}}, {pc: {od: true}}, {phone: {gd: false}}, {app: {od: false, gd: true}, phone: {od: true}, pc: {gd: false}}]) assert.equal(validValue('files_sources', v), true, JSON.stringify(v));
  for (const v of [null, [], 'od', true, {od: true}, {od: false, gd: true}, {tablet: {od: true}}, {app: true}, {app: []}, {pc: {onedrive: true}}, {pc: {od: 'yes'}}, {pc: {od: 1}}, {pc: {ph: true}}, {pc: {od: null}}]) assert.equal(validValue('files_sources', v), false, JSON.stringify(v));
  assert.deepEqual(parsePrefs({files_sources: {pc: {od: false}}}), {files_sources: {pc: {od: false}}});
  assert.deepEqual(parsePrefs({files_sources: {pc: {od: 'x'}, app: {gd: false}}}), {files_sources: {app: {gd: false}}});
  assert.deepEqual(parsePrefs({files_sources: {od: false}}), {}, '옛 한 칸 모양은 읽지 않는다');
});
test('기기 종류: 폰 앱(KPTUAndroid) / 폰 브라우저(폭 760 이하) / PC, 공용 판별 그대로', () => {
  assert.deepEqual(FILES_DEVICES, ['app', 'phone', 'pc']);
  assert.equal(PHONE_WIDTH_QUERY, '(max-width:760px)');
  assert.equal(filesDeviceKind({ua: 'Mozilla/5.0 (Linux; Android 14) KPTUAndroid/0.4.15', narrow: true}), 'app');
  assert.equal(filesDeviceKind({ua: 'Mozilla/5.0 (Linux; Android 14) KPTUAndroid/0.4.15', narrow: false}), 'app');
  assert.equal(filesDeviceKind({ua: 'Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27', narrow: true}), 'phone');
  assert.equal(filesDeviceKind({ua: 'Mozilla/5.0 (Windows NT 10.0)', narrow: false}), 'pc');
  assert.equal(filesDeviceKind(), 'pc');
  assert.match(read('app/files-sources-model.mjs'), /import \{isPhoneApp\} from '\.\/phone-push-model\.mjs'/);
});
test('기기 칸 쓰기는 그 칸만 바꾸고 다른 기기 칸은 그대로(서버 값과 합침)', () => {
  const server = {theme: 'navy', files_sources: {app: {od: false, gd: true}, pc: {od: true, gd: true}}};
  assert.deepEqual(applyChanges(server, {'files_sources.pc': {od: true, gd: false}}).files_sources, {app: {od: false, gd: true}, pc: {od: true, gd: false}});
  assert.deepEqual(applyChanges(server, {'files_sources.phone': {od: false, gd: false}}).files_sources, {app: {od: false, gd: true}, phone: {od: false, gd: false}, pc: {od: true, gd: true}});
  assert.deepEqual(applyChanges({files_sources: {pc: {od: true}}}, {'files_sources.pc': null}), {});
  const vp = createViewPrefs({runtime: () => null, storage: () => null});
  assert.equal(vp.setFilesSources('tablet', {od: true}), false);
  assert.equal(vp.setFilesSources('pc', {od: 'x'}), false);
  assert.equal(vp.setFilesSources('pc', {od: true, gd: false}), true);
  assert.deepEqual(vp.getFilesSources('pc'), {od: true, gd: false});
  assert.equal(vp.getFilesSources('app'), undefined);
  assert.equal(vp.get('files_sources'), undefined, '통째 읽기·쓰기는 없음(기기 칸으로만)');
  assert.equal(vp.set('files_sources', {pc: {od: true}}), false);
});
test('화면은 서버 저장만(기기 저장 없음)·같은 부품·같은 나무 부품을 쓴다', () => {
  const js = read('app/files.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(js, new RegExp(['local', 'session'].map(k => k + 'Stor' + 'age').concat('indexed' + 'DB').join('|')));
  assert.match(js, /viewPrefs\.setFilesSources\(DEVICE, filesSourcesValue\(toggleFilesSource\(srcState\(\), name\)\)\)/);
  assert.match(js, /const DEVICE = filesDeviceKind\(\{ua: navigator\.userAgent \|\| '', narrow: PHONE\.matches\}\)/);
  assert.match(js, /import \{odLinkButtonHtml, paintOdLink\} from '\.\/od-link\.js'/);
  assert.match(js, /brandIconSvg\('gdrive'/);
  assert.match(js, /treeRows\(\{sources: onSources\(\)/);
  assert.match(js, /fillFolder\(source, id\)/);
  // 펼친 폴더 읽기는 폴더 열기(directRead)와 같은 directDone 표를 쓴다 = 한 번 읽은 폴더는 다시 부르지 않음.
  assert.match(js, /directDone\.has\(dk\)/);
  const css = read('app/source-chips.css');
  assert.match(css, /#filesView/);
  assert.match(css, /#photosView/);
  assert.match(read('app/photos.js'), /class="photos-srcs src-chips"/);
  assert.match(read('app/files.js'), /class="fx-srcs src-chips"/);
});
