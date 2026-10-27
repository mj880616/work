// Web1 편집 로그인 정리: 2026-10-21 Supabase 이메일 로그인을 끈 뒤 Web1 편집은 Google 로그인만 쓴다.
// 브라우저에 실리는 저장소 파일(Web1 루트 페이지·assets·app)에 이메일·비밀번호 로그인 경로가 다시 들어오지 않게 막는다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
// 브라우저 코드가 아닌 폴더, 외부 라이브러리 묶음은 제외한다.
const skipDirs=new Set(['.git','node_modules','docs','tests','scripts','supabase','android-app','windows-app','basket-pc','analysis','cloudflare','.github','rhwp-0.8.7']);
const emailAuth=/grant_type=password|\/auth\/v1\/(?:recover|signup|otp|magiclink)\b|signInWithPassword|signInWithOtp|resetPasswordForEmail|\bsignUp\s*\(/;

function browserFiles(dir=root,out=[]){
  for(const name of readdirSync(dir)){
    if(skipDirs.has(name))continue;
    const full=join(dir,name),st=statSync(full);
    if(st.isDirectory())browserFiles(full,out);
    else if(/\.(?:html|js|mjs)$/.test(name))out.push(full);
  }
  return out;
}

test('과거 Web1 이메일·비밀번호 편집 인증 모듈은 저장소에 없다',()=>{
  assert.equal(existsSync(join(root,'app/public-page-auth.js')),false);
});

test('Web1·Web2 브라우저 코드에 이메일 로그인·가입·비밀번호 재설정 경로가 없다',()=>{
  const files=browserFiles();
  assert.ok(files.length>50,'scan found too few files: '+files.length);
  const hits=files.filter(file=>emailAuth.test(readFileSync(file,'utf8'))).map(file=>relative(root,file));
  assert.deepEqual(hits,[]);
});

test('Supabase 로그인 화면으로 보내는 Web1 편집 코드는 Google 제공자만 쓴다',()=>{
  const auth=readFileSync(join(root,'app/web1-admin-auth.js'),'utf8');
  assert.match(auth,/provider:'google'/);
  assert.match(auth,/\/auth\/v1\/authorize\?provider=google/);
  for(const file of browserFiles()){
    const text=readFileSync(file,'utf8');
    for(const m of text.matchAll(/\/auth\/v1\/authorize\?provider=([a-z_]+)/g))assert.equal(m[1],'google',relative(root,file));
  }
});

test('Web1 공용 편집기는 Google 관리자 인증 모듈만 불러온다',()=>{
  const editor=readFileSync(join(root,'app/public-page-editor.js'),'utf8');
  assert.match(editor,/web1-admin-auth\.js/);
  assert.match(editor,/signInWithGoogle\(\)/);
  assert.doesNotMatch(editor,/public-page-auth\.js|KPTUPublicAuth|ppeAuth|ppe-auth/);
});
