import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// AI-모델6luna: Web2 서버 AI의 모델 이름·생각 수준·가격 기본값은 _shared/ai-model.ts 한 곳에서만 정한다.
const ROOT=fileURLToPath(new URL('../../supabase/functions/',import.meta.url));
const SOURCE='_shared/ai-model.ts';
const model=await import('../../supabase/functions/_shared/ai-model.ts');
const {callOpenAi}=await import('../../supabase/functions/_shared/openai-responses.ts');

const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
const files=walk(ROOT).filter(p=>/\.(ts|mjs|js)$/.test(p));

test('기본값은 gpt-6-luna, 생각 수준 low, 단가는 공식 가격(입력 $0.10·출력 $0.50 /100만 토큰, 1달러 1,400원)',()=>{
  assert.equal(model.DEFAULT_AI_MODEL,'gpt-6-luna');
  assert.equal(model.AI_REASONING_EFFORT,'low');
  assert.equal(model.DEFAULT_PRICE_IN_KRW_PER_MTOK,0.10*1400);
  assert.equal(model.DEFAULT_PRICE_OUT_KRW_PER_MTOK,0.50*1400);
});

test('함수 코드 어디에도 gpt 모델 이름을 따로 적지 않는다(단일 출처 밖 하드코딩 없음)',()=>{
  const hits=[];
  for(const p of files){
    const rel=relative(ROOT,p).split('\\').join('/');
    if(rel===SOURCE)continue;
    const text=readFileSync(p,'utf8');
    if(/['"`]gpt-[0-9a-z.\-]+['"`]/i.test(text))hits.push(rel);
    if(/DEFAULT_PRICE_(IN|OUT)_KRW_PER_MTOK\s*=\s*\d/.test(text))hits.push(rel+' (가격 숫자)');
  }
  assert.deepEqual(hits,[]);
});

test('OpenAI를 부르는 Web2 AI 함수는 모두 단일 출처를 불러 쓴다',()=>{
  const users=['_shared/openai-responses.ts','ai-assist/handler.ts','collector-feed/handler.ts',
    'document-ai-index/index.ts','library-files/index.ts','meeting-ai-ingest/index.ts'];
  for(const rel of users)assert.match(readFileSync(join(ROOT,rel),'utf8'),/ai-model\.ts['"]/,rel);
  // DB 설정 표를 읽는 세 함수: 표 값이 없을 때만 공용 기본값, 요청 몸통에 생각 수준을 붙인다.
  for(const rel of users.slice(3)){
    const text=readFileSync(join(ROOT,rel),'utf8');
    assert.match(text,/default_model\s*\|\|\s*DEFAULT_AI_MODEL/,rel);
    assert.match(text,/JSON\.stringify\(withReasoning\(/,rel);
  }
});

test('공용 호출의 요청 몸통에 모델·생각 수준·출력 상한이 들어간다(부른 쪽이 정한 reasoning은 그대로)',async()=>{
  const sent=[];
  const deps={doFetch:async(_u,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify({status:'completed',output:[],usage:{input_tokens:1,output_tokens:1}}),{status:200});},
    sleep:async()=>{},log:()=>{}};
  const opt={url:'https://openai.invalid/v1/responses',timeoutMs:1000,retryDelayMs:0,maxResponseBytes:4096};
  await callOpenAi(deps,'synthetic-key',{model:model.DEFAULT_AI_MODEL,max_output_tokens:800,input:'지어낸 자료'},opt);
  assert.equal(sent[0].model,'gpt-6-luna');assert.deepEqual(sent[0].reasoning,{effort:'low'});assert.equal(sent[0].max_output_tokens,800);
  await callOpenAi(deps,'synthetic-key',{model:'x',reasoning:{effort:'medium'}},opt);
  assert.deepEqual(sent[1].reasoning,{effort:'medium'});
  assert.deepEqual(model.withReasoning({a:1}),{a:1,reasoning:{effort:'low'}});
});
