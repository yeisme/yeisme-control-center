/* Presentation-only panels and fields. No service requests or domain writes. */
(()=>{'use strict';
const $=s=>document.querySelector(s),wide=matchMedia('(min-width:1440px)');
let dirty=false,pending=null,formKind='',widths={detail:400,form:480},resizing=false;
try{Object.assign(widths,JSON.parse(localStorage.getItem('yeisme:v13:panels')||'{}'));}catch{}
const dialog=()=>$('#detail'),state=()=>window.YeismeSession?.state;
function kind(){return ['invite','config-preview'].includes(state()?.detail?.type)||!!$('#config-label')?'form':'detail';}
function limit(){return Math.min(640,innerWidth-(document.body.classList.contains('collapsed')?64:232)-560);}
function setWidth(value,persist=false){const k=kind();widths[k]=Math.max(360,Math.min(limit(),Number(value)|| (k==='form'?480:400)));document.body.style.setProperty('--inspector-width',widths[k]+'px');const h=$('#panel-resize');if(h){h.setAttribute('aria-valuenow',widths[k]);h.setAttribute('aria-valuemax',limit());}if(persist)try{localStorage.setItem('yeisme:v13:panels',JSON.stringify(widths));}catch{}}
function sync(){document.querySelectorAll('[role=tab]').forEach(b=>b.tabIndex=b.getAttribute('aria-selected')==='true'?0:-1);const d=dialog(),s=state();if(!d||!s)return;const focused=document.activeElement,scroll=d.querySelector('.detail-body')?.scrollTop||0;
 const dock=!!s.detail&&wide.matches&&!s.full&&!d.classList.contains('cinematic')&&!d.classList.contains('search-dialog');
 const mode=s.detail?(dock?'dock':'modal'):'closed';
 if(d.dataset.mode!==mode){if(d.open)d.close();d.dataset.mode=mode;if(mode==='dock')d.show();if(mode==='modal')d.showModal();if(focused?.isConnected)focused.focus({preventScroll:true});}
 document.body.classList.toggle('inspector-open',dock);document.body.classList.toggle('modal-open',mode==='modal');d.classList.toggle('docked',dock);d.classList.toggle('full',!!s.full);
 if(mode==='dock'){d.setAttribute('aria-modal','false');setWidth(widths[kind()]);}else d.setAttribute('aria-modal',String(mode==='modal'));
 const body=d.querySelector('.detail-body');if(body)body.scrollTop=scroll;
 document.querySelectorAll('[data-task-id]').forEach(r=>{r.classList.toggle('selected',s.detail?.type==='task'&&r.dataset.taskId===s.detail.id);});
 document.querySelectorAll('[data-action=collapse]').forEach(b=>b.setAttribute('aria-expanded',String(!document.body.classList.contains('collapsed'))));
}
function clear(){dirty=false;formKind='';document.body.classList.remove('inspector-open','modal-open');dialog().dataset.mode='closed';}
function validate(el){const invalid=el.required&&!el.value.trim()||!el.validity.valid;const err=document.getElementById(el.id+'-error');el.setAttribute('aria-invalid',String(invalid));if(err)err.textContent=invalid?(el.validity.valueMissing?'请填写此字段。':'请检查输入格式。'):'';return !invalid;}
function enhance(){const d=dialog();if(!d)return;const next=state()?.detail?.type;if(next!==formKind){dirty=false;formKind=next;}
 d.insertAdjacentHTML('afterbegin','<div id="panel-resize" role="separator" tabindex="0" aria-label="调整详情宽度" aria-orientation="vertical" aria-valuemin="360" aria-valuemax="640" aria-valuenow="400"></div>');
 d.querySelectorAll('form').forEach(f=>f.noValidate=true);
 d.querySelectorAll('.product-form input,.product-form select,#config-label').forEach((el,i)=>{if(el.type==='checkbox')return;el.id=el.id||'panel-field-'+i;const label=el.closest('label');if(label)label.htmlFor=el.id;el.setAttribute('aria-required',String(el.required));
 if(!document.getElementById(el.id+'-error')){const holder=label||el.parentElement;holder.classList.add('form-field');const help=document.createElement('small');help.id=el.id+'-help';help.className='field-help';help.textContent=el.readOnly?'当前范围已固定，不可编辑。':el.required?'必填 · 仅用于交接预览':'用于本地交接预览';const err=document.createElement('small');err.id=el.id+'-error';err.className='field-error';err.setAttribute('aria-live','polite');holder.append(help,err);el.setAttribute('aria-describedby',help.id+' '+err.id);}
 });
}
function confirmLeave(run){pending=run;let c=$('#draft-confirm');if(!c){c=document.createElement('dialog');c.id='draft-confirm';c.setAttribute('aria-labelledby','draft-title');c.innerHTML='<h2 id="draft-title">保留这次修改？</h2><p>这份交接预览尚未提交。离开后会放弃当前输入。</p><div class="row"><button class="primary" data-draft="keep">继续编辑</button><button class="btn" data-draft="discard">放弃修改</button></div>';document.body.append(c);}c.showModal();c.querySelector('button').focus();c.oncancel=e=>{e.preventDefault();c.close();pending=null;};}
window.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.dataset.draft){e.stopImmediatePropagation();$('#draft-confirm').close();if(b.dataset.draft==='discard'){dirty=false;window.YeismeProduct?.discardDraft();const run=pending;pending=null;run?.();}else pending=null;return;}
 const cmd=b.dataset.command||b.dataset.action||'';
 if(dirty&&/^(close$|nav:|task:|media:|service:|detailtab:|project|studio|active$|history$|member:|invite$|search$)/.test(cmd)){e.preventDefault();e.stopImmediatePropagation();confirmLeave(()=>b.click());}
 if(cmd==='config-preview')dirty=false;
},true);
window.addEventListener('click',e=>{if(e.target===dialog()&&dirty){e.preventDefault();e.stopImmediatePropagation();confirmLeave(()=>window.YeismeApp.close());}},true);
window.addEventListener('input',e=>{if(e.target.closest('#detail')&&(e.target.matches('.product-form input,.product-form select,#config-label'))){dirty=true;if(e.target.getAttribute('aria-invalid')==='true')validate(e.target);}},true);
window.addEventListener('change',e=>{if(e.target.matches('#detail .product-form select'))dirty=true;
 if(['scope','scenario'].includes(e.target.id)){dirty=false;$('#draft-confirm')?.close();pending=null;}
},true);
window.addEventListener('blur',e=>{if(e.target.matches('#detail .product-form input,#config-label'))validate(e.target);},true);
window.addEventListener('submit',e=>{if(e.target.id!=='invite-form')return;let first=null;e.target.querySelectorAll('input,select').forEach(el=>{if(!validate(el)&&!first)first=el;});if(first){e.preventDefault();e.stopImmediatePropagation();first.focus();}else dirty=false;},true);
window.addEventListener('keydown',e=>{const c=$('#draft-confirm');if(e.key==='Escape'&&dirty&&dialog()?.open&&!c?.open){e.preventDefault();e.stopImmediatePropagation();confirmLeave(()=>window.YeismeApp.close());return;}
 if(e.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){const tabs=[...e.target.closest('[role=tablist]').querySelectorAll('[role=tab]:not([disabled])')];let i=tabs.indexOf(e.target);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;const next=tabs[i],action=next.dataset.action;e.preventDefault();next.click();document.querySelector('[data-action="'+CSS.escape(action)+'"]')?.focus();return;}
 if(e.key==='Escape'&&dialog()?.dataset.mode==='dock'&&!c?.open){e.preventDefault();window.YeismeApp.close();}
 if(e.key==='Escape'&&$('#advanced-filters')&&!$('#advanced-filters').hidden&&!dialog().open){$('#advanced-filters').hidden=true;const b=$('[data-command=advanced]');b.setAttribute('aria-expanded','false');b.focus();}
 if(e.target.id==='panel-resize'){let v=widths[kind()];if(e.key==='ArrowLeft')v+=16;else if(e.key==='ArrowRight')v-=16;else if(e.key==='Home')v=360;else if(e.key==='End')v=limit();else return;e.preventDefault();setWidth(v,true);}
},true);
document.addEventListener('pointerdown',e=>{if(e.target.id!=='panel-resize')return;resizing=true;e.target.setPointerCapture(e.pointerId);document.body.classList.add('resizing');});
document.addEventListener('pointermove',e=>{if(resizing)setWidth(innerWidth-e.clientX);});
document.addEventListener('pointerup',()=>{if(resizing){resizing=false;document.body.classList.remove('resizing');setWidth(widths[kind()],true);}});
document.addEventListener('dblclick',e=>{if(e.target.id==='panel-resize')setWidth(kind()==='form'?480:400,true);});
let currentURL=location.href;window.addEventListener('popstate',e=>{if(!dirty)return;const destination=location.href;e.stopImmediatePropagation();history.replaceState(null,'',currentURL);confirmLeave(()=>{history.replaceState(null,'',destination);dispatchEvent(new PopStateEvent('popstate'));});},true);
window.addEventListener('click',()=>{queueMicrotask(()=>currentURL=location.href);});
window.addEventListener('resize',sync);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.YeismeCompact={sync,enhance,clear,rememberURL(){currentURL=location.href;}};
})();
