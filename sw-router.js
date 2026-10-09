
  const UPSTREAM = "https://lytothera.govt.hu";
  const REPO_PREFIX = "/5k-links-10-9-2026-v2/";

  self.addEventListener("install", (e) => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Mock API responses
    if (url.pathname.includes("/5k-links-10-9-2026-v2/api/presence") || url.pathname.includes("/5k-links-10-9-2026-v2/api/stuff")) {
      return event.respondWith(
        new Response(JSON.stringify({ ok: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    // Intercept domain-root asset lookups (/assets/..., /b/..., /!cover!/...)
    if (url.origin === self.location.origin && !url.pathname.startsWith(REPO_PREFIX)) {
      if (
        url.pathname.startsWith("/5k-links-10-9-2026-v2/assets/") ||
        url.pathname.startsWith("/5k-links-10-9-2026-v2/b/") ||
        url.pathname.startsWith("/5k-links-10-9-2026-v2/!cover!/")
      ) {
        const redirectUrl = self.location.origin + REPO_PREFIX + url.pathname.slice(1) + url.search;
        return event.respondWith(
          fetch(redirectUrl).then((res) => {
            if (res.status === 404) {
              return fetch(UPSTREAM + url.pathname + url.search, { mode: "cors" });
            }
            return res;
          }).catch(() => fetch(UPSTREAM + url.pathname + url.search))
        );
      }
    }

    // Fallback missing 404 assets to upstream
    if (url.pathname.startsWith(REPO_PREFIX + "assets/") || url.pathname.startsWith(REPO_PREFIX + "!cover!/")) {
      return event.respondWith(
        fetch(event.request).then((res) => {
          if (res.status === 404) {
            const rawSubPath = url.pathname.replace(REPO_PREFIX, "/");
            return fetch(UPSTREAM + rawSubPath + url.search);
          }
          return res;
        })
      );
    }
  });