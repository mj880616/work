// S50-31: 시험용 가짜 JPEG 만들기(EXIF 칸 목록을 손으로 적음). 사진·이름·위치는 모두 지어낸 값이다.
// ifd 모양: {tag:[type, value]} — value는 ASCII 글자, 숫자 배열(SHORT/LONG/BYTE), [[n,d],…](RATIONAL), Uint8Array(UNDEFINED).
const SIZE={1:1,2:1,3:2,4:4,5:8,7:1};
export function tiff({le=true,ifd0={},exif=null,gps=null,makerNote=null}={}){
 // 배치: 머리(8) → IFD0 → Exif IFD → GPS IFD → 값 영역. 포인터 칸은 자동으로 넣는다.
 const ifds=[['ifd0',{...ifd0}]];
 if(exif)ifds.push(['exif',{...exif,...(makerNote?{0x927c:[7,makerNote]}:{})}]);
 if(gps)ifds.push(['gps',{...gps}]);
 if(exif)ifds[0][1][0x8769]=[4,[0]];
 if(gps)ifds[0][1][0x8825]=[4,[0]];
 const sizeOf=o=>2+Object.keys(o).length*12+4;
 let at=8;const where={};
 for(const [k,o] of ifds){where[k]=at;at+=sizeOf(o);}
 const valueStart=at;
 const bytes=[];const w16=(o,v)=>{if(le){bytes[o]=v&255;bytes[o+1]=v>>8&255;}else{bytes[o]=v>>8&255;bytes[o+1]=v&255;}};
 const w32=(o,v)=>{for(let k=0;k<4;k++)bytes[o+(le?k:3-k)]=v>>>(8*k)&255;};
 bytes.push(...(le?[0x49,0x49]:[0x4d,0x4d]));w16(2,42);w32(4,8);
 let tail=valueStart;const extra=[];
 const encode=(type,v)=>{
  if(type===2){const s=v+'\0';return {count:s.length,data:[...s].map(c=>c.charCodeAt(0))};}
  if(type===7)return {count:v.length,data:[...v]};
  if(type===1)return {count:v.length,data:[...v]};
  const out=[];const p16=x=>le?out.push(x&255,x>>8&255):out.push(x>>8&255,x&255);const p32=x=>{for(let k=0;k<4;k++)out.push(le?(x>>>(8*k))&255:(x>>>(8*(3-k)))&255);};
  if(type===3)v.forEach(p16);if(type===4)v.forEach(p32);if(type===5)v.forEach(([n,d])=>{p32(n);p32(d);});
  return {count:type===5?v.length:v.length,data:out};
 };
 const makerAt={};
 for(const [k,o] of ifds){
  const tags=Object.keys(o).map(Number).sort((a,b)=>a-b);let e=where[k];w16(e,tags.length);e+=2;
  for(const tag of tags){
   let [type,v]=o[tag];
   if(tag===0x8769)v=[where.exif];if(tag===0x8825)v=[where.gps];
   const {count,data}=encode(type,v);w16(e,tag);w16(e+2,type);w32(e+4,count);
   if(data.length<=4){for(let i=0;i<4;i++)bytes[e+8+i]=data[i]??0;}
   else{if(tail%2)tail++;w32(e+8,tail);if(tag===0x927c)makerAt.offset=tail;data.forEach((b,i)=>extra[tail+i-valueStart]=b);tail+=data.length;}
   e+=12;
  }
  w32(e,0);
 }
 for(let i=0;i<valueStart;i++)bytes[i]=bytes[i]??0;
 const out=new Uint8Array(tail);out.set(bytes.slice(0,valueStart));
 extra.forEach((b,i)=>{if(b!==undefined)out[valueStart+i]=b;});
 return {tiff:out,makerAt:makerAt.offset};
}
// SOI + (APP0 JFIF) + APP1 Exif + (APP1 XMP) + 가짜 DQT·SOS 그림 자료 + EOI.
export function jpeg(t,{xmp=null,app0=true}={}){
 const seg=(m,body)=>[0xff,m,(body.length+2)>>8,(body.length+2)&255,...body];
 const parts=[0xff,0xd8];
 if(app0)parts.push(...seg(0xe0,[...'JFIF\0'].map(c=>c.charCodeAt(0)).concat([1,1,0,0,1,0,1,0,0])));
 if(t)parts.push(...seg(0xe1,[0x45,0x78,0x69,0x66,0,0,...t]));
 if(xmp)parts.push(...seg(0xe1,[...('http://ns.adobe.com/xap/1.0/\0'+xmp)].map(c=>c.charCodeAt(0))));
 parts.push(...seg(0xdb,Array.from({length:65},(_,i)=>i)));
 parts.push(...seg(0xda,[1,1,0,0,63,0]));
 for(let i=0;i<300;i++)parts.push((i*37)%255);
 parts.push(0xff,0xd9);
 return new Uint8Array(parts);
}
export const gpsSeoul={1:[2,'N'],2:[5,[[37,1],[33,1],[3600,100]]],3:[2,'E'],4:[5,[[126,1],[58,1],[4800,100]]],6:[5,[[50,1]]]};
