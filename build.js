const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const distDir = path.join(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, ".nojekyll"), "");

const repoName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split("/")[1]
  : "5k-links-10-9-2026-v2";
const repoPrefix = `/${repoName}/`;
const upstreamHost = "https://lytothera.govt.hu";

function downloadFile(url, dest) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode === 200) {
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(true);
        });
      } else {
        file.close();
        fs.rmSync(dest, { force: true });
        resolve(false);
      }
    }).on("error", () => {
      file.close();
      fs.rmSync(dest, { force: true });
      resolve(false);
    });
  });
}

function scanAndPatch(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanAndPatch(full);
    } else if (/\.(html|js|mjs|css)$/i.test(entry.name)) {
      let code = fs.readFileSync(full, "utf8");
      
      // Patch absolute paths in compiled code
      code = code.replace(/(['"`])\/(assets|b|api|!cover!)\//g, `$1${repoPrefix}$2/`);
      
      // Overwrite dead wisp server if hardcoded
      code = code.replace(/wss?:\/\/[a-zA-Z0-9.-]+\/wisp\/?/g, "wss://wisp.mercurywork.shop/");
      
      fs.writeFileSync(full, code, "utf8");
    }
  }
}

async function runBuild() {
  console.log("1. Mirroring base production assets from upstream...");
  try {
    execSync(
      `wget --mirror --no-parent --convert-links --adjust-extension --page-requisites ` +
      `--no-host-directories --directory-prefix="${distDir}" ` +
      `${upstreamHost}/`,
      { stdio: "inherit" }
    );
  } catch (e) {
    console.log("Initial download completed.");
  }

  // Ensure index.html exists
  const origHtml = path.join(distDir, "index.html");
  const appShellHtml = path.join(distDir, "app.html");

  if (!fs.existsSync(origHtml)) {
    const files = fs.readdirSync(distDir);
    for (const f of files) {
      const p = path.join(distDir, f, "index.html");
      if (fs.existsSync(p)) {
        fs.cpSync(path.join(distDir, f), distDir, { recursive: true });
        break;
      }
    }
  }

  if (fs.existsSync(origHtml)) {
    fs.renameSync(origHtml, appShellHtml);
  } else {
    console.error("Fatal: Failed to mirror index.html");
    process.exit(1);
  }

  // 2. Discover all chunk filenames referenced inside HTML, JS, and CSS files
  console.log("2. Scanning bundles for dynamic chunks...");
  const downloadedUrls = new Set();
  const chunkRegex = /(?:assets|b)\/[a-zA-Z0-9_./-]+\.(?:js|mjs|css|webp|png|svg|wasm)/g;

  function findChunksInDir(dir) {
    const list = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        list.push(...findChunksInDir(p));
      } else if (/\.(html|js|mjs|css)$/i.test(e.name)) {
        const text = fs.readFileSync(p, "utf8");
        const matches = text.match(chunkRegex);
        if (matches) list.push(...matches);
      }
    }
    return list;
  }

  const initialChunks = findChunksInDir(distDir);
  console.log(`Discovered ${initialChunks.length} asset references. Fetching missing chunks...`);

  for (const relPath of initialChunks) {
    const cleanRel = relPath.replace(/^\/+/, "");
    const localDest = path.join(distDir, cleanRel);
    if (!fs.existsSync(localDest) && !downloadedUrls.has(cleanRel)) {
      downloadedUrls.add(cleanRel);
      fs.mkdirSync(path.dirname(localDest), { recursive: true });
      await downloadFile(`${upstreamHost}/${cleanRel}`, localDest);
    }
  }

  // 3. Inject global SW router to intercept every request (HTML, JS import, CSS, image)
  console.log("3. Writing Service Worker router...");
  const swCode = `
  const UPSTREAM = "${upstreamHost}";
  const REPO_PREFIX = "${repoPrefix}";

  self.addEventListener("install", (e) => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Mock API responses
    if (url.pathname.includes("/api/presence") || url.pathname.includes("/api/stuff")) {
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
        url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/b/") ||
        url.pathname.startsWith("/!cover!/")
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
  });`;

  fs.writeFileSync(path.join(distDir, "sw-router.js"), swCode, "utf8");

  // Inject Base tag and SW registration into app.html
  let appHtml = fs.readFileSync(appShellHtml, "utf8");
  const headShim = `
  <base href="${repoPrefix}">
  <script>
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("${repoPrefix}sw-router.js", { scope: "${repoPrefix}" })
        .then(() => console.log("Router SW active"))
        .catch(() => {});
    }
    try {
      localStorage.setItem("wisp-server", "wss://wisp.mercurywork.shop/");
      localStorage.setItem("bare-server", "wss://wisp.mercurywork.shop/");
    } catch(e) {}
  </script>`;

  appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n${headShim}`);
  fs.writeFileSync(appShellHtml, appHtml, "utf8");

  // 4. Patch static references across all files
  scanAndPatch(distDir);

  // 5. Build Subdirectory wrappers
  const pageTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe src="${repoPrefix}app.html" allow="fullscreen; clipboard-read; clipboard-write"></iframe>
</body>
</html>`;

  const TOTAL_PAGES = 5000;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

  function getRandomSegment(minLen = 4, maxLen = 10) {
    const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    let seg = "";
    for (let i = 0; i < len; i++) seg += chars.charAt(Math.floor(Math.random() * chars.length));
    return seg;
  }

  function getNestedPath(minSegments = 2, maxSegments = 4) {
    const depth = Math.floor(Math.random() * (maxSegments - minSegments + 1)) + minSegments;
    const segs = [];
    for (let i = 0; i < depth; i++) segs.push(getRandomSegment(4, 10));
    return segs.join("/");
  }

  const uniquePaths = new Set();
  while (uniquePaths.size < TOTAL_PAGES) {
    uniquePaths.add(getNestedPath(2, 4));
  }

  let masterLinksHtml = "";

  for (const nestedPath of uniquePaths) {
    const folderPath = path.join(distDir, nestedPath);
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, "index.html"), pageTemplate);
    masterLinksHtml += `<a class="card" href="${repoPrefix}${nestedPath}/">${nestedPath}</a>\n`;
  }

  // 6. Master Index
  const masterIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Directory Index</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117; color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 40px 20px; display: flex; flex-direction: column; align-items: center;
    }
    header { text-align: center; margin-bottom: 28px; max-width: 650px; width: 100%; }
    h1 { font-size: 28px; font-weight: 700; color: #f0f6fc; margin-bottom: 8px; }
    p { color: #8b949e; font-size: 14px; margin-bottom: 20px; }
    .search-box {
      width: 100%; padding: 12px 18px; border-radius: 8px; border: 1px solid #30363d;
      background: #161b22; color: #f0f6fc; font-size: 15px; outline: none;
    }
    .search-box:focus { border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; width: 100%; max-width: 1300px; }
    .card {
      display: flex; align-items: center; justify-content: center; background: #161b22;
      border: 1px solid #30363d; border-radius: 6px; padding: 12px; color: #58a6ff;
      text-decoration: none; font-size: 12px; font-family: monospace; word-break: break-all; text-align: center;
    }
    .card:hover { background: #21262d; border-color: #58a6ff; color: #79c0ff; transform: translateY(-2px); }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header>
    <h1>Directory Index</h1>
    <p>5,000 Nested Endpoints</p>
    <input type="text" id="filter" class="search-box" placeholder="Quick find path..." autocomplete="off" />
  </header>
  <main class="grid" id="link-grid">${masterLinksHtml}</main>
  <script>
    const filter = document.getElementById("filter");
    const links = document.querySelectorAll(".card");
    filter.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      links.forEach(card => card.classList.toggle("hidden", !card.textContent.toLowerCase().includes(term)));
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(distDir, "index.html"), masterIndexHtml);

  // 7. SPA 404 Redirect
  const fallbackHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script>
    window.location.replace("${repoPrefix}");
  </script>
</head>
<body></body>
</html>`;
  fs.writeFileSync(path.join(distDir, "404.html"), fallbackHtml);

  console.log("Build complete.");
}

runBuild();
