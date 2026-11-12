// REC-긴녹음나눠전사(S60-7): 긴 소리를 시간 구간으로 잘라 따로 전사하는 규칙.
// - 자르기(split.mjs·ogg.mjs): 세 형식(Ogg/Opus·WebM·MP4 두 가지)을 소리를 풀지 않고 잘라 각 조각이 온전한 파일인지, 조각을 합치면 원본 소리를 빠짐없이 덮는지.
// - 구간 계산·조각 parts(server-job.mjs): 나누기 경계, 이어 붙이기 순서·머리 줄, 실패 뒤 그 조각부터 이어하기, 진행 표시 수.
// 시험 소리(tests/fixtures/audio-split)는 ffmpeg로 만든 20초 사인파(사람 목소리·개인정보 없음). 운영 서버·Drive·Gemini는 쓰지 않는다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as sp from '../supabase/functions/meeting-transcribe/split.mjs';
import * as ogg from '../supabase/functions/meeting-transcribe/ogg.mjs';
import * as job from '../supabase/functions/meeting-transcribe/server-job.mjs';
import * as m from '../supabase/functions/meeting-transcribe/model.mjs';

const fx=n=>new Uint8Array(readFileSync(new URL('./fixtures/audio-split/'+n,import.meta.url)));
const near=(a,b,d,msg)=>assert.ok(Math.abs(a-b)<=d,`${msg}: ${a} vs ${b}`);
const RANGES=[[0,7],[7,13],[13,null]];

test('구간 계산: 30분 넘을 때만 고른 길이로 나눔, 마지막은 끝까지, 반 나누기는 4분 조각까지',()=>{
 // S60-9: 2.5 Flash 출력 상한(65,536토큰)에 맞춰 15분 → 30분. 29분 구간 + 넘길 때 1분 조각은 나누지 않는다.
 assert.equal(sp.CHUNK_SECONDS,1800);assert.equal(sp.MIN_CHUNK_SECONDS,240);
 assert.deepEqual(sp.chunkRanges(1800),[]);assert.deepEqual(sp.chunkRanges(null),[]);
 // 11/12 41분 녹음 → 2조각(20분 30초씩)
 const r=sp.chunkRanges(41*60);
 assert.deepEqual(r,[{from:0,to:1230,seconds:1230},{from:1230,to:null,seconds:1230}]);
 // 59분 옛 구간 → 2조각, 85분 → 3조각. 경계가 이어지고 빈틈이 없다
 for(const [len,n] of [[59*60+7,2],[85*60,3]]){
  const rr=sp.chunkRanges(len);
  assert.equal(rr.length,n);
  for(let i=1;i<rr.length;i++)assert.equal(rr[i].from,rr[i-1].to);
  assert.equal(rr.at(-1).to,null);
  near(rr.reduce((s,x)=>s+x.seconds,0),len,1,'합');
  assert.ok(rr.every(x=>x.seconds<=sp.CHUNK_SECONDS));
 }
 // 조각 길이를 넘겨 부를 수도 있다(15분 조각 — 아래 parts 시험).
 assert.equal(sp.chunkRanges(41*60,900).length,3);
 // 반 나누기 상한: 30분 → 15분 → 7.5분에서 멈춤(끝없이 나누지 않음).
 let depth=0,range={from:0,to:1800};
 for(;;){const h=sp.halveRange(range,3600);if(!h.length)break;depth++;range=h[0];}
 assert.equal(depth,2);assert.equal(range.to-range.from,450);
 // 반 나누기: 잘린 조각만, 마지막 조각이면 끝(null) 유지, 8분 미만은 더 나누지 않음
 assert.deepEqual(sp.halveRange({from:820,to:1640},2460),[{from:820,to:1230,seconds:410},{from:1230,to:1640,seconds:410}]);
 assert.deepEqual(sp.halveRange({from:1640,to:null},2460),[{from:1640,to:2050,seconds:410},{from:2050,to:null,seconds:410}]);
 assert.deepEqual(sp.halveRange(null,600),[{from:0,to:300,seconds:300},{from:300,to:null,seconds:300}]);
 assert.deepEqual(sp.halveRange({from:0,to:479},2000),[]);
 // parts jsonb에서 읽은 구간 검사
 assert.deepEqual(sp.readRange({from:820,to:null}),{from:820,to:null});
 assert.equal(sp.readRange({from:-1,to:3}),null);assert.equal(sp.readRange({from:5,to:5}),null);assert.equal(sp.readRange('0-5'),null);
 assert.ok(sp.SPLIT_MAX_BYTES<=m.MAX_BYTES);
});

