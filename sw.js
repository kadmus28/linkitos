const CACHE_NAME = "linkitos-shell-v11";
// Solo borra cachés propias: Media Tracker vive en el mismo dominio (kadmus28.github.io).
const APP_ROOT = new URL("./", self.registration.scope);
const SHELL = ["", "index.html", "styles.css?v=10", "app.js?v=10", "projects.js?v=10", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"].map((path) => new URL(path, APP_ROOT).toString());
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("linkitos-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && SHELL.some((url) => new URL(url).pathname === requestUrl.pathname)) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(new URL("index.html", APP_ROOT).toString()))));
});
