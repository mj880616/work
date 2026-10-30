// MTG-폰녹음전사(요청함 10/30 15:29): 폰 녹음(OGG/Opus)을 1분마다 바이트로 잘라 올리고 서버가 이어 붙인 파일이 온전한지,
// 그리고 전사 전에 Ogg 쪽 머리(granule·쪽 번호·처음/끝 표시·검사합)를 규격대로 고치는지 본다. 실패 코드별 화면 문구도 본다.
// 소리는 가짜(무작위 바이트 + Opus 머리 바이트)다. 운영 서버·Drive·Gemini는 쓰지 않는다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ogg from '../supabase/functions/meeting-transcribe/ogg.mjs';
import * as m from '../supabase/functions/meeting-transcribe/model.mjs';
import {joinPieces} from '../supabase/functions/meeting-transcribe/recording.mjs';
import {transcribeFailText,TRANSCRIBE_DISCONNECTED} from '../app/meeting-transcript-model.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

// ---- 가짜 Ogg/Opus 만들기(AOSP OggWriter와 같은 모양: 소리 묶음 하나마다 쪽 하나) ----
function page({flags=0,granule=0n,serial=0x1234abcd,seq,packet}){
  const lacing=[];let n=packet.length;while(n>=255){lacing.push(255);n-=255}lacing.push(n);
  const out=new Uint8Array(27+lacing.length+packet.length);
  out.set([0x4f,0x67,0x67,0x53,0,flags]);
  const g=granule<0n?0xffffffffffffffffn:granule;
  for(let k=0;k<8;k++)out[6+k]=Number((g>>BigInt(8*k))&0xffn);
  const w32=(i,v)=>{out[i]=v&255;out[i+1]=(v>>>8)&255;out[i+2]=(v>>>16)&255;out[i+3]=(v>>>24)&255};
  w32(14,serial);w32(18,seq);out[26]=lacing.length;out.set(lacing,27);out.set(packet,27+lacing.length);
  w32(22,ogg.oggCrc(out,0,out.length));
  return out;
}
const opusHead=(preSkip=312)=>{const h=new Uint8Array(19);h.set(new TextEncoder().encode('OpusHead'));h[8]=1;h[9]=1;h[10]=preSkip&255;h[11]=preSkip>>8;h[12]=0x80;h[13]=0xbb;return h};
const opusTags=()=>{const t=new TextEncoder().encode('OpusTags');const out=new Uint8Array(8+4+7+4);out.set(t);out[8]=7;out.set(new TextEncoder().encode('libopus'),12);return out};
let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff);
// 20ms CELT 묶음(TOC 0xF8 = config 31, 한 프레임) 80바이트 안팎(32kbps).
const audioPacket=()=>{const n=60+rnd()%40;const p=new Uint8Array(n);p[0]=0xf8;for(let i=1;i<n;i++)p[i]=rnd()&255;return p};
/** 안드로이드식: granule = 묶음 시작 시각(녹음기 시계 baseUs에서 시작, 일시정지 pauseUs 포함), 끝 표시 없음. */
function androidOgg(seconds,{baseUs=0,pauseAt=0,pauseUs=0}={}){
  const pages=[page({flags:2,seq:0,packet:opusHead()}),page({seq:1,packet:opusTags()})];
  const count=seconds*50;
  for(let i=0;i<count;i++){
    let us=baseUs+i*20000;if(pauseAt&&i>=pauseAt*50)us+=pauseUs;
    pages.push(page({seq:2+i,granule:BigInt(Math.floor(48000*us/1e6)),packet:audioPacket()}));
  }
  const size=pages.reduce((s,p)=>s+p.length,0),out=new Uint8Array(size);let at=0;for(const p of pages){out.set(p,at);at+=p.length}
  return out;
}
// 규격대로인지(쪽 검사합·번호 차례·처음/끝 표시·granule이 커지기만 하고 마지막이 표본 수와 같음).
function assertValid(bytes,expectSeconds){
  const {pages,garbage,truncated,badCrc}=ogg.readPages(bytes);
  assert.equal(garbage,0);assert.equal(truncated,0);assert.equal(badCrc,0);
  pages.forEach((p,i)=>{
    assert.equal(p.seq,i);
    assert.equal(!!(p.flags&2),i===0,'처음 표시는 첫 쪽에만');
    assert.equal(!!(p.flags&4),i===pages.length-1,'끝 표시는 마지막 쪽에만');
    if(i>0)assert.ok(p.granule>=pages[i-1].granule);
  });
  if(expectSeconds!=null)assert.equal(Math.round(Number(pages.at(-1).granule-312n)/48000),expectSeconds);
}
// 앱처럼 1분마다 '지금까지 쓰인 바이트'를 자른다(쪽 중간에서 잘려도 됨). 마지막은 멈춘 뒤 남은 것.
function cutLikeApp(bytes,n=5){
  const out=[];let from=0;
  for(let k=1;k<n;k++){const to=Math.floor(bytes.length*k/n)+(k*37)%251;out.push(bytes.slice(from,to));from=to}
  out.push(bytes.slice(from));return out;
}
const response=bytes=>{let i=0;return {ok:true,body:new ReadableStream({pull(c){if(i>=bytes.length){c.close();return}c.enqueue(bytes.slice(i,i+4096));i+=4096}})}};
async function readAll(stream){const r=stream.getReader(),parts=[];for(;;){const {value,done}=await r.read();if(done)break;parts.push(value)}const n=parts.reduce((s,p)=>s+p.length,0),o=new Uint8Array(n);let a=0;for(const p of parts){o.set(p,a);a+=p.length}return o}