for(const [file,mime,kind] of [['phone.ogg','audio/ogg','ogg'],['chrome-like.webm','audio/webm','webm'],['voice.m4a','audio/mp4','mp4'],['safari.mp4','audio/mp4','mp4']]){
 test(`자르기 ${file}: 각 조각이 다시 열리는 온전한 파일, 처음 시각 0, 합치면 원본 길이`,()=>{
  const src=fx(file);
  const a=sp.openAudio(src,mime,file);
  assert.equal(a?.kind,kind);
  near(a.seconds,20,0.2,'원본 길이');
  // 이름·형식이 틀려도 파일 첫 바이트로 고른다
  assert.equal(sp.openAudio(src,'application/octet-stream','x.bin')?.kind,kind);
  let sum=0;
  for(const [f,t] of RANGES){
   const cut=a.slice(f,t);
   assert.ok(cut instanceof Uint8Array&&cut.byteLength>0&&cut.byteLength<src.byteLength,'조각 크기');
   const b=sp.openAudio(cut,mime,file);
   assert.equal(b?.kind,kind,'조각을 다시 연다');
   assert.ok(b.seconds>0&&b.seconds<a.seconds,'조각 길이');
   sum+=b.seconds;
  }
  // 경계는 묶음(ogg)·클러스터(webm 2초)·조각(mp4 2초) 단위라 조금 어긋날 수 있지만 빠지거나 겹치는 소리는 없다
  near(sum,a.seconds,0.3,'조각 길이 합');
  // 고른 소리가 없으면 null(빈 파일을 올리지 않음)
  assert.equal(a.slice(60,null),null);
 });
}

test('Ogg 조각: 쪽 번호 0부터·검사합 맞음·처음/끝 표시·granule 증가, 소리 묶음은 하나도 빠지거나 겹치지 않음',()=>{
 const idx=ogg.oggOpusIndex(fx('phone.ogg'));
 assert.ok(idx&&idx.audio.length>100);
 let packets=0,samples=0;
 for(const [f,t] of RANGES){
  const cut=ogg.sliceOggOpus(idx,f,t);
  const {pages,badCrc,garbage,truncated}=ogg.readPages(cut);
  assert.equal(badCrc,0);assert.equal(garbage,0);assert.equal(truncated,0);
  pages.forEach((p,i)=>assert.equal(p.seq,i));
  assert.equal(pages[0].flags&2,2);assert.equal(pages.at(-1).flags&4,4);
  assert.ok(pages.slice(1).every(p=>p.serial===pages[0].serial));
  for(let i=3;i<pages.length;i++)assert.ok(pages[i].granule>pages[i-1].granule);
  const again=ogg.oggOpusIndex(cut);
  packets+=again.audio.length;samples+=again.samples;
  // 고쳐 쓰기(normalizeOggOpus)도 조각을 그대로 받는다(전사 앞 고치기와 겹쳐도 됨)
  assert.equal(ogg.normalizeOggOpus(cut).stats.kind,'opus');
 }
 assert.equal(packets,idx.audio.length);assert.equal(samples,idx.samples);
 // Opus가 아닌 Ogg·깨진 바이트는 나눌 수 없음(null) → 지금처럼 통째로
 assert.equal(ogg.oggOpusIndex(new Uint8Array([0x4f,0x67,0x67,0x53,0,2,0,0])),null);
});

test('WebM 조각: 클러스터는 빠짐없이 한 번씩, 조각마다 시각이 0부터, Info의 전체 길이는 뺌',()=>{
 const idx=sp.webmIndex(fx('chrome-like.webm'));
 assert.ok(idx&&idx.clusters.length>=5);
 let clusters=0;
 for(const [f,t] of RANGES){
  const again=sp.webmIndex(sp.sliceWebm(idx,f,t));
  assert.equal(again.clusters[0].timecode,0);
  clusters+=again.clusters.length;
 }
 assert.equal(clusters,idx.clusters.length);
 // 한 파일에 EBML 머리가 둘(따로 녹음한 두 파일을 이어 붙임)이면 나누지 않는다
 const two=fx('chrome-like.webm');const joined=new Uint8Array(two.length*2);joined.set(two);joined.set(two,two.length);
 const j=sp.webmIndex(joined);
 assert.ok(j===null||j.clusters.length===idx.clusters.length,'뒤 줄기를 앞 줄기에 섞지 않음');
});

