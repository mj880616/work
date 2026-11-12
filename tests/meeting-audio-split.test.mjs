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

test('사용량 번호: 동시에 전사하는 조각마다 다르고 DB 모양(8~80자) 안',()=>{
 const at=new Date('2026-11-12T00:00:00Z'),id='11111111-1111-4111-8111-111111111111';
 const a=m.usageRef(id,at,false,1),b=m.usageRef(id,at,false,2),f=m.usageRef(id,at,true,999);
 assert.notEqual(a,b);assert.ok(a.endsWith('-c1'));assert.ok(f.startsWith(m.FAILED_USAGE_REF_PREFIX)&&f.endsWith('-c999'));
 assert.equal(m.usageRef(id,at),m.usageRef(id,at,false,0));
 for(const r of [a,b,f])assert.match(r,/^[A-Za-z0-9_.:-]{8,80}$/);
 // 조각 사용량도 월 상한(mtg-)·실패(mtgfail-) 규칙 그대로
 assert.equal(m.monthKrw([{ref:f,model:m.TRANSCRIBE_MODEL,input_tokens:100,audio_tokens:100,output_tokens:100}]),0);
});