test('조각 잇기: 1분마다 바이트로 자른 조각을 서버가 이으면 원래 파일과 바이트까지 같다(멈출 때 앞부분을 다시 쓰지 않으므로)',async()=>{
  const file=androidOgg(300);
  const pieces=cutLikeApp(file,5);
  const byId=new Map(pieces.map((p,i)=>[`piece${i}aaaaaaaa`,p]));
  const joined=await readAll(joinPieces(id=>response(byId.get(id)),[...byId.keys()]));
  assert.deepEqual(joined,file);
  // 이은 파일 자체도 Ogg 쪽으로는 온전하다(검사합 모두 맞음, 찌꺼기·잘림 없음).
  const {pages,garbage,truncated,badCrc}=ogg.readPages(joined);
  assert.equal(pages.length,2+300*50);assert.equal(garbage+truncated+badCrc,0);
});

test('안드로이드식 granule(녹음기 시계, 0에서 시작하지 않음)·끝 표시 없음 → 고친 파일은 규격대로, 길이 5분, 크기 그대로',()=>{
  const file=androidOgg(300,{baseUs:3*86400e6});
  const before=ogg.readPages(file).pages;
  assert.ok(Number(before.at(-1).granule)/48000>86400,'고치기 전에는 마지막 granule이 사흘 넘게 나온다');
  assert.equal(before.at(-1).flags&4,0);
  const {bytes,stats}=ogg.normalizeOggOpus(file);
  assert.equal(bytes.length,file.length);
  assert.equal(stats.kind,'opus');assert.equal(stats.seconds,300);assert.equal(stats.eos_added,true);assert.equal(stats.first_granule_sec,259200);
  assertValid(bytes,300);
  // 소리 바이트(쪽 몸통)는 그대로다.
  const a=ogg.readPages(file).pages,b=ogg.readPages(bytes).pages;
  for(const i of [2,500,b.length-1])assert.deepEqual(bytes.slice(b[i].bodyStart,b[i].end),file.slice(a[i].bodyStart,a[i].end));
});

test('일시정지 시간이 granule에 들어간 파일도 녹음한 길이로 고친다',()=>{
  const file=androidOgg(120,{pauseAt:60,pauseUs:90e6});
  assert.ok(Number(ogg.readPages(file).pages.at(-1).granule)/48000>200);
  const {bytes,stats}=ogg.normalizeOggOpus(file);
  assert.equal(stats.seconds,120);assertValid(bytes,120);
});

