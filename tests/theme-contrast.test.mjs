import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {THEMES,DEFAULT_THEME,validValue} from '../app/view-prefs.js';
// UI-화면색10(2026-10-27 15:35 재정리: 수수한 다섯 + 산뜻한 다섯): 화면 색 10가지의 일관성과 글자 대비. 허용 목록은 view-prefs.js THEMES 한 곳이고, 아래는 모두 그 목록을 읽는다.
const css=readFileSync('app/theme-tokens.css','utf8');
const indexHtml=readFileSync('app/index.html','utf8');
const topbar=readFileSync('app/topbar-actions.js','utf8');
const loader=readFileSync('app/loader-v2.js','utf8');

// 값 읽기: 밝은 화면 = 색마다 한 블록, 어두운 화면 = 공통 바탕 블록 + 색마다 강조 블록(@media 안).
const vars=body=>Object.fromEntries([...body.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const block=(source,selector,{optional=false}={})=>{
  const at=source.indexOf(selector+'{');
  if(at===-1){assert.ok(optional,'missing block '+selector);return {}}
  const end=source.indexOf('}',at);return vars(source.slice(at+selector.length+1,end));
};
const darkStart=css.indexOf('@media (prefers-color-scheme:dark)');
assert.ok(darkStart>0,'dark section exists');
const lightCss=css.slice(0,darkStart),darkCss=css.slice(darkStart);
const light=name=>name===DEFAULT_THEME?block(lightCss,':root,[data-theme="'+name+'"]'):block(lightCss,'[data-theme="'+name+'"]');
// 기본(올리브)의 어두운 강조 값은 어두운 공통 블록에 있어 색별 블록이 없다.
const dark=name=>({...block(darkCss,'  :root'),...block(darkCss,':root[data-theme="'+name+'"]',{optional:name===DEFAULT_THEME})});
// 대비 비율(WCAG 2.x).
const rgb=hex=>{assert.match(hex,/^#[0-9a-f]{6}$/i,'plain 6-digit hex: '+hex);return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)};
const channel=v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;
const luminance=hex=>{const [r,g,b]=rgb(hex).map(channel);return 0.2126*r+0.7152*g+0.0722*b};
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
const need=(label,a,b,min)=>assert.ok(ratio(a,b)>=min,`${label}: ${a} on ${b} = ${ratio(a,b).toFixed(2)} (need ${min})`);

test('the allowed color list is one list of ten that the screen, the pick window and the CSS all follow',()=>{
  assert.equal(THEMES.length,10);
  assert.equal(THEMES[0],DEFAULT_THEME,'the first one is the default');
  for(const name of THEMES)assert.ok(validValue('theme',name),name);
  // 고르는 창: 같은 이름, 같은 차례, 칸마다 색 견본 점(2개)과 이름.
  const choices=[...indexHtml.matchAll(/<button type="button" data-theme-choice="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(choices.map(m=>m[1]),[...THEMES]);
  for(const [,name,label,inner] of choices){
    assert.ok(label.length>0);
    assert.match(inner,new RegExp(`<span class="theme-swatch" data-theme="${name}" aria-hidden="true"><i></i><i></i></span><span>[^<]+</span>`),name);
  }
  // CSS: 색마다 밝은 값 한 블록, 그리고 기본(올리브)을 뺀 모든 색이 어두운 값 블록을 가진다. 모르는 색 블록은 없다.
  const lightNames=[...lightCss.matchAll(/\[data-theme="([a-z]+)"\]\{/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(lightNames)].sort(),[...THEMES].sort());
  const darkNames=[...darkCss.matchAll(/:root\[data-theme="([a-z]+)"\]\{/g)].map(m=>m[1]);
  assert.deepEqual(darkNames.sort(),THEMES.filter(name=>name!==DEFAULT_THEME).sort());
  // 화면 코드에 색 이름 목록을 따로 적지 않는다(목록은 THEMES 하나).
  assert.match(topbar,/import \{[^}]*\bTHEMES\b[^}]*\} from '\.\/view-prefs\.js'/);
  assert.match(topbar,/THEMES\.includes\(theme\)/);
  assert.doesNotMatch(topbar,/'olive'\s*,\s*'navy'/);
});

// 보조 글자는 4.5:1을 목표로 하되 0.05 여유를 둔다(산뜻한 다섯은 모두 4.5 이상, 아래 별도 시험).
const MUTED_MIN=4.45;
// 레몬은 산뜻한 노랑이라 강조색(버튼 바탕)이 밝은 바탕과 3:1이 될 수 없다(견본 #F5CC00은 약 1.5:1, 지금 버터·겨자 #e3c25a는 약 1.6:1). 그래서 글자 쪽에서 보장한다:
// 버튼·선택 표시 글자는 진한 갈색(7:1 이상), 글자·링크·구역 제목·탭 글자는 진한 노랑(--kptu-primary-text). 그림 요소(고른 줄 막대 등)는 레몬만 1.3:1로 낮추고 나머지는 3:1을 지킨다.
const NONTEXT_MIN=name=>name==='lemon'?1.3:3;
const VIVID=['sky','mint','coral','lemon','red'];
const LIGHT_KEYS=['--kptu-bg','--kptu-surface','--kptu-surface-subtle','--kptu-ink','--kptu-muted','--kptu-faint','--kptu-border','--kptu-border-strong','--kptu-primary','--kptu-primary-hover','--kptu-primary-ink','--kptu-primary-soft','--kptu-on-primary','--kptu-link'];
for(const name of THEMES){
  test(`${name}: light colors are complete and readable`,()=>{
    const c=light(name);
    for(const key of LIGHT_KEYS)assert.ok(c[key],key+' missing');
    for(const surface of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle']){
      need('body text',c['--kptu-ink'],c[surface],7);
      need('muted text',c['--kptu-muted'],c[surface],MUTED_MIN);
      need('link',c['--kptu-link'],c[surface],4.5);
      need('section color',c['--kptu-primary-ink'],c[surface],4.5);
    }
    need('section color on soft',c['--kptu-primary-ink'],c['--kptu-primary-soft'],4.5);
    need('link on soft',c['--kptu-link'],c['--kptu-primary-soft'],4.5);
    need('body text on soft',c['--kptu-ink'],c['--kptu-primary-soft'],7);
    need('button text',c['--kptu-on-primary'],c['--kptu-primary'],4.5);
    need('button text (hover)',c['--kptu-on-primary'],c['--kptu-primary-hover'],4.5);
    need('picked button on page',c['--kptu-primary'],c['--kptu-bg'],NONTEXT_MIN(name));
    need('border visible',c['--kptu-border-strong'],c['--kptu-bg'],1.2);
  });
  test(`${name}: dark colors are complete and readable`,()=>{
    const c=dark(name);
    for(const key of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle','--kptu-ink','--kptu-muted','--kptu-primary','--kptu-primary-hover','--kptu-primary-ink','--kptu-primary-soft','--kptu-on-primary','--kptu-link'])assert.ok(c[key],key+' missing');
    for(const surface of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle','--kptu-primary-soft']){
      need('body text',c['--kptu-ink'],c[surface],7);
      need('link',c['--kptu-link'],c[surface],4.5);
      need('section color',c['--kptu-primary-ink'],c[surface],4.5);
    }
    for(const surface of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle'])need('muted text',c['--kptu-muted'],c[surface],MUTED_MIN);
    need('button text',c['--kptu-on-primary'],c['--kptu-primary'],4.5);
    need('button text (hover)',c['--kptu-on-primary'],c['--kptu-primary-hover'],4.5);
    need('picked button on page',c['--kptu-primary'],c['--kptu-bg'],NONTEXT_MIN(name));
  });
}

test('colors are distinct from each other (light page color and button color)',()=>{
  const seen=new Map();
  for(const name of THEMES){
    for(const key of ['--kptu-bg','--kptu-primary']){
      const value=light(name)[key].toLowerCase();
      assert.ok(!seen.has(key+value),`${name} repeats ${seen.get(key+value)} for ${key}`);seen.set(key+value,name);
    }
  }
});

test('the phone status bar follows the picked color: starts from the page color, re-synced when a color is picked and when the saved one is applied',()=>{
  // 두 가지 화면 모드의 meta가 있고, 바뀐 색의 --kptu-bg를 읽어 맞춘다(색마다 값을 따로 적지 않는다).
  assert.match(indexHtml,/<meta name="theme-color" content="#f3f1ea" media="\(prefers-color-scheme: light\)">/);
  assert.equal(light(DEFAULT_THEME)['--kptu-bg'],'#f3f1ea','the first meta value is the default color\'s page color');
  assert.match(indexHtml,/<meta name="theme-color" content="#161613" media="\(prefers-color-scheme: dark\)">/);
  assert.equal(dark(DEFAULT_THEME)['--kptu-bg'],'#161613');
  assert.match(topbar,/getPropertyValue\('--kptu-bg'\)/);
  assert.match(topbar,/window\.addEventListener\('kptu:theme-applied',syncThemeColor\)/);
  const click=topbar.slice(topbar.indexOf("const option=event.target.closest('[data-theme-choice]')"));
  assert.ok(click.indexOf('syncThemeColor()')>click.indexOf('dataset.theme=theme'),'synced after the color changes');
  assert.match(loader,/setAttribute\('data-theme',savedTheme\);window\.dispatchEvent\(new CustomEvent\('kptu:theme-applied'\)\)/);
  assert.ok(loader.indexOf("'kptu:theme-applied'")<loader.indexOf("app?.classList.add('kptu-shell-ready')"),'before the first screen is shown');
});

test('a refused color goes back and tells the person',()=>{
  assert.match(topbar,/viewPrefs\.set\('theme',theme,\{rejectable:true\}\)/);
  assert.match(topbar,/void viewPrefs\.flush\(\)/);
  const handler=topbar.slice(topbar.indexOf("addEventListener('kptu:view-prefs-rejected'"));
  assert.match(handler,/THEMES\.includes\(saved\)\?saved:DEFAULT_THEME/);
  assert.match(handler,/syncThemeColor\(\)/);
  assert.match(handler,/themeToast\('/);
});

test('the five vivid colors: muted text 4.5:1 in both modes, white (dark brown on lemon) button text, readable accent text',()=>{
  assert.deepEqual(THEMES.slice(5),VIVID,'vivid colors come after the five quiet ones');
  for(const name of VIVID){
    for(const surface of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle']){
      need(name+' light muted',light(name)['--kptu-muted'],light(name)[surface],4.5);
      need(name+' dark muted',dark(name)['--kptu-muted'],dark(name)[surface],4.5);
    }
    // 글자로 쓰는 강조색(--kptu-primary-text)은 산뜻한 다섯 모두 읽히는 글자색(--kptu-primary-ink)을 따른다. 어두운 화면도 같은 선언이 쓰인다.
    assert.match(css.slice(css.indexOf('[data-theme="'+name+'"]{')).split('}')[0],/--kptu-primary-text:var\(--kptu-primary-ink\);/,name);
    for(const [mode,c] of [['light',light(name)],['dark',dark(name)]])
      for(const surface of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle','--kptu-primary-soft'])need(`${name} ${mode} accent text`,c['--kptu-primary-ink'],c[surface],4.5);
    // 버튼 글자: 밝은 화면은 흰 글자(레몬만 진한 갈색 7:1 이상), 어두운 화면은 어두운 글자.
    if(name==='lemon'){
      assert.equal(light(name)['--kptu-on-primary'].toLowerCase(),'#3d3100');
      need('lemon light button text',light(name)['--kptu-on-primary'],light(name)['--kptu-primary'],7);
      need('lemon light button text (hover)',light(name)['--kptu-on-primary'],light(name)['--kptu-primary-hover'],7);
      need('lemon dark button text',dark(name)['--kptu-on-primary'],dark(name)['--kptu-primary'],7);
    }else assert.equal(light(name)['--kptu-on-primary'].toLowerCase(),'#ffffff',name);
    // 바탕은 같은 색을 아주 연하게: 밝은 화면 페이지 바탕이 거의 흰색(가장 어두운 채널이 220 이상)이고 강조색보다 훨씬 밝다.
    const bgRgb=rgb(light(name)['--kptu-bg']).map(v=>v*255);
    assert.ok(Math.min(...bgRgb)>=220,name+' page color is very light');
    assert.ok(ratio(light(name)['--kptu-bg'],light(name)['--kptu-primary'])>=1.4,name);
  }
});
test('the text accent token: default follows the main color, only the vivid five switch to the readable one; text uses the token',()=>{
  assert.match(css.slice(0,css.indexOf('[data-theme="navy"]{')),/--kptu-primary-text:var\(--kptu-primary\);/,'default declared once in the first block');
  assert.equal((css.match(/--kptu-primary-text:/g)||[]).length,1+VIVID.length,'declared only for the default and the vivid five');
  // 강조색을 글자 색으로 쓰던 규칙은 모두 토큰을 읽는다(레몬에서 노란 글자가 되지 않게). 배경·테두리·accent-color 쓰임은 대상 아님.
  const textUse=[];
  for(const file of readdirSync('app').filter(name=>name.endsWith('.css')&&name!=='theme-tokens.css')){
    for(const m of readFileSync('app/'+file,'utf8').matchAll(/(^|[;{\s])color:\s*var\(--kptu-primary\)/g))textUse.push(file+':'+m.index);
  }
  assert.deepEqual(textUse,[],'use var(--kptu-primary-text) for text');
});

// 빨강 테마: 강조색(빨강)과 경고색이 같은 계열이라 위험 동작에는 색 말고 모양(이중 테두리·삼각 느낌표)을 더한다. 다른 테마는 건드리지 않는다.
test('red theme marks dangerous actions with a shape, not only a color',()=>{
  const ui=readFileSync('app/ui-standard.css','utf8');
  const at=ui.indexOf(':root[data-theme="red"] :is(');
  assert.ok(at>0,'red rules exist');
  const rules=ui.slice(at);
  assert.equal((rules.match(/\[data-theme="/g)||[]).length,2,'only the red theme is named');
  assert.match(rules,/box-shadow:inset 0 0 0 1px currentColor;/);
  assert.match(rules,/::before\{[^}]*mask:var\(--ds-warn-icon\)/);
  assert.doesNotMatch(rules,/#[0-9a-f]{3,8}\b|rgba?\(/i,'colors follow the text color, no new color values');
  assert.match(css,/--ds-warn-icon:url\("data:image\/svg\+xml,/);
  // 이미 있는 위험 동작 이름을 모두 덮는다: 버튼(.danger·.ci-delete·.ps-danger·.ps3-danger-btn)과 삭제 메뉴 줄.
  for(const name of ['button.danger','.ci-delete','.ps-danger','.ps3-danger-btn','.gt-menu-danger','.ps3-record-danger','.basket-menu-danger','.task-inline-danger','.lu-menu-danger','.rb-menu-danger','.tl-danger','.wd-danger'])assert.ok(rules.includes(name),name);
});

test('the database check allows exactly the colors in THEMES (same names, same order) and resets only the colors taken out',()=>{
  const sql=readFileSync('supabase/migrations/20261027070000_profile_view_prefs_theme_refresh.sql','utf8').replace(/--.*$/gm,'');
  const lists=[...sql.matchAll(/view_prefs ->> 'theme' in \(([^)]*)\)/g)].map(m=>[...m[1].matchAll(/'([a-z]+)'/g)].map(x=>x[1]));
  // 같은 목록이 세 곳: 바꾸는 행 고르기(뺀 색), 새 검사(허용 색), 사후 확인(뺀 색).
  const removed=['terracotta','sand','mugwort','rose','mustard'];
  assert.deepEqual(lists.filter(l=>l.length===10),[[...THEMES]],'the new check allows exactly THEMES');
  assert.deepEqual(lists.filter(l=>l.length===5),[removed,removed]);
  for(const name of removed)assert.ok(!THEMES.includes(name),name+' is no longer allowed');
  // 직전 열 가지(이전 migration)에서 빠진 색 = 뺀 색, 새로 생긴 색 = 산뜻한 다섯.
  const before=[...readFileSync('supabase/migrations/20261027040000_profile_view_prefs_theme10.sql','utf8').replace(/--.*$/gm,'').match(/view_prefs ->> 'theme' in \(([^)]*)\)/)[1].matchAll(/'([a-z]+)'/g)].map(x=>x[1]);
  assert.deepEqual(before.filter(name=>!THEMES.includes(name)),removed);
  assert.deepEqual(THEMES.filter(name=>!before.includes(name)),VIVID);
  // 행 바꾸기는 WHERE가 있는 theme 한 칸 바꾸기뿐이다.
  const updates=sql.match(/update public\.app_profiles[^;]*;/g)||[];
  assert.equal(updates.length,1);
  assert.match(updates[0],/set view_prefs = jsonb_set\(view_prefs, '\{theme\}', '"olive"'::jsonb\)\s+where view_prefs ->> 'theme' in/);
});

test('the browser-test helper reads the same list',async()=>{
  const helper=await import('./app-e2e/helpers/theme-list.mjs');
  assert.deepEqual(helper.THEMES,[...THEMES]);
});

// MTG-3칸정리 ① → UI-선택표시톤다운: 고른 줄 표시(공용 .kptu-pick-row) = 연한 강조 바탕 + 왼쪽 얇은 선 + 보통 글자. 값은 선택 표시 토큰.
test('고른 줄 표시: 바탕·왼쪽 줄·글자가 열 가지 색 모두에서 보인다',()=>{
  const rule=readFileSync('app/ui-standard.css','utf8').match(/#appView \.kptu-pick-row\[aria-current="true"\]\{([^}]*)\}/);
  assert.ok(rule,'shared selected-row rule');
  assert.match(rule[1],/background:var\(--ds-select-bg\)/);assert.match(rule[1],/box-shadow:var\(--kptu-shadow-select\)/);assert.match(rule[1],/color:var\(--ds-select-ink\)/);
  for(const name of THEMES)for(const [mode,c] of [['light',light(name)],['dark',dark(name)]]){
    need(`${name} ${mode} text on selected`,c['--kptu-ink'],c['--kptu-primary-soft'],7);
    assert.notEqual(c['--kptu-primary-soft'].toLowerCase(),c['--kptu-surface'].toLowerCase(),`${name} ${mode} selected differs from page`);
  }
});

// UI-선택표시톤다운(명진 2026-10-28 18:40): 선택 표시 규칙 — 고른 메뉴·탭·전환·필터는 연한 바탕 + 얇은 선, 꽉 칠한 주 색은 누르는 주 버튼에만, 오늘 표시는 동그라미 테두리.
const tokenBlock=css.slice(css.indexOf('--ds-select-bg:'),css.indexOf('--kptu-shadow-today:'));
// 글자로 쓰는 강조색(--kptu-primary-text): 수수한 다섯은 주 버튼 색, 산뜻한 다섯은 읽히는 글자색.
const accentText=(name,c)=>VIVID.includes(name)?c['--kptu-primary-ink']:c['--kptu-primary'];
test('선택 표시 토큰: 연한 바탕·보통 글자·강조 글자색의 얇은 선, 오늘은 테두리(값은 theme-tokens.css 한 곳)',()=>{
  const v=vars(css.slice(css.indexOf('--ds-select-bg:')-2,css.indexOf('--kptu-shadow-today:')+200));
  assert.equal(v['--ds-select-bg'],'var(--kptu-primary-soft)');
  assert.equal(v['--ds-select-ink'],'var(--kptu-ink)');
  assert.equal(v['--ds-select-line'],'var(--kptu-primary-text)');
  assert.equal(v['--kptu-shadow-select'],'inset 2px 0 0 var(--ds-select-line)');
  assert.equal(v['--kptu-shadow-today'],'inset 0 0 0 1.5px var(--kptu-primary-text)');
  assert.ok(tokenBlock.length>0);
  assert.equal((css.match(/--ds-select-bg:/g)||[]).length,1,'declared once (dark mode reuses it through --kptu-* values)');
  for(const name of THEMES)for(const [mode,c] of [['light',light(name)],['dark',dark(name)]]){
    const line=accentText(name,c);
    need(`${name} ${mode} selected text`,c['--kptu-ink'],c['--kptu-primary-soft'],7);
    for(const surface of ['--kptu-primary-soft','--kptu-surface','--kptu-bg'])need(`${name} ${mode} selection line / today ring on ${surface}`,line,c[surface],3);
    need(`${name} ${mode} today number`,line,c['--kptu-surface'],4.5);
  }
});
test('선택 표시 규칙: 고른 상태·오늘 표시는 주 색으로 꽉 칠하지 않는다(app의 모든 CSS)',()=>{
  const STATE=/\[aria-(pressed|checked|selected)="true"\]|\[aria-current|\.active\b|\.is-selected\b|\.is-current\b|:checked|\.today\b/;
  const FILL=/background(-color)?:\s*var\(--(kptu-primary|kptu-primary-ink|kptu-primary-hover|ds-select-line)\)/;
  const bad=[];
  for(const file of readdirSync('app').filter(name=>name.endsWith('.css')&&name!=='theme-tokens.css')){
    const text=readFileSync('app/'+file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    for(const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const selector=m[1].trim();
      // 진행 단계 막대(공유 페이지 지금 단계)는 그림 요소라 대상 아님.
      // ::before 얇은 선(가로 전환의 아래 선)은 선이라 대상 아님.
      if(STATE.test(selector)&&FILL.test(m[2])&&!/\.sr-stage\.is-current|::before/.test(selector))bad.push(file+': '+selector.slice(0,80));
    }
  }
  assert.deepEqual(bad,[],'use --ds-select-bg + --ds-select-line (or --kptu-shadow-today for today)');
});
test('선택 표시 규칙: 색별 조정(레몬은 버터·겨자, 빨강은 벽돌색, 코랄은 주 버튼만 살짝 낮춤)',()=>{
  assert.equal(light('lemon')['--kptu-primary'],'#e3c25a');assert.equal(light('lemon')['--kptu-bg'],'#fbf8ec');
  assert.equal(light('red')['--kptu-primary'],'#b23a2e');
  assert.equal(light('coral')['--kptu-primary'],'#b8553a');assert.equal(light('coral')['--kptu-primary-ink'],'#a83a1f','coral: only the button color moves');
  // 레몬 바탕은 덜 노랗게: 파랑 채널이 230 이상(예전 #fffbe0은 224).
  assert.ok(rgb(light('lemon')['--kptu-bg'])[2]*255>=230);
  // 레몬 강조색은 형광이 아니다: 채도를 예전(#f5cc00, 100%)보다 낮게.
  const sat=hex=>{const v=rgb(hex),mx=Math.max(...v),mn=Math.min(...v),l=(mx+mn)/2;return mx===mn?0:(mx-mn)/(1-Math.abs(2*l-1))};
  assert.ok(sat(light('lemon')['--kptu-primary'])<0.8&&sat(dark('lemon')['--kptu-primary'])<0.7);
});

// UI-오늘표시통일(명진 2026-10-29 16:33, 일기 달력 방식): 앱의 모든 달력 '오늘'은 공용 규칙 하나(ui-standard.css .ds-today·.ds-today-num).
test('오늘 표시 토큰: 칸 둘레 선은 진한 강조 글자색, 모든 색·밝은/어두운 화면에서 칸 바탕 위 3:1 이상',()=>{
  const v=vars(css);
  assert.equal(v['--ds-today-line'],'var(--kptu-primary-ink)');
  assert.equal(v['--ds-today-line-width'],'2px');assert.equal(v['--ds-today-line-width-sm'],'1.5px');
  for(const name of THEMES)for(const [mode,c] of [['light',light(name)],['dark',dark(name)]])
    for(const surface of ['--kptu-surface','--kptu-surface-subtle','--kptu-bg'])need(`${name} ${mode} today frame on ${surface}`,c['--kptu-primary-ink'],c[surface],3);
});
test('오늘 표시 규칙: 오늘 모양(선·동그라미·바탕)은 ui-standard.css 공용 규칙 한 곳에서만 그린다',()=>{
  const TODAY=/\.ds-today(?![-\w])|\.ds-today-num|\.today\b|\.cwv-today|\.clv-today|\.rv-now|\[aria-current="date"\]/;
  const LOOK=/(^|;|\s)(box-shadow|background(-color)?|border(-[a-z]+)*|outline)\s*:/;
  const bad=[];
  for(const file of readdirSync('app').filter(name=>name.endsWith('.css')&&name!=='ui-standard.css')){
    const text=readFileSync('app/'+file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    for(const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const selector=m[1].trim().replace(/:not\([^)]*\)/g,'');
      if(TODAY.test(selector)&&LOOK.test(m[2]))bad.push(file+': '+selector.slice(0,80));
    }
  }
  assert.deepEqual(bad,[],'오늘 표시는 .ds-today/.ds-today-num 공용 규칙(ui-standard.css)만 쓴다');
  const shared=readFileSync('app/ui-standard.css','utf8');
  assert.match(shared,/#appView \.ds-today::before\{[^}]*border:var\(--ds-today-line-width\) solid var\(--ds-today-line\)/);
  assert.match(shared,/#appView \.ds-today \.ds-today-num\{[^}]*box-shadow:var\(--kptu-shadow-today\)/);
  // 오늘을 표시하는 달력은 모두 공용 클래스를 붙인다(칸 + 날짜 숫자).
  for(const file of ['calendar-month-view.js','calendar-week-view.js','diary.js','journal.js','report-views.js','photos.js']){
    const js=readFileSync('app/'+file,'utf8');
    assert.ok(js.includes('ds-today')&&js.includes('ds-today-num'),file+': .ds-today + .ds-today-num');
  }
  assert.ok(readFileSync('app/calendar-list-view.js','utf8').includes("classList.add('ds-today')"),'calendar-list-view.js: 오늘 묶음 .ds-today');
});
