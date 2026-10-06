const CACHE='fieldflow-athletics-v9';
const SHELL=['./cross-country/','./','./manifest.webmanifest','./icons/icon-192.png',];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin!==location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(event.request,x));return r;}).catch(()=>caches.match(event.request).then(r=>r||caches.match('./'))));
    return;
  }
  event.respondWith(fetch(event.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(event.request,x));return r;}).catch(()=>caches.match(event.request)));
});