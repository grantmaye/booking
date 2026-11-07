// Offline fallback only. Never cache account pages, API responses, or private records.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode!=='navigate')return;event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Chairside offline</title><body><h1>You’re offline.</h1><p>Reconnect to manage your bookings. Your private records are not cached on this device.</p><button onclick="location.reload()">Try again</button></body></html>',{headers:{'Content-Type':'text/html'}})));});
