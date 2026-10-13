/* Browser-local preview only. Files never become domain assets or leave the browser. */
(()=>{'use strict';
const V=window.YeismeViews,D=window.YeismeDetails,{E,icon}=V;
const button=(text,action,extra='')=>`<button class="btn" type="button" data-media="${action}" ${extra}>${text}</button>`;
let local=null,epoch=0,picker=null;
const size=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const fileIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 3H5v18h14V8Z M14 3v5h5M8 12h8M8 16h6"/></svg>';
const typeIcon=type=>type==='image'?icon('photo'):type==='audio'?icon('wave'):type==='video'?icon('film'):fileIcon;
function preview({type,src,content='available',label='',localFile=false,text,unsupported=false}){
 const present=content==='available'&&!!src&&!unsupported;
 const image=present&&type==='image';
 let media='';
 if(image)media=`<img id="workspace-image" src="${E(src)}" alt="${localFile?'本地图片，仅在本机预览':'参考摄影，非真实生成产物'}">`;
 else if(present&&['audio','video'].includes(type))media=`${type==='audio'?`<div class="audio-art">${typeIcon(type)}<span>本地音频</span><small>使用下方播放器试听</small></div>`:''}<${type} id="workspace-player" controls preload="metadata" ${type==='video'?'playsinline':''} src="${E(src)}" aria-label="本地${type==='audio'?'音频':'视频'}预览"></${type}>`;
 else if(present&&type==='text')media=`<pre class="text-preview" tabindex="0" aria-label="文件文本内容">${E(text||'（空文件）')}</pre>`;
 else media=`<div class="media-state"><span class="media-state-icon">${typeIcon(type)}</span><h3>${E(label||'暂不支持内嵌预览')}</h3><p>${localFile?'文件保留在当前浏览器，可下载后用本机应用打开。':content==='forbidden'?'当前身份无内容读取权限。可查看允许访问的元数据。':content==='missing_bytes'?'已有文件引用，但尚未提供可读取的内容字节。':'尚未采集来源内容，不根据引用构造媒体。'}</p><span class="media-state-tag">${localFile?'本地文件':'仅元数据'}</span></div>`;
 return `<section class="asset-preview-column"><div class="preview-controls"><span class="preview-type">${typeIcon(type)}${image?'图像预览':type==='audio'?'音频预览':type==='video'?'视频预览':'文件预览'}</span>${image?`<div class="row"><select class="preview-mode" id="preview-mode" aria-label="图片适配方式"><option value="fit">适应窗口</option><option value="width">适应宽度</option><option value="original">原始比例 1:1</option><option value="custom" hidden>自定义比例</option></select><select class="preview-zoom" id="preview-zoom" aria-label="图片缩放比例"><option value="fit">适应</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option><option value="custom" hidden>自定义</option></select><button class="icon" data-view="zoom:out" aria-label="缩小预览">−</button><output id="zoom-label">适应</output><button class="icon" data-view="zoom:in" aria-label="放大预览">+</button>${button('背景','background','aria-label="切换图片背景"')}</div>`:''}</div><div class="media-feedback" role="status" aria-live="polite">${present&&type!=='text'?'正在读取预览…':''}</div><figure class="media-stage ${present?'':'media-unavailable'} media-${E(type)}" data-state="${present&&type!=='text'?'loading':'ready'}" data-preview-kind="${E(type)}">${media}</figure><div class="preview-facts"><span data-media-metadata>${present&&type==='text'?'纯文本 · 不执行文件内容':present?'等待文件信息':'内容不可用'}</span><span>${localFile?'仅本机':'参考素材'}</span></div><div class="media-error" hidden role="alert"><strong>未能读取预览</strong><p>文件可能损坏、读取失败，或浏览器不支持此编码。原记录保持不变。</p>${image?button('重新读取预览','retry'):''}${localFile?button('选择其他文件','choose'):''}</div><p class="preview-caption">${localFile?'本地预览 · 未上传，不加入项目资产':present?'参考摄影 · 不代表真实产物':'固定版本的引用与内容权限分别保留'}</p></section>`;
}
function ready(){
 const root=document.querySelector('#detail'),stage=root?.querySelector('.media-stage[data-preview-kind]');if(!stage)return;
 const media=stage.querySelector('img,audio,video'),feedback=root.querySelector('.media-feedback'),meta=root.querySelector('[data-media-metadata]'),error=root.querySelector('.media-error');
 if(!media)return;
 const fail=()=>{stage.dataset.state='error';feedback.textContent='预览不可用';error.hidden=false;meta.textContent='未取得媒体信息';};
 const loaded=()=>{stage.dataset.state='ready';feedback.textContent='';error.hidden=true;if(media.tagName==='IMG')meta.textContent=`${media.naturalWidth} × ${media.naturalHeight} px`;else{const duration=Number.isFinite(media.duration)?`${Math.floor(media.duration/60)}:${String(Math.floor(media.duration%60)).padStart(2,'0')}`:'时长未提供';meta.textContent=(media.tagName==='VIDEO'?`${media.videoWidth} × ${media.videoHeight} · `:'')+duration;}};
 media.addEventListener('error',fail);media.addEventListener(media.tagName==='IMG'?'load':'loadedmetadata',loaded);
 if(media.tagName==='IMG'&&media.complete){media.naturalWidth?loaded():fail();}else if(media.readyState>=1)loaded();
 media.addEventListener('waiting',()=>{feedback.textContent='正在缓冲…';});media.addEventListener('playing',()=>{feedback.textContent='';});
}
function release(){epoch++;if(local){URL.revokeObjectURL(local.url);local=null;}}
function beforeOpen(type){if(type!=='local-preview')release();}
function choose(){window.YeismeCompact.leave(()=>{if(!picker){picker=document.createElement('input');picker.type='file';picker.hidden=true;picker.setAttribute('aria-label','选择本地预览文件');document.body.append(picker);picker.addEventListener('change',()=>{const file=picker.files?.[0];picker.value='';if(file)readFile(file);});}picker.click();});}
async function readFile(file){
 if(file.size>64*1024*1024){window.YeismeApp.toast('本地预览支持不超过 64 MB 的文件。');return;}
 release();const current=epoch;
 const type=file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':/\.(txt|md|csv|json|log|srt|vtt)$/i.test(file.name)||file.type==='text/plain'?'text':'file';
 const unsupported=type==='file'||(type==='text'&&file.size>512*1024);
 let text='';
 try{if(type==='text'&&!unsupported)text=await file.text();}catch{if(current===epoch)window.YeismeApp.toast('无法读取该本地文件，请重新选择。');return;}
 if(current!==epoch)return;
 local={id:'local-'+current,name:file.name,mime:file.type||'未提供',size:file.size,type,text,unsupported,url:URL.createObjectURL(file)};
 window.YeismeApp.open('local-preview',local.id);
}
const priorRender=D.render;
D.render=function(){if(window.YeismeSession.state.detail?.type!=='local-preview')return priorRender();if(!local)return {title:'本地预览已关闭',body:'重新选择本地文件以继续。'};
 return {title:E(local.name),subtitle:'本地文件 · 未上传',body:`<div class="asset-workspace-grid local-file-preview">${preview({type:local.type,src:local.url,text:local.text,unsupported:local.unsupported,localFile:true,label:local.type==='text'&&local.unsupported?'文本超过 512 KB 预览限制':''})}<aside class="asset-properties"><section class="detail-group" data-tone="execution"><header><h3>文件信息</h3></header>${window.YeismeWorkbench.fields([['文件名',local.name],['类型',local.mime],['大小',size(local.size)],['来源','此设备 · 未上传'],['项目绑定','无 · 不修改当前项目']])}</section><p class="local-preview-note">关闭或切换范围后释放预览。最大 64 MB；文本最大 512 KB。浏览器不支持的编码不会自动转换。</p></aside></div>`,footer:`${button('选择其他文件','choose')}<a class="btn" href="${local.url}" download="${E(local.name)}">下载本地副本</a><button class="btn" data-action="close">关闭</button>`};
};
document.addEventListener('click',event=>{const el=event.target.closest('[data-media]');if(!el)return;event.preventDefault();const action=el.dataset.media;if(action==='choose')choose();if(action==='background'){const stage=document.querySelector('.media-stage');stage.dataset.background=stage.dataset.background==='dark'?'checker':'dark';el.setAttribute('aria-pressed',String(stage.dataset.background==='dark'));}if(action==='retry'){const img=document.querySelector('#workspace-image');if(img){document.querySelector('.media-error').hidden=true;img.closest('.media-stage').dataset.state='loading';document.querySelector('.media-feedback').textContent='正在重新读取预览…';img.src=img.getAttribute('src');}}},true);
window.addEventListener('pagehide',release);
window.YeismeMedia={preview,ready,release,beforeOpen,typeIcon};
})();