test('MP4 조각: 보통 m4a는 표본 수·바이트가 빠짐없이, 조각난 mp4는 moof 조각이 빠짐없이',()=>{
 const plain=sp.mp4Index(fx('voice.m4a'));
 assert.equal(plain.kind,'plain');
 let n=0,bytes=0;
 for(const [f,t] of RANGES){const c=sp.mp4Index(sp.sliceMp4(plain,f,t));assert.equal(c.kind,'plain');n+=c.sizes.length;bytes+=c.sizes.reduce((s,x)=>s+x,0)}
 assert.equal(n,plain.sizes.length);assert.equal(bytes,plain.sizes.reduce((s,x)=>s+x,0));
 const frag=sp.mp4Index(fx('safari.mp4'));
 assert.equal(frag.kind,'fragmented');
 let frags=0;
 for(const [f,t] of RANGES){const c=sp.mp4Index(sp.sliceMp4(frag,f,t));assert.equal(c.kind,'fragmented');assert.equal(c.frags[0].time,0);frags+=c.frags.length}
 assert.equal(frags,frag.frags.length);
});

// ---- S60-11 REC-m4a뒤조각멈춤: 보통 m4a(삼성 음성 녹음 모양)의 '시작이 0이 아닌' 뒤 조각 ----
// 11/12 41분 녹음 {0~1241초} 조각은 성공, {1241초~끝} 조각에서 로그 없이 두 번 멈췄다. 같은 자르기가 뒤 조각도 온전한 파일을 만드는지,
// moov 뒤(mdat 먼저)·앞, stco·co64 모두 확인한다. 시험 소리 voice-tail.m4a = ffmpeg 30초 사인파 2채널 48kHz AAC, moov가 파일 끝(사람 목소리 없음).
const u32=(b,i)=>b[i]*2**24+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3];
const t4=(b,i)=>String.fromCharCode(b[i],b[i+1],b[i+2],b[i+3]);
const be32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
// 상자 트리를 풀어(moov 안 컨테이너만) fn으로 바꾼 뒤 다시 짠다. moov가 파일 끝이면 mdat 위치가 그대로라 표본 위치를 고칠 필요가 없다.
const CONT=new Set(['moov','trak','mdia','minf','stbl']);
function rebuild(b,s,e,fn){
 const out=[];let i=s;
 while(i<e){const size=u32(b,i),type=t4(b,i+4);let body=b.subarray(i+8,i+size);
  if(CONT.has(type))body=rebuild(b,i+8,i+size,fn);
  const r=fn(type,body);if(r!==null){const bb=r??body;out.push(Uint8Array.from([...be32(bb.length+8),...[...(r&&r.type?r.type:type)].map(c=>c.charCodeAt(0))]),bb)}
  i+=size;}
 const n=out.reduce((a,x)=>a+x.length,0),o=new Uint8Array(n);let at=0;for(const x of out){o.set(x,at);at+=x.length}return o;
}
// stco(32비트 위치) → co64(64비트 위치): 긴 녹음·큰 파일에서 쓰는 모양.
const toCo64=b=>rebuild(b,0,b.length,(type,body)=>{
 if(type!=='stco')return undefined;
 const n=u32(body,4),o=new Uint8Array(8+8*n);o.set(body.subarray(0,8));
 for(let k=0;k<n;k++)o.set([0,0,0,0,...be32(u32(body,8+4*k))],8+8*k);
 o.type='co64';return o;
});
// 뒤 조각 하나를 검사: 다시 읽힘·첫 표본 시각 0·표본 바이트가 원본 그 자리 바이트와 같음·길이.
function checkTail(src,idx,from,to){
 const out=sp.sliceMp4(idx,from,to);assert.ok(out,`${from}~${to} 잘림`);
 const back=sp.mp4Index(out);assert.equal(back.kind,'plain');
 assert.equal(back.starts[0],0,'조각의 첫 표본 시각은 0');
 const s0=idx.starts.findIndex(t=>t/idx.timescale>=from);
 for(let k=0;k<back.sizes.length;k++){
  const a=idx.offsets[s0+k],z=a+idx.sizes[s0+k];
  assert.deepEqual(out.subarray(back.offsets[k],back.offsets[k]+back.sizes[k]),src.subarray(a,z));
 }
 // 길이: 고른 표본 길이의 합(mvhd·tkhd·mdhd 모두 같은 값)
 near(back.seconds,(to??idx.seconds)-from,0.15,'조각 길이(AAC 한 묶음 단위)');
 return back.sizes.length;
}
test('S60-11 보통 m4a 뒤 조각: moov 뒤·앞, stco·co64 모두 시작이 0이 아닌 조각도 온전한 파일(표본 바이트 그대로, 첫 시각 0)',()=>{
 const tail=fx('voice-tail.m4a');
 const variants=[['moov 뒤·stco',tail],['moov 뒤·co64',toCo64(tail)],['moov 앞·stco(voice.m4a)',fx('voice.m4a')]];
 for(const [name,src] of variants){
  const o=sp.openAudio(src,'audio/mp4','a.m4a');assert.ok(o,name);assert.equal(o.kind,'mp4');
  const idx=sp.mp4Index(src);assert.equal(idx.kind,'plain',name);
  // 41분 녹음의 나눔(0~1241 / 1241~끝, 전체의 약 50.2%)과 같은 비율 + 세 조각
  const mid=Math.round(idx.seconds*1241/2470);
  let n=checkTail(src,idx,0,mid)+checkTail(src,idx,mid,null);
  assert.equal(n,idx.sizes.length,`${name}: 두 조각 표본 합 = 원본`);
  n=0;for(const [f,t] of RANGES)n+=checkTail(src,idx,f,t);
  assert.equal(n,idx.sizes.length,`${name}: 세 조각 표본 합 = 원본`);
 }
 const co=sp.mp4Index(toCo64(tail));assert.deepEqual([...co.sizes],[...sp.mp4Index(tail).sizes],'co64로 바꿔도 같은 표본');
 // 자르기는 소리를 풀지 않으므로 빠르다(운영 41분 40MB 같은 모양 측정: 열기 약 60ms, 뒤 조각 자르기 약 30~90ms).
 const t0=Date.now();for(let k=0;k<50;k++)sp.sliceMp4(sp.mp4Index(tail),13,null);assert.ok(Date.now()-t0<2000);
});
test('S60-11 안전하게 못 자르는 m4a 모양은 나눌 수 없음(null) → 통째로 보낸다',()=>{
 const tail=fx('voice-tail.m4a');
 // 표본 위치가 mdat 밖을 가리킴(깨진 위치 표)
 const badOffset=rebuild(tail,0,tail.length,(type,body)=>{if(type!=='stco')return undefined;const o=body.slice();o.set(be32(4),8);return o;});
 assert.equal(sp.mp4Index(badOffset),null);assert.equal(sp.openAudio(badOffset,'audio/mp4','a.m4a'),null);
 // 소리 설명(stsd)이 둘
 const twoDesc=rebuild(tail,0,tail.length,(type,body)=>{if(type!=='stsd')return undefined;const o=body.slice();o.set(be32(2),4);return o;});
 assert.equal(sp.openAudio(twoDesc,'audio/mp4','a.m4a'),null);
 // 묶음이 다른 설명 번호를 가리킴
 const otherDesc=rebuild(tail,0,tail.length,(type,body)=>{if(type!=='stsc')return undefined;const o=body.slice();o.set(be32(2),16);return o;});
 assert.equal(sp.openAudio(otherDesc,'audio/mp4','a.m4a'),null);
 // 통째 전사 출력 상한: 41분 통째도 모델 상한 65,536토큰(이 녹음 첫 21분이 7,585토큰).
 assert.equal(m.outputCap(41*60),m.TRANSCRIBE_MAX_OUTPUT_TOKENS);
});

