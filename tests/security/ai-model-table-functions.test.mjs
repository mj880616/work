import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// AI-모델6luna 나머지: 설정 표(app_ai_workspace_settings)의 모델을 따르는 Edge 6개가 새 모델(gpt-6-luna)에서도
// 빈 답 없이 동작하도록 요청 몸통에 생각 수준을 붙이고, 생각 토큰만큼 출력 상한에 여유를 두며, incomplete 답을 실패로 다룬다.
const ROOT=fileURLToPath(new URL('../../supabase/functions/',import.meta.url));
const FUNCTIONS=['library-files','meeting-ai-ingest','document-ai-index','meeting-ai-draft','page-ai-draft','team-ai'];
const src=fn=>readFileSync(ROOT+fn+'/index.ts','utf8');
const {outputText}=await import('../../supabase/functions/_shared/openai-responses.ts');
const {withReasoning,AI_REASONING_TOKEN_HEADROOM}=await import('../../supabase/functions/_shared/ai-model.ts');

test('여섯 함수 모두 OpenAI 요청 몸통을 withReasoning으로 보낸다(직접 JSON.stringify(body) 없음)',()=>{
  for(const fn of FUNCTIONS){
    const t=src(fn);
    assert.match(t,/JSON\.stringify\(withReasoning\(/,fn);
    assert.doesNotMatch(t,/body:JSON\.stringify\(body\)/,fn);
  }
});

test('여섯 함수 모두 공용 outputText를 쓰고 자체 outputText를 두지 않는다',()=>{
  for(const fn of FUNCTIONS){
    const t=src(fn);
    assert.match(t,/import \{ outputText \} from '\.\.\/_shared\/openai-responses\.ts'/,fn);
    assert.doesNotMatch(t,/function outputText/,fn);
  }
});

test('모든 max_output_tokens에 생각 토큰 여유가 더해진다',()=>{
  for(const fn of FUNCTIONS){
    const t=src(fn);
    const at=[...t.matchAll(/max_output_tokens:/g)].map(m=>t.slice(m.index,m.index+110));
    assert.ok(at.length>0,fn);
    for(const c of at)assert.match(c,/AI_REASONING_TOKEN_HEADROOM/,fn+' '+c);
  }
  assert.ok(AI_REASONING_TOKEN_HEADROOM>=1000);
});

test('요청 몸통에 생각 수준(low)이 들어가고 부른 쪽이 정한 값은 그대로 둔다',()=>{
  assert.deepEqual(withReasoning({model:'gpt-6-luna'}).reasoning,{effort:'low'});
  assert.deepEqual(withReasoning({reasoning:{effort:'high'}}).reasoning,{effort:'high'});
});

test('status가 incomplete인 답은 부분 글이 있어도 null(실패)이다',()=>{
  const part={type:'message',content:[{type:'output_text',text:'{"title":"잘린'}]};
  assert.equal(outputText({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[part]}),null);
  assert.equal(outputText({status:'incomplete',output:[]}),null);
  assert.equal(outputText({status:'completed',output:[{type:'reasoning'}]}),null);
  assert.equal(outputText({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"a":1}'}]}]}),'{"a":1}');
});

test('incomplete(null) 답을 성공으로 저장하지 않는다: 호출부가 null을 실패·대체 경로로 보낸다',()=>{
  // 본문 읽기 두 곳은 빈 값이면 던져서 문서를 error 상태로 둔다.
  assert.match(src('meeting-ai-ingest'),/const text=outputText\(d,256\*1024\);if\(!text\)throw/);
  assert.match(src('document-ai-index'),/const text=outputText\(r,256\*1024\);if\(!text\)throw/);
  // 요약·제목·JSON 답은 null을 빈 글자로 바꿔 파싱 실패 경로(기존 대체값 또는 오류)로 간다. JSON.parse(null)이 null을 성공처럼 돌려주지 못하게 한다.
  assert.match(src('library-files'),/JSON\.parse\(outputText\(r\)\?\?''\)/);
  assert.match(src('document-ai-index'),/JSON\.parse\(outputText\(r\)\?\?''\)/);
  assert.match(src('page-ai-draft'),/JSON\.parse\(outputText\(r\)\?\?''\)/);
  assert.match(src('team-ai'),/plan=JSON\.parse\(text\?\?''\)/);
  assert.match(src('team-ai'),/const answer=outputText\(r\);if\(!answer\)throw/);
  assert.match(src('meeting-ai-draft'),/const text=outputText\(r,256\*1024\);if\(!text\)throw new Error\('AI 응답이 중단되었습니다/);
  assert.throws(()=>JSON.parse(outputText({status:'incomplete',output:[]})??''));
});
