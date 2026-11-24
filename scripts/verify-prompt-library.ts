/** Real local owner handlers + SQLite + Control Center + browser; external providers are never configured. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, readFile, stat, appendFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/password";
import type { ServerConfig } from "../server/contracts";

const root=resolve(import.meta.dirname,"..");
const workspace=resolve(root,"../..");
const runID="prompt-library-system-"+new Date().toISOString().replace(/[:.]/g,"-");
const evidence=join(root,"temp/integration-test-runs",runID);
await mkdir(join(evidence,"artifacts"),{recursive:true,mode:0o700});
await writeFile(join(evidence,"command.txt"),"bun run test:prompt-library\n");
await writeFile(join(evidence,"env.json"),JSON.stringify({layer:"system",synthetic_content:true,owner_implementations:["eikona","sonora","scaena"],provider_calls:false,production_changes:false})+"\n");
await writeFile(join(evidence,"stdout.log"),"");await writeFile(join(evidence,"stderr.log"),"");
const children:{process:ChildProcess;manifest:string;evidence:string;exit:Promise<number|null>}[]=[];
const checks:{name:string;status:string;error?:string}[]=[];
const temporary=await mkdtemp(join(tmpdir(),"prompt-library-"));
let server:ReturnType<typeof Bun.serve>|undefined;
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let failed=false;
async function check(name:string,fn:()=>Promise<void>){try{await fn();checks.push({name,status:"passed"});}catch(error){checks.push({name,status:"failed",error:(error as Error).message.slice(0,500)});failed=true;throw error;}}
try{
 const definitions=[{owner:"eikona",directory:"cli/eikona",pkg:"./internal/api/prompt"},{owner:"sonora",directory:"cli/sonora",pkg:"./internal/api"},{owner:"scaena",directory:"agent/scaena",pkg:"./internal/productionbackend/app"}];
 const manifests=await Promise.all(definitions.map(async d=>{
  const ownerEvidence=join(workspace,d.directory,"temp/integration-test-runs",runID);
  await mkdir(join(ownerEvidence,"artifacts"),{recursive:true,mode:0o700});
  const manifest=join(ownerEvidence,"artifacts","endpoint.json");
  const args=["test",d.pkg,"-run","^TestPromptLibraryHTTPAndServer$","-count=1","-timeout","6m"];
  await writeFile(join(ownerEvidence,"command.txt"),"GOTOOLCHAIN=local CGO_ENABLED=0 go "+args.join(" ")+"\n");
  await writeFile(join(ownerEvidence,"env.json"),JSON.stringify({layer:"system",provider_calls:false,temporary_database:true,fixture_authentication:true})+"\n");
  await writeFile(join(ownerEvidence,"stdout.log"),"");await writeFile(join(ownerEvidence,"stderr.log"),"");
  const child=spawn("go",args,{cwd:join(workspace,d.directory),env:{...process.env,GOTOOLCHAIN:"local",CGO_ENABLED:"0",PROMPT_LIBRARY_TEST_MANIFEST:manifest},stdio:["ignore","pipe","pipe"]});
  child.stdout?.on("data",data=>{void appendFile(join(ownerEvidence,"stdout.log"),data);});child.stderr?.on("data",data=>{void appendFile(join(ownerEvidence,"stderr.log"),data);});
  const exit=new Promise<number|null>(resolve=>child.once("exit",code=>resolve(code)));
  children.push({process:child,manifest,evidence:ownerEvidence,exit});
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
   if(child.exitCode!==null)throw new Error(d.owner+" fixture exited; inspect owner evidence");
   try{return {owner:d.owner,...JSON.parse(await readFile(manifest,"utf8"))} as {owner:string;origin:string;project:string};}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  throw new Error(d.owner+" fixture startup timed out");
 }));
 let handle:(request:Request)=>Promise<Response>=async()=>new Response("starting",{status:503});
 server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/"))return handle(request);
  if(url.pathname==="/"||url.pathname==="/index.html")return new Response(Bun.file(join(root,"dist/index.html")));
  if(url.pathname.startsWith("/assets/")&&!url.pathname.includes(".."))return new Response(Bun.file(join(root,"dist",url.pathname)));
  if(url.pathname==="/favicon.svg"||url.pathname==="/favicon.ico")return new Response(Bun.file(join(root,"dist",url.pathname)));
  return new Response("not found",{status:404});
 }});
 const origin=`http://127.0.0.1:${server.port}`;
 const credential=join(temporary,"owner-key"),password=join(temporary,"password-hash");
 await writeFile(credential,"prompt-library-test",{mode:0o600});await writeFile(password,await hashPassword("prompt-library-local-password"),{mode:0o600});
 const config:ServerConfig={origin,port:server.port!,auth_mode:"personal",personal:{name:"Prompt tester",username:"prompt-tester",role:"admin",password_hash_ref:password,scope_ids:["library"]},principals:[{issuer:"fixture",subject:"prompt-tester",name:"Prompt tester",scopes:[{id:"library",tenant:"test-org",team:"test",project:"test",label:"Prompt library test",owners:Object.fromEntries(manifests.map(m=>[m.owner,{tenant:m.project,project:m.project,actor:"prompt-test",audience:"library-test"}]))}]}],owners:Object.fromEntries(manifests.map(m=>[m.owner,{origin:m.origin,audience:"library-test",credential_ref:credential}]))};
 handle=createApp(config);
 const executablePath=process.env.CHROME_PATH||(await stat("/usr/bin/google-chrome").then(()=>"/usr/bin/google-chrome").catch(()=>undefined));
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:["--no-sandbox"]});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
 const pageErrors:string[]=[];page.on("pageerror",e=>{pageErrors.push(e.message);void appendFile(join(evidence,"stderr.log"),"pageerror: "+e.message+"\n");});
 page.on("response",response=>{if(response.status()>=400)void appendFile(join(evidence,"stderr.log"),`http ${response.status()} ${new URL(response.url()).pathname}\n`);});
 await check("login_and_three_real_owner_catalogs",async()=>{
  await page.goto(origin+"/#/prompts");
  await expect(page.getByRole("button",{name:"进入创作台"})).toBeVisible();
  if(await page.getByLabel("用户名",{exact:true}).count())await page.getByLabel("用户名",{exact:true}).fill("prompt-tester");
  await page.getByLabel("个人访问凭据",{exact:true}).fill("prompt-library-local-password");await page.getByRole("button",{name:"进入创作台"}).click();
  await expect(page.locator('[data-page="prompts"]')).toBeVisible();
  for(const title of ["Image fixture","Music fixture","Video fixture"])await expect(page.getByRole("button",{name:new RegExp(title)})).toBeVisible({timeout:20000});
 });
 await check("read_each_owner_body",async()=>{
  for(const [title,text] of [["Image fixture","synthetic image prompt"],["Music fixture","synthetic music prompt"],["Video fixture","synthetic video prompt"]]){
   await page.getByRole("button",{name:new RegExp(title)}).click();await expect(page.getByLabel("提示词全文",{exact:true})).toHaveText(text);
   await page.getByRole("button",{name:"关闭详情",exact:true}).click();
  }
 });
 await check("create_tag_filter_revision_archive_and_collection",async()=>{
  await page.getByRole("button",{name:"新建提示词",exact:true}).click();
  await page.getByLabel("标题",{exact:true}).fill("Library journey fixture");await page.getByLabel("提示词正文",{exact:true}).fill("synthetic reusable material");await page.getByLabel("标签",{exact:true}).fill("journey, calm");
  await page.getByRole("button",{name:"预览保存",exact:true}).click();await page.getByRole("button",{name:"确认保存",exact:true}).click();
  await expect(page.getByRole("button",{name:/Library journey fixture/})).toBeVisible();
  await page.getByLabel("标签筛选",{exact:true}).fill("journey");await expect(page.getByRole("button",{name:/Image fixture/})).toHaveCount(0);
  await page.getByRole("button",{name:/Library journey fixture/}).click();await expect(page.getByLabel("提示词全文",{exact:true})).toHaveText("synthetic reusable material");await page.getByRole("button",{name:"编辑",exact:true}).click();await page.getByLabel("提示词正文",{exact:true}).fill("synthetic revised material");await page.getByRole("button",{name:"预览保存",exact:true}).click();await page.getByRole("button",{name:"确认保存",exact:true}).click();
  await page.getByRole("button",{name:/Library journey fixture/}).click();await expect(page.getByLabel("提示词全文",{exact:true})).toHaveText("synthetic revised material");await page.getByLabel("提示词版本",{exact:true}).fill("1");await expect(page.getByLabel("提示词全文",{exact:true})).toHaveText("synthetic reusable material");await page.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.getByLabel("新收藏夹名称",{exact:true}).fill("Journey collection");await page.getByRole("button",{name:"创建收藏夹",exact:true}).click();await page.getByLabel("选择 Library journey fixture",{exact:true}).check();
  await expect(page.getByLabel("目标收藏夹",{exact:true}).locator("option").filter({hasText:"Journey collection"})).toHaveCount(1);await page.getByLabel("目标收藏夹",{exact:true}).selectOption({label:"Journey collection"});await page.getByRole("button",{name:"加入收藏夹",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"已完成 1 项"})).toBeVisible();
  await page.getByLabel("收藏夹筛选",{exact:true}).selectOption({label:"Journey collection"});await expect(page.getByRole("button",{name:/Library journey fixture/})).toBeVisible();
  await page.getByRole("button",{name:/Library journey fixture/}).click();await expect(page.getByLabel("提示词全文",{exact:true})).toBeVisible();await page.getByRole("button",{name:"编辑",exact:true}).click();await page.getByLabel("归档此素材（保留正文和版本）").check();await page.getByRole("button",{name:"预览保存",exact:true}).click();await page.getByRole("button",{name:"确认保存",exact:true}).click();await expect(page.getByRole("button",{name:/Library journey fixture/})).toHaveCount(0);await page.getByLabel("素材视图",{exact:true}).selectOption("archived");await expect(page.getByRole("button",{name:/Library journey fixture/})).toBeVisible();
 });
 await check("file_import_search_and_batch_tags",async()=>{
  await page.getByLabel("收藏夹筛选",{exact:true}).selectOption("");
  await page.getByLabel("标签筛选",{exact:true}).fill("");
  await page.getByLabel("素材视图",{exact:true}).selectOption("");
  await page.getByRole("button",{name:"新建提示词",exact:true}).click();
  await page.locator('input[type="file"]').setInputFiles({name:"Imported fixture.md",mimeType:"text/markdown",buffer:Buffer.from("synthetic imported material")});
  await expect(page.getByLabel("提示词正文",{exact:true})).toHaveValue("synthetic imported material");
  await page.getByRole("button",{name:"预览保存",exact:true}).click();await page.getByRole("button",{name:"确认保存",exact:true}).click();
  await page.getByLabel("选择 Imported fixture",{exact:true}).check();await page.getByLabel("批量标签",{exact:true}).fill("imported");await page.getByRole("button",{name:"批量加标签",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"已完成 1 项"})).toBeVisible();
  await page.getByLabel("搜索提示词",{exact:true}).fill("synthetic imported");
  await expect(page.getByRole("button",{name:/Image fixture/})).toHaveCount(0);
  await page.getByRole("button",{name:/Imported fixture/}).click();await expect(page.getByLabel("提示词全文",{exact:true})).toHaveText("synthetic imported material");
  await page.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.getByLabel("搜索提示词",{exact:true}).fill("");await page.getByLabel("素材视图",{exact:true}).selectOption("archived");
 });
 await check("responsive_and_keyboard",async()=>{
  await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:/Library journey fixture/}).click();await expect(page.getByLabel("提示词全文",{exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.keyboard.press("Escape");await expect(page.getByLabel("提示词全文",{exact:true})).toHaveCount(0);
  await page.screenshot({path:join(evidence,"artifacts","mobile.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(evidence,"artifacts","desktop.png"),fullPage:true});assert.equal(pageErrors.length,0,"browser runtime error");
 });
 await context.close();
}catch(error){
 failed=true;await appendFile(join(evidence,"stderr.log"),(error as Error).message.slice(0,1500)+"\n");
 for(const context of browser?.contexts()||[])for(const page of context.pages()){
  await page.screenshot({path:join(evidence,"artifacts","failure.png"),fullPage:true}).catch(()=>{});
  await writeFile(join(evidence,"artifacts","browser-failure.txt"),"url="+page.url()+"\n"+(await page.locator("body").innerText().catch(()=>"no body")).slice(0,3000));
 }
}
finally{
 await browser?.close();server?.stop(true);
 for(const child of children)await writeFile(child.manifest+".stop","");
 for(const child of children){const code=await Promise.race([child.exit,new Promise<null>(r=>setTimeout(()=>r(null),10000))]);if(code===null)child.process.kill("SIGTERM");await writeFile(join(child.evidence,"summary.json"),JSON.stringify({layer:"system",passed:code===0,exit_code:code,provider_calls:false,fixture_authentication:true},null,2)+"\n");if(code!==0)failed=true;}
 await rm(temporary,{recursive:true,force:true});
 await writeFile(join(evidence,"summary.json"),JSON.stringify({layer:"system",status:failed?"failed":"passed",checks,provider_calls:false,production_changes:false,owner_evidence:children.map(c=>c.evidence)},null,2)+"\n");
 await appendFile(join(evidence,"stdout.log"),checks.map(c=>`${c.status}: ${c.name}`).join("\n")+"\n");
 console.log(JSON.stringify({status:failed?"failed":"passed",evidence,checks:checks.length}));
 process.exitCode=failed?1:0;
}
