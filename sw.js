const CACHE_NAME = "cozy-reader-v4";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.json","./clicker.html","./rpg.html"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.allSettled(ASSETS.map(url => cache.add(url))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event =>
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(hit =>
      hit || fetch(event.request).then(response => {
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() =>
        event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()
      )
    )
  );
});
