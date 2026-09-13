(()=>{
'use strict';
const FILE_API='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/press-conference-files';
const FILE_KEY='press0914-files';

function installStyle(){
  if(document.getElementById('press0914-tools-style'))return;
  const s=document.createElement('style');
  s.id='press0914-tools-style';
  s.textContent=`
  .pc-files{background:#fff;border:1px solid var(--line,#e2e5e9);border-radius:15px;margin:12px 0;padding:16px}
  .pc-files h2{font-size:17px;margin:0 0 6px}.pc-files .desc{font-size:12px;color:var(--muted,#68707a);margin:0 0 12px;line-height:1.55}
  .file-upload-box{border:1px solid #dfe4e9;background:#f8f9fa;border-radius:13px;padding:13px}.file-upload-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(160px,.75fr) auto;gap:8px;align-items:end}
  .file-field{display:flex;flex-direction:column;gap:5px;min-width:0}.file-field label{font-size:11px;font-weight:850;color:#555f69}.file-field input{width:100%;min-width:0;padding:9px 10px;border:1px solid #cbd1d7;border-radius:9px;background:#fff;font:inherit;font-size:13px}
  .file-upload-btn{border:1px solid #202328;background:#202328;color:#fff;border-radius:9px;padding:10px 13px;font:inherit;font-size:13px;font-weight:850;cursor:pointer;white-space:nowrap}.file-upload-btn:disabled{opacity:.5;cursor:default}
  .file-status{font-size:11px;color:#66707b;min-height:17px;margin-top:8px}.file-status.ok{color:#28704b;font-weight:750}.file-status.err{color:#a02835;font-weight:750}.file-note{font-size:11px;color:#7a828c;margin-top:6px}.file-honeypot{position:absolute!important;left:-99999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}
  .file-list{margin-top:12px;border-top:1px solid #edf0f2}.file-row{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f2;align-items:center}.file-badge{display:flex;align-items:center;justify-content:center;min-height:31px;border-radius:8px;background:#eef1f4;color:#59626d;font-size:10px;font-weight:900;letter-spacing:.2px}.file-name{font-size:13px;font-weight:800;overflow-wrap:anywhere}.file-meta{font-size:11px;color:#7a828c;margin-top:3px}.file-empty{font-size:12px;color:#7a828c;padding:13px 0}.file-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:14px}.file-head b{font-size:13px}.file-refresh{border:0;background:transparent;color:#65717d;font:inherit;font-size:11px;font-weight:800;cursor:pointer;padding:4px}.file-download{border:1px solid #cbd5df;background:#fff;color:#294f83;border-radius:8px;padding:7px 10px;font:inherit;font-size:11px;font-weight:850;cursor:pointer;white-space:nowrap}.file-download:disabled{opacity:.55;cursor:default}
  @media(max-width:620px){.file-upload-grid{grid-template-columns:1fr}.file-upload-btn{width:100%}.file-row{grid-template-columns:44px minmax(0,1fr)}.file-download{grid-column:2;justify-self:start}}`;
  document.head.appendChild(s);
}

function fixProgress(){
  document.querySelectorAll('select.status-select').forEach(el=>{el.dataset.done=String(el.value==='true');el.dataset.failed=String(el.value==='failed')});
  const boxes=[...document.querySelectorAll('.item:not(.sub) input[type="checkbox"]')];
  const total=boxes.length,done=boxes.filter(el=>el.checked).length;
  const p=total?Math.round(done/total*100):0;
  const pct=document.getElementById('pct'),remain=document.getElementById('remain'),bar=document.getElementById('bar');
  if(pct)pct.textContent=p+'%';
  if(remain)remain.textContent=String(Math.max(0,total-done));
  if(bar)bar.style.width=p+'%';
}

function installProgressFix(){
  const original=window.update;
  window.update=function(){try{if(typeof original==='function')original()}finally{fixProgress()}};
  document.addEventListener('change',()=>setTimeout(fixProgress,0),true);
  fixProgress();
  setInterval(fixProgress,1000);
}

function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function typeLabel(name){const e=(String(name).split('.').pop()||'').toLowerCase();if(e==='pdf')return'PDF';if(['hwp','hwpx'].includes(e))return'HWP';if(['ppt','pptx'].includes(e))return'PPT';if(['xls','xlsx','csv'].includes(e))return'XLS';if(['doc','docx','txt'].includes(e))return'DOC';if(['jpg','jpeg','png','gif','webp','heic'].includes(e))return'IMG';if(['zip','7z'].includes(e))return'ZIP';if(['mp3','m4a','wav'].includes(e))return'AUDIO';if(['mp4','mov'].includes(e))return'VIDEO';return'FILE'}
function fileDate(v){if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return'';return d.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
async function request(path,options={}){const headers=new Headers(options.headers||{});headers.set('x-upload-key',FILE_KEY);const r=await fetch(FILE_API+'/'+path,{...options,headers,cache:'no-store'});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');return data}
async function downloadFile(file,button){const old=button.textContent;button.disabled=true;button.textContent='받는 중…';try{const r=await fetch(`${FILE_API}/download?id=${encodeURIComponent(file.id)}`,{headers:{'x-upload-key':FILE_KEY},cache:'no-store'});if(!r.ok){let msg='파일을 다운로드하지 못했습니다.';try{const data=await r.json();if(data?.error)msg=data.error}catch{}throw new Error(msg)}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name||'download';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);button.textContent='완료';setTimeout(()=>button.textContent=old,900)}catch(e){alert(e.message||'파일을 다운로드하지 못했습니다.');button.textContent=old}finally{button.disabled=false}}

function injectFiles(){
  if(document.getElementById('related-files'))return;
  const root=document.getElementById('sections');if(!root)return;
  const sec=document.createElement('section');sec.className='pc-files';sec.id='related-files';
  sec.innerHTML=`<h2>관련 파일</h2><p class="desc">보도자료·발언문·현장사진 등 기자회견 관련 파일을 올립니다. 별도 로그인 없이 업로드할 수 있습니다.</p><div class="file-upload-box"><div class="file-upload-grid"><div class="file-field"><label for="relatedFile">파일 선택</label><input id="relatedFile" type="file"></div><div class="file-field"><label for="fileUploader">이름·조직 <span style="font-weight:500;color:#8a929b">(선택)</span></label><input id="fileUploader" type="text" maxlength="80" placeholder="예: 철도노조 홍길동"></div><button type="button" class="file-upload-btn" id="fileUploadBtn">파일 업로드</button></div><input class="file-honeypot" id="fileWebsite" type="text" tabindex="-1" autocomplete="off" aria-hidden="true"><div class="file-status" id="fileUploadStatus"></div><div class="file-note">※ 파일당 최대 30MB · 실행파일 등 위험한 형식은 업로드되지 않음. 다운로드 시 원래 파일명으로 저장됨.</div></div><div class="file-head"><b>최근 업로드</b><button type="button" class="file-refresh" id="fileRefreshBtn">새로고침</button></div><div class="file-list" id="relatedFileList"><div class="file-empty">파일 목록을 불러오는 중…</div></div>`;
  root.insertAdjacentElement('afterend',sec);

  const input=document.getElementById('relatedFile'),uploader=document.getElementById('fileUploader'),btn=document.getElementById('fileUploadBtn'),status=document.getElementById('fileUploadStatus'),list=document.getElementById('relatedFileList');
  async function load(){list.innerHTML='<div class="file-empty">파일 목록을 불러오는 중…</div>';try{const data=await request('list'),files=Array.isArray(data.files)?data.files:[];if(!files.length){list.innerHTML='<div class="file-empty">아직 업로드된 파일이 없습니다.</div>';return}list.innerHTML=files.map(f=>{const meta=[f.size_text||'',fileDate(f.created_at),f.uploader?`업로드: ${f.uploader}`:''].filter(Boolean).join(' · ');return `<div class="file-row"><div class="file-badge">${typeLabel(f.name)}</div><div><div class="file-name">${escapeHtml(f.name||'파일')}</div><div class="file-meta">${escapeHtml(meta)}</div></div><button type="button" class="file-download" data-file-id="${escapeHtml(f.id)}">다운로드</button></div>`}).join('');list.querySelectorAll('.file-download').forEach((b,i)=>b.onclick=()=>downloadFile(files[i],b))}catch(e){list.innerHTML=`<div class="file-empty">목록을 불러오지 못했습니다. ${escapeHtml(e.message||'')}</div>`}}
  btn.onclick=async()=>{const file=input.files?.[0];status.className='file-status';if(!file){status.textContent='업로드할 파일을 선택해 주세요.';status.classList.add('err');return}if(file.size>30*1024*1024){status.textContent='파일은 최대 30MB까지 업로드할 수 있습니다.';status.classList.add('err');return}btn.disabled=true;input.disabled=true;uploader.disabled=true;status.textContent='업로드 중…';const form=new FormData();form.append('file',file,file.name);form.append('uploader',uploader.value.trim());form.append('website',document.getElementById('fileWebsite').value);try{const data=await request('upload',{method:'POST',body:form});status.textContent=`업로드 완료: ${data.file?.name||file.name}`;status.classList.add('ok');input.value='';await load()}catch(e){status.textContent=e.message||'업로드하지 못했습니다.';status.classList.add('err')}finally{btn.disabled=false;input.disabled=false;uploader.disabled=false}};
  document.getElementById('fileRefreshBtn').onclick=load;
  load();

  if(!document.querySelector('script[src*="file-dropzone.js"]')){const s=document.createElement('script');s.src='/work/assets/file-dropzone.js?v=20260914-2';document.body.appendChild(s)}
}

function boot(){if(!location.pathname.includes('/workforce/press-conference-0914/'))return;if(location.pathname.includes('/press-release/'))return;installStyle();installProgressFix();injectFiles()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
