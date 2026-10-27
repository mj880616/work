import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {THEMES,DEFAULT_THEME,validValue} from '../app/view-prefs.js';
// UI-화면색10: 화면 색 10가지의 일관성과 글자 대비. 허용 목록은 view-prefs.js THEMES 한 곳이고, 아래는 모두 그 목록을 읽는다.
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

// 보조 글자는 4.5:1을 목표로 하되, 기존 테라코타(4.4999)가 반올림 경계라 0.05 여유를 둔다(새 여섯 가지는 모두 4.5 이상).
const MUTED_MIN=4.45;
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
    need('picked button on page',c['--kptu-primary'],c['--kptu-bg'],3);
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
    need('picked button on page',c['--kptu-primary'],c['--kptu-bg'],3);
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

test('the six added colors meet the stricter 4.5:1 for muted text in both modes',()=>{
  for(const name of THEMES.slice(4)){
    for(const surface of ['--kptu-bg','--kptu-surface','--kptu-surface-subtle']){
      need(name+' light muted',light(name)['--kptu-muted'],light(name)[surface],4.5);
      need(name+' dark muted',dark(name)['--kptu-muted'],dark(name)[surface],4.5);
    }
  }
});

test('the database check allows exactly the colors in THEMES (same names, same order)',()=>{
  const sql=readFileSync('supabase/migrations/20261027040000_profile_view_prefs_theme10.sql','utf8').replace(/--.*$/gm,'');
  const list=sql.match(/view_prefs ->> 'theme' in \(([^)]*)\)/)?.[1];
  assert.ok(list,'theme list found');
  assert.deepEqual([...list.matchAll(/'([a-z]+)'/g)].map(m=>m[1]),[...THEMES]);
});
