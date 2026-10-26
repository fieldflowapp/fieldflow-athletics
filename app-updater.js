/* FieldFlow Athletics: online version gate for installed PWAs. */
(()=>{
 const script=document.currentScript;
 const base=new URL('./',script.src);
 const localVersion=Number(script.dataset.build||0);
 let checking=false;
 const key='ff-update-prompt';
 function show(version,message){
  if(document.getElementById(key))return;
  const overlay=document.createElement('div');overlay.id=key;
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483646;background:#061722f5;color:white;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui';
  overlay.innerHTML='<section style="background:#0b2638;border:1px solid #12c8ff;border-radius:18px;padding:24px;max-width:420px;width:100%;text-align:center"><h2 style="margin:0 0 12px">Versión obsoleta</h2><p style="line-height:1.5"></p><button style="background:#0b5fff;color:white;border:0;border-radius:10px;padding:14px 22px;font-weight:bold;width:100%">Actualizar ahora</button><small style="display:block;margin-top:12px;color:#b9ccd7">Necesitas conexión a internet. No es necesario reinstalar.</small></section>';
  overlay.querySelector('p').textContent=message||'Hay una nueva versión disponible.';
  overlay.querySelector('button').onclick=async()=>{
   const btn=overlay.querySelector('button');btn.disabled=true;btn.textContent='Actualizando…';
   try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration(base.href);if(reg)await reg.update();}
    const url=new URL(location.href);url.searchParams.set('ffbuild',String(version));location.replace(url.href);
   }catch(e){btn.disabled=false;btn.textContent='Reintentar actualización';}
  };
  document.body.appendChild(overlay);
 }
 async function check(){
  if(checking||!navigator.onLine)return;checking=true;
  try{const res=await fetch(new URL('app-version.json?t='+Date.now(),base),{cache:'no-store'});
   if(!res.ok)return;const info=await res.json();const required=Number(info.minimumVersion||info.version);
   if(Number.isFinite(required)&&required>localVersion){show(info.version||required,info.message);return;}
  }catch(e){console.warn('FieldFlow update check unavailable',e)}
  finally{checking=false}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
 window.addEventListener('focus',check);window.addEventListener('online',check);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
 setInterval(check,60000);
})();