test('이미 규격대로인 파일은 고쳐도 같다(두 번 고쳐도 같음)',()=>{
  const once=ogg.normalizeOggOpus(androidOgg(30)).bytes;
  const twice=ogg.normalizeOggOpus(once);
  assert.deepEqual(twice.bytes,once);assert.equal(twice.stats.fixed_granule,0);assert.equal(twice.stats.eos_added,false);
});

test('끝이 잘린 쪽(앱이 죽음)은 빼고, 쪽 사이 찌꺼기는 건너뛴다',()=>{
  const file=androidOgg(10);
  const cut=file.slice(0,file.length-30);
  const r1=ogg.normalizeOggOpus(cut);
  assert.ok(r1.stats.dropped_bytes>0);assertValid(r1.bytes);
  const pages=ogg.readPages(file).pages,mid=pages[100].start;
  const dirty=new Uint8Array(file.length+5);dirty.set(file.slice(0,mid));dirty.set([1,2,3,4,5],mid);dirty.set(file.slice(mid),mid+5);
  const r2=ogg.normalizeOggOpus(dirty);
  assert.equal(r2.stats.dropped_bytes,5);assertValid(r2.bytes,10);
});

test('Ogg가 아니거나 Opus 머리가 없으면 bad_format, Opus가 아닌 Ogg(Vorbis 등)는 손대지 않는다',()=>{
  assert.throws(()=>ogg.normalizeOggOpus(new TextEncoder().encode('not an ogg file at all')),e=>e instanceof ogg.OggFail&&e.code==='bad_format');
  assert.throws(()=>ogg.normalizeOggOpus(new Uint8Array(0)),e=>e.code==='bad_format');
  const head=androidOgg(1);const broken=head.slice();broken[ogg.readPages(head).pages[0].bodyStart]=0x58; // 'OpusHead' → 'XpusHead'
  const other=ogg.normalizeOggOpus(broken);assert.equal(other.stats.kind,'other');assert.equal(other.bytes,broken);
  const noTags=new Uint8Array([...page({flags:2,seq:0,packet:opusHead()}),...page({seq:1,granule:960n,packet:audioPacket()})]);
  assert.throws(()=>ogg.normalizeOggOpus(noTags),e=>e.code==='bad_format');
});

test('Opus 묶음 길이(TOC): 20ms·10ms·60ms·여러 프레임',()=>{
  assert.equal(ogg.opusSamples([0xf8]),960);           // CELT 20ms
  assert.equal(ogg.opusSamples([0xf0]),480);           // CELT 10ms
  assert.equal(ogg.opusSamples([0x18]),2880);          // SILK 60ms
  assert.equal(ogg.opusSamples([0xf9]),1920);          // 20ms × 2
  assert.equal(ogg.opusSamples([0xfb,0x03]),2880);     // c=3, 3프레임
  assert.equal(ogg.opusSamples([0xfb,0x3f]),0);        // 120ms 넘음 → 읽을 수 없음
  assert.equal(ogg.opusSamples([]),0);
});

test('고칠 파일: ogg·opus만, 48MB까지(큰 파일·다른 형식은 지금처럼 흘려 보냄)',()=>{
  assert.equal(ogg.wantsOggFix('audio/ogg','녹음 2026-10-30 1430 구간1.ogg',2e6),true);
  assert.equal(ogg.wantsOggFix('audio/opus','a.opus',1),true);
  assert.equal(ogg.wantsOggFix('audio/mp4','a.ogg',1),true);
  assert.equal(ogg.wantsOggFix('audio/webm','a.webm',1e6),false);
  assert.equal(ogg.wantsOggFix('audio/mp4','a.m4a',1e6),false);
  assert.equal(ogg.wantsOggFix('audio/ogg','a.ogg',ogg.OGG_FIX_MAX_BYTES+1),false);
  assert.equal(ogg.wantsOggFix('audio/ogg','a.ogg',0),false);
});

