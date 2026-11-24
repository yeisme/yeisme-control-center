import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../../app/workspace";
import { api, errorCode, type ActionPreview, type PromptRecipeSummary, type PromptRecipeVersion, type PromptRecipeUsePreview } from "../../shared/api/control-center-client";
import { promptKinds, promptKindLabels, promptOwners, type PromptSummary, type PromptOwner, type PromptKind, type PromptContent, type PromptPage, type PromptWrite } from "../../shared/prompt-library";
import { type PromptRecipePage } from "../../shared/prompt-recipes";
import { InspectorShell, type InspectorMode } from "../../components/InspectorShell";
import { Button, EmptyState, Field, InlineNotice, Input, PageToolbar, Panel, Pill, SearchField, Select, SkeletonRows, Textarea, ownerLabel, cx } from "../../components/ui";
import { BookOpen, Copy, Plus, RefreshCw } from "../../icons";
import { needsContractLabel } from "../../shared/read-model/labels";

type Draft = PromptWrite & { owner: PromptOwner; tagText: string };
const draftFor = (owner: PromptOwner = "eikona"): Draft => ({ owner, title: "", kind: owner === "eikona" ? "image" : owner === "scaena" ? "video" : "speech", text: "", tags: [], tagText: "", archived: false, expected_version: 0 });
const errors: Record<string,string> = { owner_forbidden: "当前账号没有该来源的内容权限。", delegation_unavailable: "当前连接尚未提供所需项目授权。", needs_contract: "该来源尚未提供提示词库接口。", prompt_conflict: "内容已被修改，请刷新后重新编辑。", prompt_content_integrity_failed: "正文校验未通过，请重新读取。", prompt_input_session_expired: "编辑会话已过期，请重新填写。", source_not_configured: "尚未配置该来源。", action_reconcile_required: "保存结果尚未确认，请核对原操作，不要重复新建。" };
const readableError = (code: string) => errors[code] || "暂时无法完成操作，请稍后重试。";

