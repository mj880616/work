import test from 'node:test';
import assert from 'node:assert/strict';
import {tiff,jpeg,gpsSeoul} from './jpeg-exif-fixture.mjs';

// S50-31 PHOTO-정보고치기 ②: _shared/jpeg-exif.ts — JPEG EXIF 찍은 시각·위치만 고치고 그림 바이트는 그대로인지. 지어낸 사진만 쓴다.
const {readJpegMeta,writeJpegMeta,sameOutsideExif,seoulExifTime,exifTimeToIso}=await import('../../supabase/functions/_shared/jpeg-exif.ts');

const camera=(le=true,extra={})=>jpeg(tiff({le,
 ifd0:{0x010f:[2,'SYNTH'],0x0110:[2,'Cam 1'],0x0132:[2,'2026:10:01 19:00:00']},
 exif:{0x9003:[2,'2026:10:01 19:00:00'],0x9004:[2,'2026:10:01 19:00:00'],0x9011:[2,'+09:00']},
 gps:gpsSeoul,makerNote:new Uint8Array([9,8,7,6,5,4,3,2,1,0,11,12]),...extra}).tiff);
const find=(hay,needle)=>{outer:for(let i=0;i+needle.length<=hay.length;i++){for(let k=0;k<needle.length;k++)if(hay[i+k]!==needle[k])continue outer;return i;}return -1;};

test('time words: Seoul wall clock both ways',()=>{
 assert.equal(seoulExifTime('2026-10-01T10:00:00.700Z'),'2026:10:01 19:00:00');
 assert.equal(seoulExifTime('1980-01-01T00:00:00Z'),null);
 assert.equal(seoulExifTime('nope'),null);
 assert.equal(exifTimeToIso('2026:10:01 19:00:00',null),'2026-10-01T10:00:00.000Z');
 assert.equal(exifTimeToIso('2026:10:01 19:00:00','+01:00'),'2026-10-01T18:00:00.000Z');
 assert.equal(exifTimeToIso('0000:00:00 00:00:00',null),null);
});

for(const le of [true,false]){
 test(`read: time, place and camera (${le?'II':'MM'})`,()=>{
  const r=readJpegMeta(camera(le));
  assert.equal(r.ok,true);
  assert.deepEqual(r.meta,{taken:'2026-10-01T10:00:00.000Z',lat:37.56,lon:126.98,make:'SYNTH',model:'Cam 1'});
 });
 test(`write time: in place, picture and maker note untouched (${le?'II':'MM'})`,()=>{
  const src=camera(le),r=writeJpegMeta(src,{taken:'2026-10-01T02:00:00Z'});
  assert.equal(r.ok,true,r.reason);
  assert.equal(r.bytes.length,src.length,'same size: values overwritten where they were');
  assert.ok(sameOutsideExif(src,r.bytes));
  assert.equal(r.before.taken,'2026-10-01T10:00:00.000Z');
  assert.equal(r.after.taken,'2026-10-01T02:00:00.000Z');
  assert.equal(r.after.lat,37.56);
  assert.ok(find(r.bytes,new Uint8Array([9,8,7,6,5,4,3,2,1,0,11,12]))===find(src,new Uint8Array([9,8,7,6,5,4,3,2,1,0,11,12])),'maker note stays at the same place');
  assert.equal(find(r.bytes,new TextEncoder().encode('2026:10:01 19:00:00')),-1,'no old time left');
 });
}

test('write time when the file has no original-time field or no Exif list: adds them, keeps the rest',()=>{
 const noOriginal=jpeg(tiff({ifd0:{0x010f:[2,'SYNTH']},exif:{0x9004:[2,'2026:10:01 19:00:00']}}).tiff);
 let r=writeJpegMeta(noOriginal,{taken:'2026-11-02T03:04:05Z'});
 assert.equal(r.ok,true,r.reason);assert.equal(r.after.taken,'2026-11-02T03:04:05.000Z');assert.equal(r.after.make,'SYNTH');
 assert.ok(sameOutsideExif(noOriginal,r.bytes));
 const noExif=jpeg(tiff({ifd0:{0x0110:[2,'Cam']}}).tiff);
 r=writeJpegMeta(noExif,{taken:'2026-11-02T03:04:05Z'});
 assert.equal(r.ok,true,r.reason);assert.equal(r.after.taken,'2026-11-02T03:04:05.000Z');assert.equal(r.after.model,'Cam');
});