test('Edge: 전사 전에 Ogg를 고쳐 보내고(원본 Drive 파일은 그대로), Gemini 실패를 단계별 코드로 남긴다',()=>{
  const index=read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(index,/import \{ OggFail, normalizeOggOpus, wantsOggFix \} from '\.\/ogg\.mjs'/);
  assert.match(index,/const audio = await audioForGemini\(job, media\);\n\s*const file = await geminiUpload\(key, job, audio\.body, audio\.size\);/);
  assert.match(index,/throw new Fail\('bad_format'\)/);
  assert.match(index,/throw new Fail\('gemini_file_failed'\)/);
  assert.match(index,/throw new Fail\(geminiCode\(r\.status\)\)/);
  assert.match(index,/'gemini_timeout' : 'failed'/);
  // 로그에는 수·상태 이름만(오류 글·소리·주소 없음).
  assert.doesNotMatch(index,/console\.warn\([^)]*error\?\.message/);
  assert.doesNotMatch(index,/console\.warn\([^)]*(file\.uri|drive_file_id|text)/);
});

test('실패 코드: Gemini 답 상태 → 코드, 화면 갈래(전사 서비스·파일 형식), 서버 문구 = 화면 문구',()=>{
  assert.equal(m.geminiCode(400),'gemini_rejected');assert.equal(m.geminiCode(422),'gemini_rejected');
  assert.equal(m.geminiCode(504),'gemini_timeout');assert.equal(m.geminiCode(500),'gemini_failed');assert.equal(m.geminiCode(429),'gemini_failed');
  for(const [code,kind] of Object.entries(m.FAIL_KIND)){
    assert.ok(m.MESSAGES[code],code);assert.ok(m.STATUS[code],code);
    assert.equal(transcribeFailText(m.MESSAGES[code]),m.MESSAGES[code],'화면이 서버 줄을 그대로 보여 줌: '+code);
    assert.equal(transcribeFailText(code),m.MESSAGES[code]);
    if(kind==='format'&&code!=='bad_type')assert.match(m.MESSAGES[code],/형식/);
    if(kind==='gemini')assert.match(m.MESSAGES[code],/전사 서비스\(Gemini\)/);
  }
  assert.match(m.MESSAGES.bad_format,/Drive에 그대로/);
  // 세 갈래 문구가 서로 다르다.
  const texts=new Set([m.MESSAGES.gemini_failed,m.MESSAGES.gemini_file_failed,TRANSCRIBE_DISCONNECTED]);assert.equal(texts.size,3);
});

test('연결 끊김: 화면이 받은 시간 초과·네트워크 오류·서버 강제 종료(546·504 일반 글)는 따로 알린다',()=>{
  assert.equal(transcribeFailText({code:'timeout',message:'요청 시간이 초과되었습니다. 다시 시도해 주세요.'}),TRANSCRIBE_DISCONNECTED);
  assert.equal(transcribeFailText({code:'network_error',message:'네트워크 연결을 확인한 뒤 다시 시도해 주세요.'}),TRANSCRIBE_DISCONNECTED);
  assert.equal(transcribeFailText({status:546,code:'http_546',message:'요청 실패 546'}),TRANSCRIBE_DISCONNECTED);
  assert.equal(transcribeFailText({status:504,code:'http_504',message:'요청 실패 504'}),TRANSCRIBE_DISCONNECTED);
  // 서버가 정한 504(Gemini 늦음)는 그 줄 그대로.
  assert.equal(transcribeFailText({status:504,code:'http_504',message:m.MESSAGES.gemini_timeout}),m.MESSAGES.gemini_timeout);
  assert.equal(transcribeFailText({status:422,code:'http_422',message:m.MESSAGES.bad_format}),m.MESSAGES.bad_format);
  assert.match(transcribeFailText({status:500,message:'요청 실패 500'}),/^전사하지 못했어요/);
  assert.match(transcribeFailText(null),/^전사하지 못했어요/);
});

test('화면 세 곳(폰 녹음·노트북 녹음·파일 올려 전사)이 오류 객체째 넘긴다(연결 끊김을 가르려면 code·status가 필요)',()=>{
  for(const f of ['app/phone-recorder-core.mjs','app/meeting-recorder.js','app/meeting-transcript-draft.js']){
    const src=read(f);
    assert.match(src,/transcribeFailText\(e\)/,f);
    assert.doesNotMatch(src,/transcribeFailText\(e\?\.message\)/,f);
  }
});