export default function PromptsPage() {
 const { scopeId, generation, session, noteEpoch } = useWorkspace();
 const [params,setParams] = useSearchParams();
 const paramsRef=useRef(params);
 useEffect(()=>{paramsRef.current=params;},[params]);
 const writeParams=(change:(next:URLSearchParams)=>void)=>{const next=new URLSearchParams(paramsRef.current);change(next);paramsRef.current=next;setParams(next,{replace:true});};
 const [page,setPage] = useState<PromptPage>({ rows: [], sources: [] });
 const [recipePage,setRecipePage] = useState<PromptRecipePage>({ schema_version: "yeisme.prompt_recipe.page.v1", rows: [], total: 0, next_cursor: null, coverage: "unknown" });
 const [recipeMode,setRecipeMode] = useState(params.get("view") === "recipes");
 const [selectedRecipe,setSelectedRecipe] = useState<PromptRecipeSummary|null>(null);
 const [recipeVersions,setRecipeVersions] = useState<PromptRecipeVersion[]>([]);
 const [recipeUse,setRecipeUse] = useState<PromptRecipeUsePreview|null>(null);
 const [recipeBusy,setRecipeBusy] = useState(false), [recipeLoadingMore,setRecipeLoadingMore] = useState(false);
 const [recipeError,setRecipeError] = useState("");
 const [busy,setBusy] = useState(false), [indexing,setIndexing] = useState(false);
 const [error,setError] = useState("");
 const [selected,setSelected] = useState<PromptSummary|null>(null);
 const [viewVersion,setViewVersion]=useState(0);
 const [content,setContent] = useState<PromptContent|null>(null);
 const [contentBusy,setContentBusy] = useState(false), [contentError,setContentError] = useState("");
 const [draft,setDraft] = useState<Draft|null>(null);
 const [preview,setPreview] = useState<{ value: ActionPreview; key: string }|null>(null);
 const [saving,setSaving] = useState(false), [unknown,setUnknown] = useState(false);
 const [mode,setMode] = useState<InspectorMode>("fixed"), [maximized,setMaximized] = useState(false);
 const [refresh,setRefresh] = useState(0);
 const [collections,setCollections]=useState<{id:string;name:string}[]>([]);
 const [collectionName,setCollectionName]=useState("");
 const [batchCollection,setBatchCollection]=useState("");
 const [checks,setChecks]=useState<Set<string>>(new Set());
 const [batchTag,setBatchTag]=useState("");
 const [batchMessage,setBatchMessage]=useState("");
 const [pendingBatch,setPendingBatch]=useState<{title:string;ref:string}[]>([]);
 const collection=params.get("collection")||"";
 const model=params.get("model")||"", from=params.get("from")||"", to=params.get("to")||"";
 const dateBoundary=(value:string,end=false)=>{if(!value)return undefined;const date=new Date(value+"T00:00:00");if(!Number.isFinite(date.valueOf()))return value;if(end)date.setDate(date.getDate()+1);return date.toISOString();};
 const dateQuery={model,from:dateBoundary(from),to:dateBoundary(to,true)};
 const alive = useRef(0);
 const listEpoch = useRef(0);
 const [indexRetry,setIndexRetry]=useState(0);
 const [indexOwnerRetry,setIndexOwnerRetry]=useState<PromptOwner|null>(null);
 const indexBootstrap=useRef("");
 const lastIndexRetry=useRef(0);
 const [indexGaps,setIndexGaps]=useState<string[]>([]);
 const owner=params.get("owner")||"all", q=params.get("q")||"", kind=params.get("kind")||"", source=params.get("source")||"", tag=params.get("tag")||"", archived=params.get("archived")||"false";
 const update=(key:string,value:string)=>{writeParams(next=>{if(value)next.set(key,value);else next.delete(key);});};
 const setRecipeView=(enabled:boolean)=>{setRecipeMode(enabled);writeParams(next=>{if(enabled)next.set("view","recipes");else next.delete("view");});};
 const close=useCallback(()=>{alive.current++;setSaving(false);setContentBusy(false);setViewVersion(0);setSelected(null);setContent(null);setDraft(null);setPreview(null);setUnknown(false);setContentError("");},[]);
 useEffect(()=>{alive.current++;close();indexBootstrap.current="";lastIndexRetry.current=0;setIndexOwnerRetry(null);setPage({rows:[],sources:[]});setRecipePage({schema_version:"yeisme.prompt_recipe.page.v1",rows:[],total:0,next_cursor:null,coverage:"unknown"});setSelectedRecipe(null);setRecipeVersions([]);setRecipeUse(null);setRecipeError("");setError("");setChecks(new Set());setCollections([]);setBatchMessage("");setPendingBatch([]);return()=>{alive.current++;};},[scopeId,generation,close]);
 useEffect(()=>{
  if(!scopeId)return;
  const controller=new AbortController();listEpoch.current++;setBusy(true);setError("");
  const timer=setTimeout(()=>{void api.prompts(scopeId,{owner,q,kind,source,tag,archived,collection,...dateQuery},controller.signal).then(result=>{if(!controller.signal.aborted){setPage(result);noteEpoch(result.epoch);}}).catch(e=>{if(!controller.signal.aborted)setError(errorCode(e));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});},200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[scopeId,generation,owner,q,kind,source,tag,archived,collection,model,from,to,refresh,noteEpoch]);
 useEffect(()=>{
  if(!scopeId||!session)return;
  const bootstrapKey=`${scopeId}|${generation}`;
  const initial = indexBootstrap.current !== bootstrapKey;
  if(!initial && !indexOwnerRetry && lastIndexRetry.current === indexRetry)return;
  if(!indexOwnerRetry)indexBootstrap.current=bootstrapKey;
  lastIndexRetry.current=indexRetry;
  const controller=new AbortController();setIndexing(true);setIndexGaps([]);
  const selectedOwners = indexOwnerRetry ? [indexOwnerRetry] : promptOwners.filter((owner) => {
   const source = page.sources.find((item) => item.owner === owner);
   return !source || source.state === "ready";
  });
  void Promise.allSettled(selectedOwners.map(async owner=>{
   // Bounded batches yield to the browser; the owner preserves the original refs.
   for(let page=0;page<100&&!controller.signal.aborted;page++){
    const result=await api.indexPrompts(scopeId,owner,session.csrf,controller.signal);
    if(!result.index_more)return;
   }
   if(!controller.signal.aborted)throw new Error("index_incomplete");
  })).then(results=>{if(!controller.signal.aborted){setIndexGaps(results.flatMap((result,i)=>result.status==="rejected"?[ownerLabel(selectedOwners[i])+"：历史整理未完成，可重试继续"]:[]));setIndexing(false);setIndexOwnerRetry(null);setRefresh(n=>n+1);}});
  return()=>controller.abort();
 },[scopeId,generation,session?.csrf,indexRetry,indexOwnerRetry,page.sources]);
 useEffect(()=>{
  setContent(null);setContentError("");
  if(!selected||!session||draft||!selected.readable){setContentBusy(false);return;}
  const controller=new AbortController();setContentBusy(true);
  void api.promptContent(scopeId,selected.owner,selected.id,viewVersion||selected.version,session.csrf,controller.signal).then(value=>{if(!controller.signal.aborted)setContent(value);}).catch(e=>{if(!controller.signal.aborted)setContentError(errorCode(e));}).finally(()=>{if(!controller.signal.aborted)setContentBusy(false);});
  return()=>controller.abort();
 },[selected,viewVersion,scopeId,generation,session?.csrf,draft]);
 useEffect(()=>{const controller=new AbortController();if(scopeId)void api.promptCollections(scopeId,controller.signal).then(value=>{if(!controller.signal.aborted)setCollections(value.collections);}).catch(()=>{});return()=>controller.abort();},[scopeId,generation,refresh]);
 useEffect(()=>{
  if(!scopeId||!recipeMode)return;
  const controller=new AbortController();setRecipeBusy(true);setRecipeError("");
  void api.promptRecipes(scopeId,{owner:owner === "all" ? undefined : owner as PromptOwner,q:q || undefined,kind:kind ? kind as PromptKind : undefined,state:archived === "true" ? "archived" : "active",source:source && source !== "archived" ? source as "history"|"owner_asset"|"manual"|"catalog" : undefined,tag:tag || undefined,collection:collection || undefined,limit:50},controller.signal).then(value=>{if(!controller.signal.aborted){setRecipePage(value);noteEpoch(value.epoch);}}).catch(e=>{if(!controller.signal.aborted)setRecipeError(errorCode(e));}).finally(()=>{if(!controller.signal.aborted)setRecipeBusy(false);});
  return()=>controller.abort();
 },[scopeId,generation,recipeMode,owner,q,kind,source,tag,archived,collection,refresh,noteEpoch]);
 useEffect(()=>{
  if(!selectedRecipe||!scopeId)return;
  const controller=new AbortController();setRecipeBusy(true);setRecipeError("");setRecipeUse(null);
  void Promise.all([api.promptRecipeVersions(scopeId,selectedRecipe.recipe_ref,controller.signal),api.promptRecipe(scopeId,selectedRecipe.recipe_ref,controller.signal)]).then(([versions,detail])=>{if(!controller.signal.aborted){setRecipeVersions(versions.rows);setSelectedRecipe(detail.recipe);}}).catch(e=>{if(!controller.signal.aborted)setRecipeError(errorCode(e));}).finally(()=>{if(!controller.signal.aborted)setRecipeBusy(false);});
  return()=>controller.abort();
 },[selectedRecipe?.recipe_ref,scopeId,generation]);
 const perform=async(action:"prompts.save"|"prompts.collection.create"|"prompts.collection.set",target:string,input:Record<string,unknown>,owner:PromptOwner|"control-center"="control-center")=>{
  if(!session)throw new Error("login_required");const epoch=alive.current;const key=crypto.randomUUID();
  const preview=await api.previewAction({scope_id:scopeId,owner,target_kind:action==="prompts.save"?"prompt":"prompt_collection",target_ref:target,action,expected_revision:String(input.expected_version||0),idempotency_key:key,input},session.csrf);
  try {
   const receipt=await api.confirmAction({scope_id:scopeId,preview_ref:preview.preview_ref,preview_digest:preview.preview_digest,idempotency_key:key},session.csrf);
   if(receipt.state!=="succeeded")throw new Error("action_reconcile_required");
  } catch(error) {
   if(action==="prompts.save"&&epoch===alive.current)setPendingBatch(old=>[...old,{title:String(input.title||target),ref:preview.preview_ref}]);
   throw error;
  }
 };
 const createCollection=async()=>{if(!collectionName.trim())return;setSaving(true);const epoch=alive.current;try{await perform("prompts.collection.create","new",{name:collectionName.trim()});if(epoch===alive.current){setCollectionName("");setRefresh(n=>n+1);}}catch(e){if(epoch===alive.current)setError(errorCode(e));}finally{if(epoch===alive.current)setSaving(false);}};
 const organize=async(mode:"tag"|"collection"|"remove")=>{
  const rows=page.rows.filter(row=>checks.has(`${row.owner}:${row.id}`)).slice(0,50);if(!rows.length)return;
  const epoch=alive.current;setSaving(true);setBatchMessage("");let succeeded=0,failed=0;
  for(const row of rows){
   try{
    if(mode==="tag"){
     if(row.source==="history"){failed++;continue;}
     await perform("prompts.save",row.id,{id:row.id,title:row.title,kind:row.kind,tags:[...new Set([...row.tags,...batchTag.split(/[,，]/).map(t=>t.trim()).filter(Boolean)])],archived:row.archived,expected_version:row.version},row.owner);
    }else await perform("prompts.collection.set",mode==="remove"?collection:batchCollection,{links:[{owner:row.owner,project:row.project,id:row.id}],remove:mode==="remove"});
    succeeded++;
   }catch{failed++;}
   if(epoch!==alive.current)return;
  }
  setChecks(new Set());setBatchMessage(`已完成 ${succeeded} 项${failed?`，${failed} 项未完成；历史原文请先另存素材，失败项请核对原操作。`:"。"}`);setSaving(false);setRefresh(n=>n+1);
 };
 const open=(row:PromptSummary)=>{close();setViewVersion(row.version);setSelected(row);};
 const edit=(copy:boolean)=>{
  if(!content)return;
  const row=content.summary;
  setDraft({owner:row.owner,id:copy?undefined:row.id,title:copy?`${row.title}（素材）`:row.title,kind:row.kind,text:content.text,tags:row.tags,tagText:row.tags.join(", "),archived:copy?false:row.archived,expected_version:copy?0:row.version,source_ref:copy?`${row.owner}:${row.id}@${row.version}`:row.source_ref});
  setContent(null);setPreview(null);
 };
 const change=(patch:Partial<Draft>)=>{if(unknown)return;setDraft(d=>d?{...d,...patch}:d);setPreview(null);setUnknown(false);};
 const prepare=async()=>{
  if(!draft||!session||saving)return;
  const epoch=alive.current;setSaving(true);setContentError("");
  const {owner,tagText,...input}=draft;input.tags=tagText.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean);
  const key=crypto.randomUUID();
  try{const value=await api.previewAction({scope_id:scopeId,owner,target_kind:"prompt",target_ref:input.id||"new",action:"prompts.save",expected_revision:String(input.expected_version),idempotency_key:key,input:{...input}},session.csrf);if(epoch===alive.current)setPreview({value,key});}
  catch(e){if(epoch===alive.current)setContentError(errorCode(e));}finally{if(epoch===alive.current)setSaving(false);}
 };
 const save=async()=>{
  if(!preview||!session||saving||unknown)return;
  const epoch=alive.current;setSaving(true);setContentError("");
  try{const receipt=await api.confirmAction({scope_id:scopeId,preview_ref:preview.value.preview_ref,preview_digest:preview.value.preview_digest,idempotency_key:preview.key},session.csrf);if(epoch!==alive.current)return;if(receipt.state!=="succeeded"){setUnknown(true);setContentError("action_reconcile_required");return;}close();setBusy(true);setRefresh(n=>n+1);}
  catch(e){if(epoch===alive.current){setUnknown(true);setContentError(errorCode(e));}}finally{if(epoch===alive.current)setSaving(false);}
 };
 const reconcile=async()=>{
  if(!preview||!session||saving)return;setSaving(true);const epoch=alive.current;
  try{const result=await api.reconcilePrompt(scopeId,preview.value.preview_ref,session.csrf);if(epoch!==alive.current)return;if(result.state==="succeeded"){close();setBusy(true);setRefresh(n=>n+1);}else setContentError("action_reconcile_required");}catch(e){if(epoch===alive.current)setContentError(errorCode(e));}finally{if(epoch===alive.current)setSaving(false);}
 };
 const loadMore=async(sourceOwner:PromptOwner,cursor:string)=>{
  setBusy(true);const epoch=listEpoch.current;
  try{const more=await api.prompts(scopeId,{owner:sourceOwner,q,kind,source,tag,archived,collection,cursor,...dateQuery});if(epoch!==listEpoch.current)return;setPage(old=>({rows:[...new Map([...old.rows,...more.rows].map(row=>[`${row.owner}:${row.id}`,row])).values()],sources:old.sources.map(v=>more.sources.find(n=>n.owner===v.owner)||v)}));}catch(e){if(epoch===listEpoch.current)setError(errorCode(e));}finally{if(epoch===listEpoch.current)setBusy(false);}
 };
 const importFile=async(file:File|undefined)=>{
  if(!file)return;
  if(file.size>400_000||!(/\.(txt|md|markdown)$/i.test(file.name))){setContentError("invalid_import");return;}
  const epoch=alive.current,text=await file.text();if(epoch===alive.current)change({text,title:draft?.title||file.name.replace(/\.[^.]+$/,"")});
 };
 const copy=async()=>{if(!content)return;try{await navigator.clipboard.writeText(content.text);}catch{setContentError("clipboard_denied");}};
 const captureRecipe=async()=>{
  if(!content||!session||saving)return;
  const row=content.summary;const key=crypto.randomUUID();setSaving(true);setContentError("");
  try {
   const input={owner:row.owner,project_ref:row.project,title:row.title,kind:row.kind,tags:row.tags,notes:"",visibility:"project",source:{source_kind:"owner_asset",owner_prompt_ref:row.id,owner_version:row.version,source_digest:row.digest,task_ref:row.task_ref},facets:{schema_version:"yeisme.prompt_recipe_facets.v1",model:row.model,field_sources:{intent:"owner"}},content_state:"readable"};
   const value=await api.previewAction({scope_id:scopeId,owner:"control-center",target_kind:"prompt_recipe",target_ref:"new",action:"prompts.recipe.create",expected_revision:"0",idempotency_key:key,input},session.csrf);
   const receipt=await api.confirmAction({scope_id:scopeId,preview_ref:value.preview_ref,preview_digest:value.preview_digest,idempotency_key:key},session.csrf);
   if(receipt.state!=="succeeded")throw new Error("action_reconcile_required");
   setRecipeMode(true);setRecipeView(true);setRefresh(n=>n+1);
  } catch(e){setContentError(errorCode(e));} finally{setSaving(false);}
 };
 const useRecipe=async()=>{
  if(!selectedRecipe||!session||saving)return;
  setSaving(true);setRecipeError("");
  try {
   const result=await api.promptRecipeUsePreview(scopeId,selectedRecipe.recipe_ref,{target_owner:selectedRecipe.owner,target_project_ref:selectedRecipe.project_ref,expected_revision:selectedRecipe.revision},session.csrf);
   setRecipeUse(result);
   if(result.availability!=="available"||!result.prompt_ref||!result.owner_version)return;
   const body=await api.promptContent(scopeId,result.owner,result.prompt_ref,result.owner_version,session.csrf);
   setDraft({owner:result.owner,id:undefined,title:selectedRecipe.title,kind:selectedRecipe.kind,text:body.text,tags:selectedRecipe.tags,tagText:selectedRecipe.tags.join(", "),archived:false,expected_version:0,source_ref:`recipe:${selectedRecipe.recipe_ref}@${selectedRecipe.revision}`});
   setSelectedRecipe(null);setRecipeVersions([]);setRecipeUse(null);setRecipeMode(false);
  } catch(e){setRecipeError(errorCode(e));} finally{setSaving(false);}
 };
 const archiveRecipe=async()=>{
  if(!selectedRecipe||!session||saving||selectedRecipe.state==="archived")return;
  setSaving(true);setRecipeError("");
  try {
   const key=crypto.randomUUID();
   const value=await api.previewAction({scope_id:scopeId,owner:"control-center",target_kind:"prompt_recipe",target_ref:selectedRecipe.recipe_ref,action:"prompts.recipe.archive",expected_revision:String(selectedRecipe.revision),idempotency_key:key,input:{expected_revision:selectedRecipe.revision}},session.csrf);
   const receipt=await api.confirmAction({scope_id:scopeId,preview_ref:value.preview_ref,preview_digest:value.preview_digest,idempotency_key:key},session.csrf);
   if(receipt.state!=="succeeded")throw new Error("action_reconcile_required");
   const nextRevision=selectedRecipe.revision+1;
   setSelectedRecipe({...selectedRecipe,state:"archived",revision:nextRevision,updated_at:new Date().toISOString()});
   setRecipeVersions(old=>[{...old[0] || { recipe_ref:selectedRecipe.recipe_ref, title:selectedRecipe.title, kind:selectedRecipe.kind, tags:selectedRecipe.tags, notes:selectedRecipe.notes, source:selectedRecipe.source, facets:selectedRecipe.facets, content_state:selectedRecipe.content_state, created_by:selectedRecipe.created_by }, revision:nextRevision, created_at:new Date().toISOString()},...old]);
   setRefresh(n=>n+1);
  } catch(e){setRecipeError(errorCode(e));} finally{setSaving(false);}
 };
 const loadMoreRecipes=async()=>{
  if(!scopeId||!recipePage.next_cursor||recipeLoadingMore)return;
  setRecipeLoadingMore(true);setRecipeError("");
  try {
   const more=await api.promptRecipes(scopeId,{owner:owner === "all" ? undefined : owner as PromptOwner,q:q || undefined,kind:kind ? kind as PromptKind : undefined,state:archived === "true" ? "archived" : "active",source:source && source !== "archived" ? source as "history"|"owner_asset"|"manual"|"catalog" : undefined,tag:tag || undefined,collection:collection || undefined,limit:50,cursor:recipePage.next_cursor});
   setRecipePage(old=>({...old,rows:[...new Map([...old.rows,...more.rows].map(row=>[row.recipe_ref,row])).values()],next_cursor:more.next_cursor,coverage:more.coverage}));
  } catch(e){setRecipeError(errorCode(e));} finally{setRecipeLoadingMore(false);}
 };
 const recipeTone=(state:string)=>state==="readable"?"success":state==="needs_contract"?"review":state==="forbidden"||state==="integrity_failed"?"danger":state==="unavailable"||state==="stale"?"warning":"neutral";
 const recipeStateLabel=(state:string)=>({readable:"可读取",metadata_only:"仅元数据",needs_contract:needsContractLabel,not_recorded:"未记录",forbidden:"无权限",unavailable:"不可用",stale:"已过期",integrity_failed:"完整性失败"}[state]||state);
 const opened=!!selected||!!draft;
 return <div data-page="prompts" className={cx("space-y-5",opened&&mode==="fixed"&&"min-[1280px]:pr-[var(--inspector-width)]")}>
  <h1 className="sr-only">提示词库</h1>
  <PageToolbar summary="保存创作意图，整理成随时可复用的素材。" actions={<><Button size="sm" disabled={busy||recipeBusy} onClick={()=>setRefresh(n=>n+1)} icon={<RefreshCw className="size-4"/>}>刷新</Button><Button size="sm" variant={recipeMode?"primary":"secondary"} onClick={()=>setRecipeView(!recipeMode)}>配方 {recipePage.total ? `· ${recipePage.total}` : ""}</Button><Button size="sm" variant="primary" disabled={!page.sources.some(s=>s.can_write)} onClick={()=>{close();const writable=page.sources.find(s=>s.can_write&&s.owner===owner)||page.sources.find(s=>s.can_write);if(writable)setDraft(draftFor(writable.owner));}} icon={<Plus className="size-4"/>}>新建提示词</Button></>} meta={indexing?<span className="text-xs text-muted">正在整理可读取的历史记录…</span>:<span className="text-xs text-muted">{page.rows.length} 条已加载</span>}>
   <div className="flex flex-wrap gap-2">
    <SearchField label="搜索提示词" placeholder="搜索标题、标签或正文" value={q} onChange={v=>update("q",v)}/>
    <Select aria-label="来源工具" value={owner} onChange={e=>update("owner",e.target.value)}><option value="all">全部来源</option>{promptOwners.map(v=><option key={v} value={v}>{ownerLabel(v)}</option>)}</Select>
    <Select aria-label="内容类型" value={kind} onChange={e=>update("kind",e.target.value)}><option value="">全部类型</option>{promptKinds.map(v=><option key={v} value={v}>{promptKindLabels[v]}</option>)}</Select>
    <Select aria-label="素材视图" value={archived==="true"?"archived":source} onChange={e=>{const v=e.target.value;writeParams(next=>{next.set("archived",v==="archived"?"true":"false");next.set("source",v==="archived"?"":v);});}}><option value="">全部</option><option value="history">任务历史</option><option value="manual">已整理素材</option><option value="archived">已归档</option></Select>
    <Select aria-label="收藏夹筛选" value={collection} onChange={e=>update("collection",e.target.value)}><option value="">全部收藏夹</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>
    <Input aria-label="模型筛选" placeholder="模型标识" value={model} onChange={e=>update("model",e.target.value)} className="max-w-48"/>
    <Input aria-label="开始日期" type="date" value={from} onChange={e=>update("from",e.target.value)} className="max-w-40"/><Input aria-label="结束日期" type="date" value={to} onChange={e=>update("to",e.target.value)} className="max-w-40"/>
    <Input aria-label="标签筛选" placeholder="按标签筛选" value={tag} onChange={e=>update("tag",e.target.value)} className="max-w-40"/>
   </div>
  </PageToolbar>
  {indexGaps.length>0&&<InlineNotice tone="warning">{indexGaps.join("；")} <Button size="sm" disabled={indexing} onClick={()=>setIndexRetry(n=>n+1)}>继续整理历史</Button></InlineNotice>}
  {error&&<InlineNotice tone="warning">{readableError(error)}</InlineNotice>}
  {page.sources.filter(s=>s.state!=="ready").map(s=><InlineNotice key={s.owner} tone="warning">{ownerLabel(s.owner)} · {readableError(s.reason||s.state)}</InlineNotice>)}
  {page.sources.filter(s=>s.history_state==="incomplete").map(s=><InlineNotice key={`${s.owner}:history`} tone="info">{ownerLabel(s.owner)}：历史整理未完成，可重试继续 <Button size="sm" disabled={indexing} onClick={()=>{setIndexOwnerRetry(s.owner);setIndexRetry(n=>n+1);}}>继续整理历史</Button></InlineNotice>)}
  <Panel title="提示词配方" actions={<span className="text-xs text-muted">{recipeMode ? `${recipePage.rows.length} / ${recipePage.total} 条` : "来源引用与结构化意图"}</span>}>
   {!recipeMode?<div className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm text-muted">把已审计读取的 owner 提示词收录为可复用配方。配方只保存引用、摘要和标签，不保存正文。</p><Button size="sm" onClick={()=>setRecipeView(true)}>查看配方</Button></div>:recipeBusy&&recipePage.rows.length===0?<SkeletonRows rows={4}/>:recipeError?<InlineNotice tone="warning">{readableError(recipeError)}</InlineNotice>:recipePage.rows.length===0?<EmptyState compact title="还没有配方" body="打开一条可读取的 owner 提示词，在详情中选择“收录为配方”。"/>:<><div className="grid gap-3 p-3 sm:grid-cols-2">{recipePage.rows.map(recipe=><button key={recipe.recipe_ref} type="button" onClick={()=>setSelectedRecipe(recipe)} className="min-w-0 rounded-card border border-line bg-panel-soft p-4 text-left transition-colors hover:border-accent/50 hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent"><div className="flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-sm font-semibold text-ink">{recipe.title}</span><Pill size="sm" tone={recipe.state==="archived"?"neutral":"info"}>v{recipe.revision}</Pill></div><div className="mt-2 flex flex-wrap gap-1.5"><Pill size="sm">{ownerLabel(recipe.owner)}</Pill><Pill size="sm">{promptKindLabels[recipe.kind]}</Pill><Pill size="sm" tone={recipeTone(recipe.content_state)}>{recipeStateLabel(recipe.content_state)}</Pill></div><div className="mt-3 flex flex-wrap gap-1.5">{recipe.tags.map(tag=><Pill key={tag} size="sm">{tag}</Pill>)}</div><div className="mt-3 space-y-1 text-2xs text-muted"><p className="truncate">来源：{recipe.source.owner_prompt_ref || recipe.source.source_kind}{recipe.source.owner_version ? ` · v${recipe.source.owner_version}` : ""}</p><p className="truncate">项目：{recipe.project_ref} · 修订 {recipe.revision}</p>{recipe.source.source_digest&&<p className="truncate font-mono">{recipe.source.source_digest}</p>}</div></button>)}</div><div className="flex justify-center p-3">{recipePage.next_cursor&&<Button size="sm" disabled={recipeLoadingMore} onClick={()=>void loadMoreRecipes()}>{recipeLoadingMore?"正在加载…":"加载更多配方"}</Button>}</div></>}
  </Panel>
  <Panel title="整理与收藏"><div className="flex flex-wrap items-center gap-2 p-3">
    <Input aria-label="新收藏夹名称" placeholder="新收藏夹名称" value={collectionName} maxLength={80} onChange={e=>setCollectionName(e.target.value)} className="max-w-48"/><Button size="sm" disabled={saving||!collectionName.trim()} onClick={()=>void createCollection()}>创建收藏夹</Button>
    {checks.size>0&&<><span className="text-xs text-muted">已选 {checks.size} 项</span><Select aria-label="目标收藏夹" value={batchCollection} onChange={e=>setBatchCollection(e.target.value)}><option value="">选择收藏夹</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select><Button size="sm" disabled={saving||!batchCollection} onClick={()=>void organize("collection")}>加入收藏夹</Button>{collection&&<Button size="sm" disabled={saving} onClick={()=>void organize("remove")}>移出收藏夹</Button>}<Input aria-label="批量标签" placeholder="添加标签" value={batchTag} onChange={e=>setBatchTag(e.target.value)} className="max-w-40"/><Button size="sm" disabled={saving||pendingBatch.length>0||!batchTag.trim()} onClick={()=>void organize("tag")}>批量加标签</Button></>}
   </div>{pendingBatch.map(item=><div key={item.ref} className="px-3 pb-3 text-xs"><span>{item.title}：保存结果待确认 · {item.ref}</span><Button size="sm" disabled={saving} onClick={()=>{if(!session)return;setSaving(true);const epoch=alive.current;void api.reconcilePrompt(scopeId,item.ref,session.csrf).then(result=>{if(epoch!==alive.current)return;if(result.state==="succeeded"){setPendingBatch(old=>old.filter(p=>p.ref!==item.ref));setRefresh(n=>n+1);}else setError("action_reconcile_required");}).catch(e=>{if(epoch===alive.current)setError(errorCode(e));}).finally(()=>{if(epoch===alive.current)setSaving(false);});}}>核对原保存结果</Button></div>)}{batchMessage&&<p role="status" className="px-3 pb-3 text-xs text-muted">{batchMessage}</p>}</Panel>
  <Panel title="提示词素材">
   {busy&&page.rows.length===0?<SkeletonRows rows={6}/>:page.rows.length===0?<EmptyState icon={<BookOpen/>} title="没有匹配的提示词" body={page.sources.some(s=>s.state!=="ready")?"部分来源尚不可读取。已有内容不会用演示数据补齐。":"调整筛选，或新建、粘贴导入提示词。"}/>:<div className="divide-y divide-line">{page.rows.map(row=><div key={`${row.owner}:${row.id}`} className="flex items-start gap-1"><input type="checkbox" aria-label={`选择 ${row.title}`} className="m-4 mt-5" checked={checks.has(`${row.owner}:${row.id}`)} onChange={e=>setChecks(old=>{const next=new Set(old);const key=`${row.owner}:${row.id}`;if(e.target.checked&&next.size<50)next.add(key);else next.delete(key);return next;})}/><button type="button" disabled={busy} data-prompt-id={`${row.owner}:${row.id}`} onClick={()=>open(row)} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-panel-soft focus-visible:outline-2 focus-visible:outline-accent">
    <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words text-body-sm font-medium text-ink">{row.title}</span><Pill size="sm">{promptKindLabels[row.kind]}</Pill><span className="text-xs text-muted">{ownerLabel(row.owner)} · v{row.version}</span></div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{row.source==="history"?"任务输入":"可编辑素材"}</span><span>{row.model||row.project}</span>{row.tags.map(t=><Pill key={t} size="sm">{t}</Pill>)}{!row.readable&&<span>需要内容权限</span>}</div>
   </button></div>)}</div>}
   <div className="flex flex-wrap gap-2 p-3">{page.sources.filter(s=>s.next_cursor).map(s=><Button key={s.owner} size="sm" disabled={busy} onClick={()=>void loadMore(s.owner,s.next_cursor!)}>加载更多 {ownerLabel(s.owner)}</Button>)}</div>
  </Panel>
  <InspectorShell open={opened} mode={mode} maximized={maximized} onModeChange={setMode} onMaximize={()=>setMaximized(v=>!v)} onClose={close} label="提示词" ariaLabel="提示词详情" dataAttribute="prompt-inspector" header={<h2 className="font-semibold">{draft?(draft.id?"编辑提示词":"新建提示词"):selected?.title}</h2>} sections={[]} footer={draft?<div className="flex flex-wrap items-center gap-2">{unknown&&<Button disabled={saving} onClick={()=>void reconcile()}>核对原保存结果</Button>}<Button disabled={saving} onClick={close}>取消</Button>{preview?<Button variant="primary" disabled={saving||unknown} onClick={()=>void save()}>{saving?"正在保存…":"确认保存"}</Button>:<Button variant="primary" disabled={saving||!draft.title.trim()||!draft.text?.trim()} onClick={()=>void prepare()}>预览保存</Button>}</div>:<div className="flex flex-wrap gap-2"><Button disabled={!content} icon={<Copy className="size-4"/>} onClick={()=>void copy()}>复制全文</Button><Button disabled={!content} onClick={()=>edit(true)}>另存素材</Button>{selected?.source==="manual"&&<Button disabled={!content||!page.sources.find(s=>s.owner===selected.owner)?.can_write||content.summary.version!==selected.version} onClick={()=>edit(false)}>编辑</Button>}</div>}>
   <div className="space-y-4 p-4">
    {!draft&&selected&&selected.version>1&&<Field label="查看版本"><Input aria-label="提示词版本" type="number" min={1} max={selected.version} value={viewVersion||selected.version} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=selected.version)setViewVersion(n);}}/></Field>}
    {contentError&&<InlineNotice tone="warning">{contentError==="clipboard_denied"?"请选中正文手动复制。":contentError==="invalid_import"?"请选择不超过 400 KB 的 TXT 或 Markdown 文件。":readableError(contentError)}</InlineNotice>}
    {draft?<>
     <Field label="保存到"><Select aria-label="保存到" value={draft.owner} disabled={!!draft.id||!!preview} onChange={e=>{const next=draftFor(e.target.value as PromptOwner);change({owner:next.owner,kind:next.kind});}}>{promptOwners.map(v=><option key={v} value={v} disabled={!page.sources.find(s=>s.owner===v)?.can_write}>{ownerLabel(v)}</option>)}</Select></Field>
     <p className="text-xs text-muted">跟随当前项目共享；只有已获来源授权的成员可以读取。</p>
     <Field label="标题"><Input value={draft.title} maxLength={240} onChange={e=>change({title:e.target.value})}/></Field>
     <Field label="类型"><Select value={draft.kind} onChange={e=>change({kind:e.target.value as PromptKind})}>{promptKinds.filter(v=>draft.owner==="eikona"?v==="image":draft.owner==="scaena"?v==="video":["speech","music","sfx"].includes(v)).map(v=><option key={v} value={v}>{promptKindLabels[v]}</option>)}</Select></Field>
     <Field label="正文"><Textarea aria-label="提示词正文" rows={15} value={draft.text||""} onChange={e=>change({text:e.target.value})}/></Field>
     <Field label="从文件导入"><input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={e=>void importFile(e.target.files?.[0])}/></Field>
     <Field label="标签" hint="使用逗号分隔，例如：人物、电影感、雨夜"><Input aria-label="标签" value={draft.tagText} onChange={e=>change({tagText:e.target.value})}/></Field>
     {draft.id&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.archived} onChange={e=>change({archived:e.target.checked})}/>归档此素材（保留正文和版本）</label>}
     {preview&&<InlineNotice tone="info">将保存到 {ownerLabel(draft.owner)}，新版本不会覆盖任务原文，也不会触发生成。</InlineNotice>}
    </>:<>
     <div className="flex flex-wrap gap-2">{selected&&<><Pill>{promptKindLabels[selected.kind]}</Pill><Pill>{selected.source==="history"?"任务输入":"可编辑素材"}</Pill><Pill>版本 {selected.version}</Pill></>}</div>
     {contentBusy?<SkeletonRows rows={8}/>:content?<pre tabIndex={0} aria-label="提示词全文" className="whitespace-pre-wrap break-words rounded-control border border-line bg-panel-soft p-4 text-sm leading-7 text-ink">{content.text}</pre>:!selected?.readable?<InlineNotice tone="neutral">当前来源未授权读取正文。</InlineNotice>:null}
     {selected?.source==="history"&&<Link className="text-sm underline" to={`/tasks?owner=${selected.owner}&q=${encodeURIComponent(selected.task_ref||selected.source_ref||selected.id)}`}>查看来源任务</Link>}
     {selected?.source_ref&&<div className="break-all text-xs text-muted">来源：{selected.source_ref}</div>}
     {selected?.source==="history"&&<p className="text-xs text-muted">任务输入保持原样。选择“另存素材”后可编辑和添加标签。</p>}
    </>}
   </div>
  </InspectorShell>
  <InspectorShell open={!!selectedRecipe} mode={mode} maximized={maximized} onModeChange={setMode} onMaximize={()=>setMaximized(v=>!v)} onClose={()=>{setSelectedRecipe(null);setRecipeVersions([]);setRecipeUse(null);setRecipeError("");}} label="提示词配方" ariaLabel="提示词配方详情" dataAttribute="prompt-recipe-inspector" header={<h2 className="font-semibold">{selectedRecipe?.title}</h2>} sections={[]} footer={<div className="flex flex-wrap items-center gap-2"><Button disabled={saving||!selectedRecipe} onClick={()=>{setSelectedRecipe(null);setRecipeVersions([]);setRecipeUse(null);}}>关闭</Button><Button disabled={saving||!selectedRecipe||selectedRecipe.state==="archived"} onClick={()=>void archiveRecipe()}>归档</Button><Button variant="primary" disabled={saving||!selectedRecipe||selectedRecipe.state==="archived"} onClick={()=>void useRecipe()}>{saving?"正在读取…":"填入草稿预览"}</Button></div>}>
   {selectedRecipe&&<div className="space-y-4 p-4"><div className="flex flex-wrap gap-2"><Pill>{ownerLabel(selectedRecipe.owner)}</Pill><Pill>{promptKindLabels[selectedRecipe.kind]}</Pill><Pill tone={recipeTone(selectedRecipe.content_state)}>{recipeStateLabel(selectedRecipe.content_state)}</Pill><Pill>修订 {selectedRecipe.revision}</Pill></div><dl className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-line text-xs"><div className="bg-panel p-3"><dt className="text-muted">项目</dt><dd className="mt-1 break-all text-ink">{selectedRecipe.project_ref}</dd></div><div className="bg-panel p-3"><dt className="text-muted">来源版本</dt><dd className="mt-1 text-ink">{selectedRecipe.source.owner_version ? `v${selectedRecipe.source.owner_version}` : "未提供"}</dd></div><div className="col-span-full bg-panel p-3"><dt className="text-muted">来源引用</dt><dd className="mt-1 break-all font-mono text-ink">{selectedRecipe.source.owner_prompt_ref || selectedRecipe.source.source_kind}</dd></div>{selectedRecipe.source.source_digest&&<div className="col-span-full bg-panel p-3"><dt className="text-muted">正文摘要</dt><dd className="mt-1 break-all font-mono text-ink">{selectedRecipe.source.source_digest}</dd></div>}</dl>{selectedRecipe.notes&&<p className="text-sm text-muted">{selectedRecipe.notes}</p>}<div className="flex flex-wrap gap-1.5">{selectedRecipe.tags.map(tag=><Pill key={tag} size="sm">{tag}</Pill>)}</div>{recipeError&&<InlineNotice tone="warning">{readableError(recipeError)}</InlineNotice>}{recipeUse&&<InlineNotice tone={recipeUse.availability==="available"?"info":"warning"}>{recipeUse.availability==="available"?"已读取 owner 正文，草稿尚未提交。":`暂不能使用：${recipeUse.blockers.join("、")}`}</InlineNotice>}<div><h3 className="mb-2 text-xs font-semibold text-ink">修订历史</h3>{recipeBusy&&recipeVersions.length===0?<SkeletonRows rows={3}/>:<div className="space-y-2">{recipeVersions.map(version=><div key={version.revision} className="rounded-control border border-line p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">v{version.revision} · {version.title}</span><span className="text-muted">{version.created_at}</span></div><div className="mt-1 text-muted">{recipeStateLabel(version.content_state)} · {version.source.owner_prompt_ref || version.source.source_kind}</div></div>)}</div>}</div><p className="text-2xs text-muted">配方只保存引用和摘要。使用时会重新向 owner 审计读取正文，确认后才填入当前草稿。</p></div>}
  </InspectorShell>
 </div>;
}
