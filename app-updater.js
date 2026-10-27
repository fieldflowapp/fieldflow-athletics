/* FieldFlow Athletics build 31: mandatory online-version gate for all modules.
   UI enforcement is complemented by fresh navigation; authoritative write security
   must still be enforced server-side for clients without this script. */
(()=>{
 'use strict';
 const script=document.currentScript;
 const base=new URL('./',script.src);
 const localVersion=Number(script.dataset.build||0);
 let checking=false,minimum=0,latest=0,lastMessage='',needsUpdate=false;
 const key='ff-update-prompt';
 const safe=()=>{try{return typeof window.ffCanUpdate==='function'?!!window.ffCanUpdate():true}catch(_){return false}};
 const text=(id,t)=>{const x=document.getElementById(id);if(x)x.textContent=t};
 const show=(title,message,button,blocked)=>{
  let overlay=document.getElementById(key);
  if(!overlay){
   overlay=document.createElement('div');overlay.id=key;
   overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');
   overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:#061722f5;color:white;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui';
   overlay.innerHTML='<section style="background:#0b2638;border:1px solid #12c8ff;border-radius:18px;padding:24px;max-width:430px;width:100%;text-align:center"><h2 id="ffUpdateTitle" style="margin:0 0 12px"></h2><p id="ffUpdateMessage" style="line-height:1.5"></p><button id="ffUpdateButton" type="button" style="background:#0b5fff;color:white;border:0;border-radius:10px;padding:14px 22px;font-weight:bold;width:100%"></button><small id="ffUpdateNote" style="display:block;margin-top:12px;color:#b9ccd7"></small></section>';
   document.body.appendChild(overlay);
   overlay.querySelector('button').addEventListener('click',async()=>{
    if(!safe()){show('Actualización pendiente','Termina la grabación, guarda los resultados y descarga el video antes de actualizar.','Esperando finalización',true);return}
    if(!needsUpdate){await check();return}
    const btn=overlay.querySelector('button');btn.disabled=true;btn.textContent='Actualizando…';
    try{
     if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.getRegistration(base.href);
      if(reg)await reg.update();
     }
     const url=new URL(location.href);
     url.searchParams.set('ffbuild',String(latest||minimum||localVersion));
     url.searchParams.set('ffrefresh',String(Date.now()));
     location.replace(url.href);
    }catch(e){btn.disabled=false;btn.textContent='Reintentar actualización';}
   });
  }
  text('ffUpdateTitle',title);
  text('ffUpdateMessage',message);
  text('ffUpdateButton',button);
  text('ffUpdateNote',blocked?'No se interrumpirá una grabación ni un guardado pendiente.':'Se necesita internet para validar la versión oficial.');
  overlay.querySelector('button').disabled=blocked;
 };
 function clear(){const el=document.getElementById(key);if(el)el.remove()}
 function display(){
  if(!safe()){
   // Never cover Review, recording, unsaved marks or downloads with a modal:
   // the athlete operator must be able to finish and protect results first.
   clear();
   return;
  }
  if(needsUpdate)show('Actualización obligatoria',lastMessage||'Esta versión ya no permite continuar.','Actualizar ahora',false);
  else clear();
 }
 async function check(){
  if(checking||!safe()&&needsUpdate)return;
  checking=true;
  try{
   if(!navigator.onLine)throw Error('sin conexión');
   const res=await fetch(new URL('app-version.json?nocache='+Date.now(),base),{cache:'no-store'});
   if(!res.ok)throw Error('No se pudo consultar la versión');
   const info=await res.json();
   minimum=Number(info.minimumVersion||info.version||0);latest=Number(info.version||minimum);
   if(!Number.isFinite(minimum)||minimum<1)throw Error('Número de versión inválido');
   lastMessage=info.message||'Actualiza FieldFlow Athletics para continuar.';
   needsUpdate=localVersion<minimum;
   display();
  }catch(err){
   console.warn('FieldFlow version validation unavailable',err);
   if(safe())show('Verificación pendiente','No se pudo verificar la versión oficial. Comprueba la conexión a internet y vuelve a intentarlo.','Reintentar',false);
  }finally{checking=false}
 }
 // Start the validation before allowing an old build to continue editing.
 const start=()=>{check();setInterval(()=>{if(needsUpdate)display();check()},15000)};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 window.addEventListener('focus',check);
 window.addEventListener('online',check);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
})();