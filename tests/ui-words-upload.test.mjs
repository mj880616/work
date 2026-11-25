import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targets, jsStrings, htmlStrings} from './ui-words.mjs';
// UI-업로드말(S70-41, 2026-11-25 명진 "올리기는 업로드로 그리고 그 파일 이모티콘인가 그거 잇자나 클립 그거 붙어있어야함"):
// 파일을 올리는 단추·메뉴·안내의 말은 '업로드', 파일 고르기 단추 앞에는 [첨부] 단추와 같은 클립 그림(app/upload-label.mjs 한 곳).
// 예외: 설치하는 윈도우 도우미 프로그램 이름 'WORK ON+ 파일 올리기'(설치된 이름·바로가기와 같아야 함). 업데이트 기록(옛 공개 배포물)·폰 앱(따로 출시)은 세지 않는다.
const read = f => readFileSync(f, 'utf8');
const HELPER = /WORK ON\+ 파일 올리기|파일 올리기\s?도우미/g;
const found = (f, src) => (/\.(html|xml)$/.test(f) ? htmlStrings(src) : jsStrings(src))
  .filter(({text}) => text.replace(HELPER, '').includes('올리기')).map(({line}) => `${f}:${line}`);

test("화면 글자 '올리기' → '업로드': 앱 화면 글자에 '올리기' 0곳(PC 도우미 이름만 예외)", () => {
  const hits = targets().filter(f => f.startsWith('app/') && !f.startsWith('app/release-notes/')).flatMap(f => found(f, read(f)));
  assert.deepEqual(hits, [], "파일을 올리는 말은 '업로드'(docs/design/ui-words.md)");
});

test('클립 그림은 [첨부] 단추와 같은 그림 하나, 단추 안 = 클립 + 글자', async () => {
  const {CLIP_SVG, uploadLabelHtml, UPLOAD_WORD} = await import('../app/upload-label.mjs');
  assert.equal(UPLOAD_WORD, '업로드');
  const path = s => (s.match(/<path d="([^"]+)"/) || [])[1];
  assert.equal(path(CLIP_SVG), path(read('app/basket-upload.js').match(/basket-clip-icon[^]*?<\/svg>/)[0]), '노트·업데이트 [첨부] 클립과 같은 그림');
  assert.match(CLIP_SVG, /aria-hidden="true"/);
  assert.equal(uploadLabelHtml(), `${CLIP_SVG}<span class="up-clip-t">업로드</span>`);
  assert.equal(uploadLabelHtml('파일 <업로드>'), `${CLIP_SVG}<span class="up-clip-t">파일 &lt;업로드&gt;</span>`);
});

test('파일 고르기 단추마다 클립 + 업로드', () => {
  assert.match(read('app/ui-standard.css'), /\.up-clip, \.up-clip-t \{ pointer-events:none; \}/, '안쪽 그림·글자가 누르는 자리를 가로채지 않는다(단추 자체가 잡힘)');
  assert.match(read('app/ui-standard.css'), /\.up-clip-btn\[hidden\] \{ display:none; \}/, '숨긴 업로드 단추는 숨은 채(inline-flex가 hidden을 이기지 않게)');
  assert.match(read('app/files.js'), /data-fx-upload hidden>\$\{uploadLabelHtml\(\)\}<\/button>/, '[파일] 위 줄 [업로드]');
  const lib = read('app/library-upload.js');
  assert.match(lib, /luMenuRow\('data-lu-area="add"',uploadLabelHtml\('파일 업로드'\)\)/, '자료실 빈 곳 메뉴 [파일 업로드]');
  assert.equal((lib.match(/uploadLabelHtml\('폴더 업로드'\)/g) || []).length, 2, '자료실 [폴더 업로드] 두 메뉴');
  assert.match(read('app/weekly-discuss-table.js'), /putUploadLabel\(pick, '한글 파일 업로드'\)/, '주간보고 협의 줄 [한글 파일 업로드]');
  assert.match(read('app/weekly-start-choice.js'), /putUploadLabel\(pick, START_TEXT\.pick\)/);
  assert.match(read('app/weekly-start-choice.js'), /pick: '파일 업로드'/, '주간보고 첫 화면 [파일 업로드]');
  assert.match(read('app/journal-hwpx.js'), /putUploadLabel\(button\(c\.final \? '다시 업로드' : '업로드'/, '주간보고 ② [업로드]');
  assert.match(read('app/report-library-pick.js'), /up-clip-btn" data-report-add="device">\$\{uploadLabelHtml\(DEVICE_LABEL\)\}/, '보고 자료 [기기에서 업로드]');
  assert.match(read('app/report-library-pick-model.mjs'), /DEVICE_LABEL = '기기에서 업로드'/);
  assert.match(read('app/index.html'), /id="hwpLabUpload" class="secondary up-clip-btn"[^>]*><svg class="up-clip"[^]*?<span class="up-clip-t">자료실에 업로드<\/span><\/button>/, 'HWP 편집 [자료실에 업로드]');
  assert.match(read('app/files-tree-menu.mjs'), /upload: '업로드'/, '[파일] 폴더 ⋯·우클릭 [업로드]');
});
