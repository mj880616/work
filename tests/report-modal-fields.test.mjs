// MTG-보고창정리: 사업 보고 입력·수정 창의 칸별 줄(차수·짧은 이름), 원문 선택 입력, 상세 ⋯ 메뉴. 네트워크·브라우저 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {showRoundRows,reportWords} from '../app/report-words.mjs';
import {REPORT_KINDS} from '../app/report-kinds.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('차수·짧은 이름 줄: 회의 칸은 늘, 다른 칸은 이미 값이 있는 기록만',()=>{
  assert.equal(showRoundRows('meeting'),true);assert.equal(showRoundRows(''),true);assert.equal(showRoundRows(undefined),true);
  for(const k of REPORT_KINDS.filter(k=>k.value!=='meeting')){
    assert.equal(showRoundRows(k.value),false,k.value);
    assert.equal(showRoundRows(k.value,{round:null,shortName:''}),false,k.value);
    assert.equal(showRoundRows(k.value,{round:'',shortName:'  '}),false,k.value);
    assert.equal(showRoundRows(k.value,{round:3,shortName:''}),true,k.value);
    assert.equal(showRoundRows(k.value,{round:null,shortName:'파생 간담회'}),true,k.value);
  }
});
test('원문은 필수가 아니다: 입력·수정 창 모두 빈 원문 검사가 없고 문구도 없다',()=>{
  assert.equal('textMissing' in reportWords('meeting'),false);assert.equal('textMissing' in reportWords('press'),false);
  const team=read('app/team.js'),mrd=read('app/meeting-round-detail.js');
  assert.doesNotMatch(team,/transcript\.trim\(\)\)return/);assert.doesNotMatch(mrd,/transcript\.trim\(\)\)\{/);
  assert.doesNotMatch(team+mrd,/textMissing/);
  assert.match(read('app/index.html'),/id="meetingTextLabel">회의 결과 원문<\/span> <span class="optional">선택</);
});
test('줄은 숨기지 않고 한 곳(report-entry-rows.js)이 창에서 뺀다',()=>{
  const team=read('app/team.js'),mrd=read('app/meeting-round-detail.js'),rows=read('app/report-entry-rows.js');
  assert.match(team,/entryRoundRows\.paint\(meeting\)/);assert.match(mrd,/mrdRoundRows\?\.paint\(showRoundRows\(/);
  assert.doesNotMatch(team+mrd,/label\.hidden=!meeting|el\.hidden=!meeting|data-rw="mrdEditRound/);
  assert.match(rows,/row\.remove\(\)/);assert.doesNotMatch(rows,/\.hidden\s*=|style\.display|setAttribute\(.hidden/);
});
test('상세 창: 정리함에 담기·안내문 삭제, 큰 버튼 줄 대신 제목 줄 ⋯ 메뉴, 원문이 비면 칸을 그리지 않음',()=>{
  assert.equal(existsSync(new URL('../app/meeting-basket-send.js',import.meta.url)),false);
  const mrd=read('app/meeting-round-detail.js');
  assert.doesNotMatch(mrd,/mrdToBasket|mrdBasket|정리함에 담|sendMeetingToBasket|길게 눌러 고르면|자료실 올리기 창이 열리고/);
  assert.doesNotMatch(mrd,/id="mrdEdit" class="mini"|id="mrdKind"|id="mrdDelete"|mrdHeadActions/);
  assert.match(mrd,/id="mrdMore" class="icon-btn" type="button" data-ctx="area"/);
  assert.match(mrd,/createAnchoredMenu\(\{id:'mrdMoreMenu'/);
  assert.match(mrd,/data-mrd-more="edit"[^]*data-mrd-more="kind"[^]*data-mrd-more="delete"/);
  assert.match(mrd,/classList\.toggle\('hidden',!text\)/);
});
