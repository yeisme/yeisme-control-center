import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// This task uses the installed native OpenDesign MCP; it does not repair or restart the shared Gateway.
const origin='http://127.0.0.1:7456',project='yeisme-service-control-center';
const prefix='design-proposals/control-center-v12/',root=path.resolve(prefix),area=path.resolve('temp/design-v12-delivery');
const mode=process.argv[2];if(!['--baseline','--check','--publish','--verify'].includes(mode))throw Error('Use --check, --publish or --verify');
const hash=b=>b===null?null:createHash('sha256').update(b).digest('hex');
async function read(name){const r=await fetch(origin+'/api/projects/'+project+'/raw/'+name,{signal:AbortSignal.timeout(20000)});if(r.status===404)return null;if(!r.ok)throw Error('Read failed '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}
async function active(){const r=await fetch(origin+'/api/runs?projectId='+project,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Writer discovery unavailable');const data=await r.json();const runs=Array.isArray(data)?data:data.runs;if(!Array.isArray(runs))throw Error('Unknown run discovery response');if(runs.some(r=>['running','queued'].includes(r.status)))throw Error('Active OpenDesign writer detected');}
async function baseline(){const source=JSON.parse(await fs.readFile('temp/design-v12-baseline/baseline.json','utf8'));for(const [name,sha] of Object.entries(source)){if(hash(await read(name))!==sha)throw Error('Reference drift: '+name);}return Object.keys(source).length;}
const files=[];
async function walk(dir,rel=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const name=rel+entry.name;if(entry.isDirectory())await walk(path.join(dir,entry.name),name+'/');else files.push({name,bytes:await fs.readFile(path.join(dir,entry.name))});}}
await walk(root);files.sort((a,b)=>(a.name==='index.html')-(b.name==='index.html')||a.name.localeCompare(b.name));
await fs.mkdir(area,{recursive:true});
if(mode==='--baseline'){
 await active();
 const result=await fetch(origin+'/api/projects/'+project+'/files');if(!result.ok)throw Error('Cannot read reference files');
 const names=(await result.json()).files.map(f=>f.path).filter(n=>n==='index.html'||n.startsWith('design-proposals/control-center-v10/')||n.startsWith('design-proposals/control-center-v11/'));
 const expected={};for(const name of names)expected[name]=hash(await read(name));
 await fs.mkdir('temp/design-v12-baseline',{recursive:true});
 await fs.writeFile('temp/design-v12-baseline/baseline.json',JSON.stringify(expected,null,2));
 console.log('Captured '+names.length+' reference files; no remote writes.');process.exit(0);
}
if(mode==='--verify'){const receipt=JSON.parse(await fs.readFile(area+'/receipt.json','utf8'));for(const f of receipt.files){if(hash(await read(f.path))!==f.sha256)throw Error('Readback mismatch '+f.path);}const kept=await baseline();console.log(JSON.stringify({status:'verified',files:receipt.files.length,reference_files_unchanged:kept,url:receipt.preview_url}));process.exit(0);}
await active();const kept=await baseline();
let receipt={files:[]};try{receipt=JSON.parse(await fs.readFile(area+'/receipt.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const expected=new Map(receipt.files.map(f=>[f.path,f.sha256]));
for(const file of files){const name=prefix+file.name;const current=hash(await read(name));if(current!==null&&current!==expected.get(name))throw Error('Unowned or concurrent remote file: '+name);file.expected=current;}
if(mode==='--check'){console.log(JSON.stringify({status:'ready',new_or_owned_files:files.length,reference_files_unchanged:kept,active_writers:0}));process.exit(0);}
const child=spawn('nerdctl',['exec','-i','open-design','node','/app/apps/daemon/dist/cli.js','mcp','--daemon-url',origin],{stdio:['pipe','pipe','ignore']});
const pending=new Map();let nextId=0,buffer='';
child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);let r;try{r=JSON.parse(line);}catch{continue;}const wait=pending.get(r.id);if(wait){pending.delete(r.id);clearTimeout(wait.timer);r.error?wait.reject(Error(r.error.message)):wait.resolve(r.result);}}});
child.on('error',e=>{for(const wait of pending.values()){clearTimeout(wait.timer);wait.reject(e);}pending.clear();});
function rpc(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP response timeout; reconcile remote file before retry'));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function call(name,args){const result=await rpc('tools/call',{name,arguments:args});if(result.isError)throw Error('Native MCP '+name+' returned an error; no automatic retry');return result;}
const journal=receipt.files.filter(f=>!files.some(x=>prefix+x.name===f.path));
try{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'yeisme-control-center-design',version:'12'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const catalog=await rpc('tools/list');for(const name of ['write_file','create_artifact','get_artifact'])if(!catalog.tools.some(t=>t.name===name))throw Error('Missing native MCP capability '+name);
  for(const file of files){const name=prefix+file.name;if(file.name==='index.html')await active();if(hash(await read(name))!==file.expected)throw Error('Concurrent edit '+name);const sha=hash(file.bytes);
    if(sha!==file.expected){const entry=file.name==='index.html'&&file.expected===null;await call(entry?'create_artifact':'write_file',{project,[entry?'name':'path']:name,encoding:'base64',content:file.bytes.toString('base64')});}
    if(hash(await read(name))!==sha)throw Error('Post-write readback mismatch '+name);
    journal.push({path:name,sha256:sha,bytes:file.bytes.length});
    await fs.writeFile(area+'/receipt.json',JSON.stringify({project,transport:'native_opendesign_mcp',status:file.name==='index.html'?'complete':'in_progress',entry_last:true,files:journal,preview_url:'http://10.10.1.101:7456/api/projects/'+project+'/raw/'+prefix+'index.html'},null,2));
    console.log('Verified '+name);
  }
  const artifact=await call('get_artifact',{project,entry:prefix+'index.html',include:'auto',maxBytes:500000});
  const content=artifact.content.find(c=>c.type==='text')?.text;if(!content)throw Error('Missing MCP artifact readback');
  const bundle=JSON.parse(content);if(bundle.truncated)throw Error('Artifact readback truncated');
  await fs.writeFile(area+'/mcp-readback.json',JSON.stringify({project:bundle.projectId,entry:bundle.entryFile,files:bundle.files.map(f=>({name:f.name,size:f.size,binary:f.binary})),truncated:bundle.truncated},null,2));
  await baseline();console.log('Native MCP publication and independent HTTP readback complete.');
}finally{child.stdin.end();setTimeout(()=>child.kill(),3000).unref();}