test('나눌 수 없는 형식은 null(mp3·깨진 파일·빈 파일) — 지금처럼 통째로 보낸다',()=>{
 assert.equal(sp.openAudio(fx('other.mp3'),'audio/mpeg','a.mp3'),null);
 assert.equal(sp.openAudio(new Uint8Array(0),'audio/webm','a.webm'),null);
 assert.equal(sp.openAudio(fx('voice.m4a').subarray(0,200),'audio/mp4','a.m4a'),null);
 assert.equal(sp.openAudio(fx('chrome-like.webm').subarray(0,40),'audio/webm','a.webm'),null);
});

test('조각 parts: 나누기 → 차례로 전사 → 실패 뒤 그 조각부터 → 시각 순으로 잇기(머리 줄), 진행 표시는 조각 수',()=>{
 const J1='11111111-1111-4111-8111-111111111111',J2='22222222-2222-4222-8222-222222222222';
 // 41분 구간 하나 + 뒤에 10분 구간
 let parts=[{no:1,seconds:2460,job:J1,text:null},{no:2,seconds:600,job:J2,text:null}];
 assert.equal(job.partTotal(parts),2);
 parts=job.splitPart(parts,0,sp.chunkRanges(2460,900));
 assert.equal(parts.length,4);assert.equal(job.partTotal(parts),4);assert.equal(job.doneParts(parts),0);
 assert.deepEqual(parts.slice(0,3).map(p=>[p.no,p.job,p.range.from,p.range.to,p.seconds]),[[1,J1,0,820,820],[1,J1,820,1640,820],[1,J1,1640,null,820]]);
 // 같은 소리의 조각이 더 남았나(구간 행을 '끝'으로 둘지)
 assert.equal(job.moreOfSame(parts,0),true);
 parts[0]={...parts[0],text:'첫 조각 말'};
 assert.equal(job.nextPart(parts),1);assert.equal(job.doneParts(parts),1);
 // 둘째 조각이 잘려(gemini_incomplete)·되풀이해(gemini_repeat) 반으로 → 첫 조각 글은 그대로
 parts=job.splitPart(parts,1,sp.halveRange(parts[1].range,2460));
 assert.equal(parts.length,5);assert.equal(parts[0].text,'첫 조각 말');assert.equal(job.nextPart(parts),1);
 assert.deepEqual(parts.slice(1,3).map(p=>[p.range.from,p.range.to]),[[820,1230],[1230,1640]]);
 // 실패 뒤 [다시]: 끝난 조각은 건너뛰고 text null인 첫 조각부터
 parts[1]={...parts[1],text:'둘째 앞'};parts[2]={...parts[2],text:'둘째 뒤'};
 assert.equal(job.nextPart(parts),3);
 assert.equal(job.moreOfSame(parts,3),false);
 parts[3]={...parts[3],text:'셋째'};parts[4]={...parts[4],text:'다음 구간'};
 assert.equal(job.nextPart(parts),-1);
 // 저장된 순서가 섞여도 no·시작 시각 순으로 잇는다
 const shuffled=[parts[4],parts[3],parts[0],parts[2],parts[1]];
 assert.equal(job.joinParts(shuffled),'첫 조각 말\n\n― 14분부터 ―\n둘째 앞\n\n― 21분부터 ―\n둘째 뒤\n\n― 27분부터 ―\n셋째\n\n― 41분부터 ―\n다음 구간');
 // 화면 줄: 같은 구간 작업 id는 한 번만(회의에 붙일 녹음이 두 번 붙지 않게), 길이는 조각 합
 const v=job.jobView({id:'x',parts,status:'running',stage:'transcribe'});
 assert.deepEqual(v.jobs,[J1,J2]);assert.equal(v.parts_total,5);assert.equal(v.seconds,820+410+410+820+600);
 // 이미 글이 있거나 구간이 하나뿐이면 바꾸지 않음
 assert.equal(job.splitPart(parts,0,sp.chunkRanges(2460,900)).length,parts.length);
 assert.equal(job.splitPart([{no:1,seconds:0,file:{id:'f'},text:null}],0,[{from:0,to:null,seconds:1}]).length,1);
 // 회의자료 파일(kind attached)도 같은 모양
 const file=job.splitPart([{no:1,seconds:0,file:{id:'abcdefghijk',name:'a.m4a',mime:'audio/mp4',size:1},text:null}],0,sp.chunkRanges(1900,900));
 assert.equal(file.length,3);assert.ok(file.every(p=>p.file.id==='abcdefghijk'&&p.range));assert.equal(job.moreOfSame(file,0),true);
});

