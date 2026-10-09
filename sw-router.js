
  const REPO_PREFIX = "/5k-links-10-9-2026-v2/";

  self.addEventListener("install", (e) => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Mock API
    if (url.pathname.includes("/5k-links-10-9-2026-v2/api/presence") || url.pathname.includes("/5k-links-10-9-2026-v2/api/stuff")) {
      return event.respondWith(
        new Response(JSON.stringify({ ok: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    // Rewrite domain-level asset paths (/assets/..., /b/...) to local repo paths
    if (url.origin === self.location.origin && !url.pathname.startsWith(REPO_PREFIX)) {
      if (url.pathname.startsWith("/5k-links-10-9-2026-v2/assets/") || url.pathname.startsWith("/5k-links-10-9-2026-v2/b/")) {
        const localPath = self.location.origin + REPO_PREFIX + url.pathname.slice(1) + url.search;
        return event.respondWith(fetch(localPath));
      }
    }

    // Intercept cover art and return a 1x1 transparent PNG fallback if not found
    if (url.pathname.includes("/5k-links-10-9-2026-v2/!cover!/")) {
      return event.respondWith(
        fetch(event.request).then(res => {
          if (res.status === 404) {
            return new Response(
              Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]),
              { status: 200, headers: { "Content-Type": "image/png" } }
            );
          }
          return res;
        }).catch(() => new Response("", { status: 200 }))
      );
    }
  });