test('write place: overwrite, add when missing, south/west, then clear wipes the old place',()=>{
 let r=writeJpegMeta(camera(),{loc:{lat:-33.865143,lon:-151.2099}});
 assert.equal(r.ok,true,r.reason);
 assert.ok(Math.abs(r.after.lat+33.865143)<1e-5&&Math.abs(r.after.lon+151.2099)<1e-5);
 assert.equal(r.after.taken,r.before.taken,'time untouched');
 const noGps=jpeg(tiff({ifd0:{0x010f:[2,'SYNTH']},exif:{0x9003:[2,'2026:10:01 19:00:00']}}).tiff);
 r=writeJpegMeta(noGps,{loc:{lat:35.1,lon:129.04}});
 assert.equal(r.ok,true,r.reason);assert.equal(r.after.lat,35.1);assert.equal(r.after.lon,129.04);assert.equal(r.after.taken,'2026-10-01T10:00:00.000Z');
 assert.ok(sameOutsideExif(noGps,r.bytes));
 const src=camera(),cleared=writeJpegMeta(src,{loc:null});
 assert.equal(cleared.ok,true,cleared.reason);
 assert.equal(cleared.after.lat,null);assert.equal(cleared.after.lon,null);
 // 옛 위도 값(37/1, 33/1, 3600/100 — 작은 끝 순서)이 파일 어디에도 남지 않는다.
 assert.equal(find(cleared.bytes,new Uint8Array([37,0,0,0,1,0,0,0,33,0,0,0,1,0,0,0])),-1);
 assert.notEqual(find(src,new Uint8Array([37,0,0,0,1,0,0,0,33,0,0,0,1,0,0,0])),-1);
 // 위치가 없는 사진의 지우기는 그대로(성공).
 assert.equal(writeJpegMeta(noGps,{loc:null}).ok,true);
});

test('time and place together; repeated edits stay readable and the Exif part stays small',()=>{
 let bytes=camera();
 for(let i=0;i<20;i++){const r=writeJpegMeta(bytes,{taken:new Date(Date.parse('2026-01-01T00:00:00Z')+i*3600e3).toISOString(),loc:i%2?null:{lat:37+i/100,lon:127}});assert.equal(r.ok,true,r.reason);bytes=r.bytes;}
 const m=readJpegMeta(bytes).meta;assert.equal(m.taken,'2026-01-01T19:00:00.000Z');assert.equal(m.lat,null);
 assert.ok(bytes.length<camera().length+4000);
});

test('cannot edit: not JPEG, no Exif, broken Exif, place in XMP, bad request',()=>{
 assert.equal(writeJpegMeta(new Uint8Array([0x89,0x50,0x4e,0x47,0,0]),{taken:'2026-01-01T00:00:00Z'}).reason,'not_jpeg');
 assert.equal(writeJpegMeta(jpeg(null),{taken:'2026-01-01T00:00:00Z'}).reason,'no_exif');
 assert.deepEqual(readJpegMeta(jpeg(null)),{ok:true,meta:{taken:null,lat:null,lon:null,make:null,model:null}});
 const broken=camera();broken[broken.indexOf(0x49)+2]=0;
 assert.equal(writeJpegMeta(jpeg(new Uint8Array([0x49,0x49,42,0,200,0,0,0])),{taken:'2026-01-01T00:00:00Z'}).reason,'exif_invalid');
 const xmp=jpeg(tiff({ifd0:{0x010f:[2,'S']},exif:{0x9003:[2,'2026:10:01 19:00:00']}}).tiff,{xmp:'<x exif:GPSLatitude="37,33N"/>'});
 assert.equal(writeJpegMeta(xmp,{loc:null}).reason,'xmp_location');
 assert.equal(writeJpegMeta(xmp,{taken:'2026-01-01T00:00:00Z'}).ok,true,'time can still change');
 assert.equal(writeJpegMeta(camera(),{}).reason,'change_invalid');
 assert.equal(writeJpegMeta(camera(),{taken:'yesterday'}).reason,'change_invalid');
 assert.equal(writeJpegMeta(camera(),{loc:{lat:91,lon:0}}).reason,'change_invalid');
});

test('module stays small and self-contained (no imports, no network, no files)',async()=>{
 const src=await (await import('node:fs/promises')).readFile(new URL('../../supabase/functions/_shared/jpeg-exif.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/^\s*import\s/m);
 assert.doesNotMatch(src,/fetch\(|Deno\.|readFile|writeFile|console\./);
});

test('read the first part only: Exif found before the cut; cut inside Exif is not an error for partial reads',()=>{
 const full=camera();
 assert.deepEqual(readJpegMeta(full.subarray(0,full.length-100),true),readJpegMeta(full));
 assert.equal(readJpegMeta(full.subarray(0,full.length-100)).ok,true,'SOS reached before the cut');
 assert.equal(readJpegMeta(full.subarray(0,40),true).ok,true);
 assert.equal(readJpegMeta(full.subarray(0,40),false).reason,'not_jpeg');
});
