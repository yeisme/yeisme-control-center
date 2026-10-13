import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base=process.env.DESIGN_V14_URL||'http://127.0.0.1:4394/';
const run=path.resolve('temp/integration-test-runs/design-v14-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(run+'/artifacts',{recursive:true});
await fs.writeFile(run+'/command.txt','DESIGN_V14_URL='+base+' node scripts/verify-design-v14.mjs\n');
await fs.writeFile(run+'/env.json',JSON.stringify({url:base,browser:'Chromium',viewports:[1440,1920,1280,390],mode:'design_sample',real_owner_calls:false},null,2));
const results=[],errors=[],unexpected=[],logs=[];
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();page.setDefaultTimeout(7000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())||new URL(r.url()).origin!==new URL(base).origin)unexpected.push({method:r.method(),url:r.url().split('?')[0]});});
const by=a=>page.locator(`body:has(#detail[open]) #detail [data-action="${a}"]:visible, body:not(:has(#detail[open])) #app [data-action="${a}"]:visible`).first();
const x=a=>page.locator(`body:has(#detail[open]) #detail [data-command="${a}"]:visible, body:not(:has(#detail[open])) #app [data-command="${a}"]:visible`).first();
const dialog=()=>page.locator('#detail');
const text=()=>dialog().innerText();
async function check(name,fn){try{await fn();results.push({name,status:'passed'});logs.push('PASS '+name);}catch(e){results.push({name,status:'failed',error:e.message});logs.push('FAIL '+name+': '+e.message);throw e;}}
async function nav(name){const link=by('nav:'+name);if(!await link.isVisible())await by('collapse').click();await link.click();}
async function close(){if(await dialog().isVisible())await by('close').click();if(await page.locator('#draft-confirm[open]').count())await page.locator('[data-draft=discard]').click();}
async function shot(name){await page.screenshot({path:run+'/artifacts/'+name+'.png',fullPage:!await dialog().isVisible(),animations:'disabled'});}
async function noOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
const mg=a=>page.locator(`#detail[open] [data-manage="${a}"]:visible, #app [data-manage="${a}"]:visible`).first();
async function fresh(){await page.goto(base);await page.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await page.goto(base+'#projects?org=studio&project=all');await page.reload();}
async function keyLogin(id){await mg('access-login').click();await mg('use-demo:'+id).click();await page.locator('#access-form [type=submit]').click();}
let failure;
try{
  await fresh();
  await check('original unknown task -> receipt -> review handoff',async()=>{await nav('overview');await by('request:video').click();await by('query-original').click();await page.waitForFunction(()=>window.YeismeSession.state.solved);assert.match(await text(),/1|attempt/);await by('review').click();await page.locator('#review-confirm').check();await by('submit-review').click();await page.waitForFunction(()=>window.YeismeSession.state.handoff);assert.match(await text(),/待|未采用/);await close();});
  await fresh();
  await check('audio and video do not fabricate bytes',async()=>{await nav('assets');await x('asset-clear').count().then(async n=>{if(n)await x('asset-clear').click();});await page.locator('#asset-search').fill('');await x('media:audio').click();assert.match(await text(),/未提供媒体字节/);assert.equal(await page.locator('audio,video').count(),0);await close();await x('media:video').click();assert.match(await text(),/未提供媒体字节/);await close();});
  await fresh();
  await check('service search, dimensions, task links and config conflict',async()=>{await nav('services');await page.locator('#list-search').fill('Sonora');await by('service:2').click();assert.match(await text(),/传输连接/);assert.match(await text(),/内容读取/);await shot('service-detail');await by('detailtab:任务').click();assert.match(await text(),/audio-083/);await by('detailtab:配置与访问').click();await page.locator('#config-label').fill('内网声音观察');await x('config-preview').click();await x('config-conflict').click();assert.match(await text(),/revision v9/);await x('config-reload').click();assert.match(await text(),/内网声音观察/);await close();});
  await fresh();
  await fresh();await nav('requests');await x('active').click();
  await check('cancel timeout reconciles original receipt without mutation',async()=>{await x('task:audio-running').click();await x('cancel:audio-running').click();assert.equal(await x('cancel-unknown').isDisabled(),true);await page.locator('#cancel-confirm').check();await x('cancel-unknown').click();assert.match(await text(),/结果未知/);await x('cancel-receipt').click();assert.match(await text(),/已查到原取消回执/);await shot('cancel-receipt');await close();assert.match(await page.locator('tbody').innerText(),/运行中/);});
  await fresh();await nav('requests');await x('active').click();
  await check('cancel conflict keeps original task and requires new preview',async()=>{await x('task:audio-running').click();await x('cancel:audio-running').click();await page.locator('#cancel-confirm').check();await x('cancel-conflict').click();assert.match(await text(),/修订冲突/);await x('cancel-reload').click();assert.equal(await x('cancel-unknown').isDisabled(),true);await close();});
  await fresh();
  await check('asset search, layout, type and version-specific preview',async()=>{await nav('assets');await shot('assets-1440');await x('asset-type:audio').click();assert.equal(await page.locator('.asset-tile').count(),1);await x('asset-type:all').click();await page.locator('#asset-search').fill('雨夜');assert.equal(await page.locator('.asset-tile').count(),2);await x('asset-view').click();assert.equal(await page.locator('.asset-list').count(),1);await x('media:image').click();assert.equal(await dialog().locator('img').count(),0);await x('preview:image').click();assert.equal(await dialog().locator('img').count(),1);await by('detailtab:版本与来源').click();await x('version:v2').click();await by('detailtab:预览').click();assert.equal(await dialog().locator('img').count(),0);assert.match(await text(),/历史版本没有预览字节/);await close();});
  await fresh();
  await check('uniform 520px forms and aligned full-width fields',async()=>{
    await page.setViewportSize({width:1440,height:900});await mg('new-project').click();await page.waitForTimeout(220);assert.equal(Math.round((await dialog().boundingBox()).width),520);
    const boxes=await page.locator('#project-form input,#project-form select,#project-form textarea').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,w:r.width};}));assert.equal(new Set(boxes.map(x=>x.x)).size,1);assert.equal(new Set(boxes.map(x=>x.w)).size,1);
    await page.locator('#new-name').fill('保留宽度草稿');await by('theme').click();await page.evaluate(()=>window.YeismeApp.action('density:comfortable'));await by('fullscreen').click();assert.equal(await page.locator('#new-name').inputValue(),'保留宽度草稿');assert.ok((await page.locator('#project-form').boundingBox()).width<=720);await by('fullscreen').click();
    for(const width of [1280,390,1440]){await page.setViewportSize({width,height:width===390?844:900});await page.waitForTimeout(220);assert.equal(await page.locator('#new-name').inputValue(),'保留宽度草稿');assert.equal(Math.round((await dialog().boundingBox()).width),width===390?390:520);await noOverflow();}
    await shot('project-form-standard');await close();await nav('team');await mg('key-new').click();await page.waitForTimeout(220);assert.equal(Math.round((await dialog().boundingBox()).width),520);await close();
    await nav('settings');await mg('reset-widths').click();await nav('projects');await mg('project-detail:rain').click();await page.waitForTimeout(220);assert.equal(Math.round((await dialog().boundingBox()).width),400);await close();
  });
  await check('organization switch protects draft and removes previous content',async()=>{
    await nav('projects');await mg('new-project').click();await page.locator('#new-name').fill('未提交组织草稿');await page.locator('#org-picker').selectOption('research');assert.equal(await page.locator('#draft-confirm').isVisible(),true);await page.locator('[data-draft=keep]').click();assert.equal(await page.locator('#org-picker').inputValue(),'studio');assert.equal(await page.locator('#new-name').inputValue(),'未提交组织草稿');
    await page.locator('#org-picker').selectOption('research');await page.locator('[data-draft=discard]').click();assert.equal(await dialog().isVisible(),false);assert.doesNotMatch(await page.locator('main').innerText(),/雨夜重逢|白昼来信/);assert.match(await page.locator('main').innerText(),/叙事结构研究/);
    await nav('assets');assert.equal(await page.locator('.asset-tile').count(),0);await nav('requests');assert.equal(await page.locator('.request-row,tbody tr').count(),0);await nav('team');await mg('org-tab:成员与角色').click();assert.match(await page.locator('main').innerText(),/研究负责人/);assert.doesNotMatch(await page.locator('.member-list').innerText(),/制作协作者/);await page.locator('#org-picker').selectOption('studio');
  });
  await check('new project validation binding partial result and original-operation recovery',async()=>{
    await nav('projects');await mg('new-project').click();await page.locator('[form=project-form]').click();assert.equal(await page.locator('#new-name').getAttribute('aria-invalid'),'true');await page.locator('#new-name').fill('城市夜航');await page.locator('#new-description').fill('三服务绑定演示');await page.locator('[form=project-form]').click();
    await page.locator('#binding-mode-0').selectOption('existing');await page.locator('[form=project-form]').click();assert.equal(await page.locator('#binding-ref-0').getAttribute('aria-invalid'),'true');await page.locator('#binding-ref-0').fill('demo:scaena/night');await page.locator('#binding-mode-1').selectOption('new');await mg('project-back').click();assert.equal(await page.locator('#new-name').inputValue(),'城市夜航');await page.locator('[form=project-form]').click();assert.equal(await page.locator('#binding-ref-0').inputValue(),'demo:scaena/night');await page.locator('[form=project-form]').click();
    await page.locator('#creation-outcome').selectOption('unknown');await page.locator('[form=project-form]').click();assert.match(await text(),/结果未知/);assert.match(await text(),/处理中/);assert.equal(await page.locator('[form=project-form]').count(),0);await close();await page.locator('#org-picker').selectOption('research');await page.locator('#org-picker').selectOption('studio');await mg('new-project').click();assert.match(await text(),/demo-create-1/);await mg('query-creation').click();assert.match(await text(),/部分领域绑定失败/);assert.match(await text(),/demo-create-1/);await shot('project-partial-receipt');await mg('go-projects').click();assert.equal(await page.locator('.managed-project-card').filter({hasText:'城市夜航'}).count(),1);
    await mg('project-detail:demo-project-1').click();assert.match(await text(),/绑定失败/);await close();
  });
  await check('static key configuration previews explicit grants and purpose defaults',async()=>{
    await nav('team');await mg('org-tab:访问 Key').click();assert.equal(await page.locator('.key-table tbody tr').count(),8);await mg('key-detail:reader').click();await by('detailtab:关联服务').click();assert.match(await text(),/不能由面板 Key 推断/);await close();
    await mg('key-new').click();await page.locator('#key-name').fill('外部协作者');await page.locator('#key-purpose').selectOption('临时');assert.equal(await page.locator('#key-expiry').inputValue(),'24h');await page.locator('#key-purpose').selectOption('紧急');assert.equal(await page.locator('#key-expiry').inputValue(),'1h');await page.locator('[form=key-form]').click();assert.match(await page.locator('#key-project-error').innerText(),/至少选择/);await page.locator('[name=projects][value=rain]').check();await page.locator('[form=key-form]').click();assert.match(await text(),/未应用配置/);assert.match(await text(),/1h/);assert.match(await text(),/不在原型生成或展示/);await close();
    await mg('key-detail:reader').click();await mg('key-revoke:reader').click();assert.match(await text(),/未应用/);await close();await mg('dynamic').click();assert.match(await text(),/静态拒绝不回退/);await close();
  });
  await check('key login grants scope only and survives reload without privilege elevation',async()=>{
    await keyLogin('reader');assert.match(await page.locator('.access-strip').innerText(),/Key 主体/);assert.equal(await page.locator('#org-picker option').count(),1);assert.equal(await page.locator('.managed-project-card').count(),1);assert.equal(await mg('new-project').isDisabled(),true);assert.doesNotMatch(await page.locator('main').innerText(),/白昼来信/);await page.reload();assert.equal(await mg('new-project').isDisabled(),true);
    await nav('team');await mg('org-tab:访问 Key').click();assert.equal(await page.locator('.key-table tbody tr').count(),1);await mg('org-tab:成员与角色').click();assert.match(await page.locator('main').innerText(),/没有组织成员目录权限/);
    await nav('requests');await x('active').click();await x('task:audio-running').click();assert.equal(await x('cancel:audio-running').isDisabled(),true);await close();
    await page.goto(base+'#projects?org=research&project=narrative');assert.match(await page.locator('main').innerText(),/没有此范围的访问权限/);assert.doesNotMatch(await page.locator('main').innerText(),/叙事结构研究|研究负责人|叙事实验室/);assert.equal(await page.locator('#project-picker option[value=narrative]').count(),0);await mg('safe-scope').click();await shot('key-restricted-projects');
    await nav('settings');await mg('revoke-session').click();assert.equal(await page.locator('.managed-project-card,.asset-tile').count(),0);assert.match(await page.locator('main').innerText(),/撤销演练/);await page.reload();assert.equal(await page.locator('#access-form').count(),1);await mg('use-demo:reader').click();await page.locator('#access-form [type=submit]').click();assert.match(await page.locator('#login-error').innerText(),/已禁用/);
  });
  await check('disabled expired API-only unknown and unbound keys do not fall back',async()=>{
    for(const id of ['disabled','expired','api-only']){await mg('use-demo:'+id).click();await page.locator('#access-form [type=submit]').click();assert.match(await page.locator('#login-error').innerText(),/不回退/);assert.equal(await page.locator('#demo-access').inputValue(),'');}
    await page.locator('#demo-access').fill('not-a-demo');await page.locator('#access-form [type=submit]').click();assert.match(await page.locator('#login-error').innerText(),/未查询 Aigora/);
    await mg('use-demo:unbound').click();await page.locator('#access-form [type=submit]').click();assert.equal(await page.locator('.managed-project-card').count(),0);await nav('assets');assert.equal(await page.locator('.asset-tile').count(),0);await keyLogin('temporary');assert.match(await page.locator('.access-strip').innerText(),/15 分钟/);await keyLogin('emergency');assert.equal(await mg('new-project').isDisabled(),true);assert.equal(await page.locator('.access-strip.emergency').count(),1);
  });
  await check('explicit project creation permission and administrator restoration',async()=>{
    await keyLogin('creator');assert.equal(await mg('new-project').isDisabled(),false);await mg('new-project').click();assert.equal(await page.locator('#new-org').inputValue(),'Yeisme 制作团队');await close();await mg('access-login').click();await mg('login-tab:account').click();await mg('account-demo').click();assert.equal(await page.locator('#org-picker option').count(),2);
  });
  await check('keyboard tabs and reduced motion retain form operation',async()=>{
    await nav('team');await mg('org-tab:组织概况').focus();await page.keyboard.press('ArrowRight');assert.equal(await mg('org-tab:成员与角色').getAttribute('aria-selected'),'true');await page.emulateMedia({reducedMotion:'reduce'});await mg('key-new').click();await page.locator('#key-name').fill('键盘草稿');await page.keyboard.press('Escape');await page.locator('[data-draft=keep]').click();assert.equal(await page.locator('#key-name').inputValue(),'键盘草稿');await close();await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('management loading empty partial stale failure and access invalidation',async()=>{
    await nav('projects');for(const [value,text] of [['loading','正在读取'],['empty','还没有记录'],['partial','部分来源读取失败'],['stale','上次观察快照'],['error','读取暂时失败']]){await page.locator('#scenario').selectOption(value);assert.match(await page.locator('main').innerText(),new RegExp(text));if(['loading','empty','error'].includes(value))assert.equal(await page.locator('.managed-project-card').count(),0);}await page.locator('#scenario').selectOption('normal');
    await mg('new-project').click();await page.locator('#new-name').fill('权限失效草稿');await page.locator('#scenario').selectOption('unauthorized');assert.equal(await dialog().isVisible(),false);assert.match(await page.locator('main').innerText(),/权限已撤销/);await mg('login-tab:account').click();await mg('account-demo').click();await page.locator('#scenario').selectOption('expired');assert.match(await page.locator('main').innerText(),/会话已过期/);await mg('login-tab:account').click();await mg('account-demo').click();
  });
  await check('two themes densities and four viewport page/form matrix',async()=>{
    for(const [width,height] of [[1440,900],[1920,1080],[1280,800],[390,844]])for(const theme of ['light','dark'])for(const density of ['compact','comfortable']){
      await page.setViewportSize({width,height});await page.evaluate(({theme,density})=>{window.YeismeApp.action('theme:'+theme);window.YeismeApp.action('density:'+density);},{theme,density});
      for(const name of ['overview','projects','requests','assets','services','team','settings']){await nav(name);await noOverflow();assert.equal(await page.locator('h1').count(),1);await shot(`${name}-${width}-${theme}-${density}`);}
      await nav('projects');await mg('new-project').click();await page.waitForTimeout(220);await noOverflow();assert.equal(Math.round((await dialog().boundingBox()).width),width===390?390:520);await shot(`project-form-${width}-${theme}-${density}`);await close();
      await nav('team');await mg('org-tab:访问 Key').click();await noOverflow();await mg('key-new').click();await page.waitForTimeout(220);await noOverflow();await shot(`key-form-${width}-${theme}-${density}`);await close();
      if(width===390){const small=await page.locator('#app').evaluate(root=>[...root.querySelectorAll('button,input,select')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&!e.closest('[inert]')&&getComputedStyle(e).visibility!=='hidden'&&(r.width<43.5||r.height<43.5);}).map(e=>e.getAttribute('aria-label')||e.textContent.slice(0,40)));assert.deepEqual(small,[]);}
    }
  });
  await fresh();
  await check('asset fixed version source task returns to original studio shot',async()=>{await nav('assets');await x('media:image').click();await by('detailtab:版本与来源').click();await x('version:v2').click();await x('task:visual').click();await x('shot:03').click();assert.equal(await page.evaluate(()=>window.YeismeSession.state.page),'studio');assert.equal(await page.evaluate(()=>window.YeismeSession.state.shot),'03');assert.equal(await page.locator('#project-picker').inputValue(),'rain');});
  await check('no real API calls or script errors',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);});
}catch(e){failure=e;await shot('failure').catch(()=>{});}
finally{await browser.close();await fs.writeFile(run+'/stdout.log',logs.join('\n')+'\n');await fs.writeFile(run+'/stderr.log',failure?failure.stack+'\n':'');await fs.writeFile(run+'/summary.json',JSON.stringify({status:failure?'failed':'passed',checks:results,script_errors:errors,unexpected_requests:unexpected,evidence_layer:'design_browser',real_integration:false},null,2));console.log(JSON.stringify({status:failure?'failed':'passed',checks:results.length,evidence:run,failure:failure?.message},null,2));}
if(failure)process.exitCode=1;
