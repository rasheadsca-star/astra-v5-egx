'use strict';
const CACHE='astra-recommendations-v2';
const SHELL=['/recommendations','/recommendations-manifest.webmanifest','/recommendations-icon.svg'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/data/')||url.pathname.startsWith('/docs/data/')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }
  if(url.pathname==='/recommendations'||url.pathname==='/recommendations/'||url.pathname==='/recommendations-manifest.webmanifest'||url.pathname==='/recommendations-icon.svg'){
    event.respondWith(fetch(event.request).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r;
    }).catch(()=>caches.match(event.request).then(r=>r||caches.match('/recommendations'))));
  }
});