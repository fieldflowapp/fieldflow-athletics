const CACHE='fieldflow-athletics-v17';
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin!==location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }
  event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match(event.request)));
});