// S60-11: 11/12 멈춘 작업 살리기. parts = 첫 조각(0~1241초, 글 있음) + 둘째 조각(1241초~끝, 글 없음, 두 번 끊겨 step_cut).
// [다시] → 둘째 조각부터. 다시 끊기거나(앞 실행 끊김 → 같은 크기로 묻지 않음) 답이 늦으면(gemini_timeout) 둘째 조각만 반으로, 첫 조각 글은 그대로.
test('S60-11 멈춘 41분 녹음 이어하기: 끝난 첫 조각 글은 두고 1241초부터, 늦거나 끊기면 그 조각만 반으로 나눠 끝까지',()=>{
 const J='33333333-3333-4333-8333-333333333333',TOTAL=2470;
 let parts=[{no:1,seconds:1241,job:J,range:{from:0,to:1241},text:'화자1: 첫 21분 글'},{no:1,seconds:1229,job:J,range:{from:1241,to:null},text:null}];
 assert.equal(job.nextPart(parts),1);assert.deepEqual(sp.readRange(parts[1].range),{from:1241,to:null});
 assert.equal(job.doneParts(parts),1);assert.equal(job.partTotal(parts),2);
 // 둘째 조각 반 나누기(끝 null 유지) — 첫 조각은 그대로
 assert.ok(m.HALVE_CODES.includes('gemini_timeout'));
 parts=job.splitPart(parts,1,sp.halveRange(sp.readRange(parts[1].range),TOTAL));
 assert.deepEqual(parts.map(p=>[p.range.from,p.range.to,p.text]),[[0,1241,'화자1: 첫 21분 글'],[1241,1856,null],[1856,null,null]]);
 assert.equal(job.nextPart(parts),1);assert.equal(job.moreOfSame(parts,1),true);
 // 반으로 나눈 조각은 출력 상한도 길이에 맞게(10분 → 20,000토큰), 반 나눔은 4분 아래로 내려가지 않는다
 assert.equal(m.outputCap(615),20500);
 let r={from:1241,to:1856},depth=0;for(;;){const h=sp.halveRange(r,TOTAL);if(!h.length)break;depth++;r=h[0];}
 assert.equal(depth,1);
 // 끝까지 전사 → 시각 순으로 이어짐
 parts[1]={...parts[1],text:'화자1: 가운데'};parts[2]={...parts[2],text:'화자2: 끝'};
 assert.equal(job.nextPart(parts),-1);
 assert.equal(job.joinParts(parts),'화자1: 첫 21분 글\n\n― 21분부터 ―\n화자1: 가운데\n\n― 31분부터 ―\n화자2: 끝');
 // 실제 m4a로: 반으로 나눈 두 조각도 자를 수 있다(시험 소리 비율로)
 const idx=sp.mp4Index(fx('voice-tail.m4a')),k=idx.seconds/TOTAL;
 assert.ok(sp.sliceMp4(idx,1241*k,1856*k));assert.ok(sp.sliceMp4(idx,1856*k,null));
});

test('사용량 번호: 동시에 전사하는 조각마다 다르고 DB 모양(8~80자) 안',()=>{
 const at=new Date('2026-11-12T00:00:00Z'),id='11111111-1111-4111-8111-111111111111';
 const a=m.usageRef(id,at,false,1),b=m.usageRef(id,at,false,2),f=m.usageRef(id,at,true,999);
 assert.notEqual(a,b);assert.ok(a.endsWith('-c1'));assert.ok(f.startsWith(m.FAILED_USAGE_REF_PREFIX)&&f.endsWith('-c999'));
 assert.equal(m.usageRef(id,at),m.usageRef(id,at,false,0));
 for(const r of [a,b,f])assert.match(r,/^[A-Za-z0-9_.:-]{8,80}$/);
 // 조각 사용량도 월 상한(mtg-)·실패(mtgfail-) 규칙 그대로
 assert.equal(m.monthKrw([{ref:f,model:m.TRANSCRIBE_MODEL,input_tokens:100,audio_tokens:100,output_tokens:100}]),0);
});
