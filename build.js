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
      code = code.replace(/(['"`])\/(assets|b|api|!cover!)\//g, `$1${repoPrefix}$2/`);
      code = code.replace(/wss?:\/\/[a-zA-Z0-9.-]+\/wisp\/?/g, "wss://wisp.mercurywork.shop/");
      fs.writeFileSync(full, code, "utf8");
    }
  }
}

async function runBuild() {
  console.log("1. Mirroring initial production files...");
  try {
    execSync(
      `wget --mirror --no-parent --convert-links --adjust-extension --page-requisites ` +
      `--no-host-directories --directory-prefix="${distDir}" ` +
      `${upstreamHost}/`,
      { stdio: "inherit" }
    );
  } catch (e) {
    console.log("Initial mirror complete.");
  }

  const origHtml = path.join(distDir, "index.html");
  const appShellHtml = path.join(distDir, "app.html");

  if (!fs.existsSync(origHtml)) {
    for (const f of fs.readdirSync(distDir)) {
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

  // Determine hash directory used by assets (e.g. 20f91fe9a88a)
  let assetHashDir = "20f91fe9a88a";
  const assetsParent = path.join(distDir, "assets");
  if (fs.existsSync(assetsParent)) {
    for (const d of fs.readdirSync(assetsParent)) {
      if (fs.statSync(path.join(assetsParent, d)).isDirectory()) {
        assetHashDir = d;
        break;
      }
    }
  }

  // 2. Recursive spider to catch ALL dynamic chunks
  console.log(`2. Spidermining dynamic chunks for hash ${assetHashDir}...`);
  const knownAssets = new Set([
    // Explicit known failures from runtime logs
    "DK_3ESdGI_ak.js",
    "C4jsyO_Hz52E.js",
    "DGv8aKp0GoXR.js",
    "CcLA70Nwdkej.js",
    "H_PjY6_iZLOx.js",
    "BddaZkrO20eG.js",
    "DqtUK8-EIpN6.js",
    "DEWLmYI_-C5q.js",
    "CqmBnD6S4PLy.js",
    "DEz2lYRI65mJ.js",
    "Caj2LYFr3GhH.js",
    "Yf2u6mJbmdkN.js",
    "qUxjXZz8bCeo.js",
    "B9AQkL5aXPLO.js",
    "DEJoJwj_TZi8.js",
    "CUbMlW6JiVjS.js",
    "G6bmQJ4LeSaU.js",
    "BgmhFvNNpqlE.css",
    "Ds4AInl-voGA.css",
    "CvC0uaMeUIwq.css",
    "B7iY9mVTBbSe.css",
    "mZjD-goPHC1N.css",
    "BimkyYNarS_x.webp",
    "CI179FRhiUPm.webp"
  ]);

  const targetFolder = path.join(distDir, "assets", assetHashDir);
  fs.mkdirSync(targetFolder, { recursive: true });

  const chunkRegex = /[A-Za-z0-9_-]{12}\.(?:js|mjs|css|webp|png|wasm)/g;

  let scannedFiles = new Set();
  let queue = true;

  while (queue) {
    queue = false;
    const currentFiles = [];

    function collectJs(d) {
      if (!fs.existsSync(d)) return;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) collectJs(full);
        else if (/\.(js|mjs|html)$/i.test(ent.name) && !scannedFiles.has(full)) {
          currentFiles.push(full);
          scannedFiles.add(full);
        }
      }
    }
    collectJs(distDir);

    for (const f of currentFiles) {
      const content = fs.readFileSync(f, "utf8");
      const matches = content.match(chunkRegex);
      if (matches) {
        for (const m of matches) {
          if (!knownAssets.has(m)) {
            knownAssets.add(m);
            queue = true;
          }
        }
      }
    }

    for (const file of knownAssets) {
      const dest = path.join(targetFolder, file);
      if (!fs.existsSync(dest)) {
        const url = `${upstreamHost}/assets/${assetHashDir}/${file}`;
        const ok = await downloadFile(url, dest);
        if (ok) {
          queue = true;
          console.log(`Fetched asset: ${file}`);
        }
      }
    }
  }

  // 3. Fetch worker scripts (/b/)
  console.log("3. Fetching worker scripts...");
  const bFolder = path.join(distDir, "b");
  fs.mkdirSync(bFolder, { recursive: true });
  await downloadFile(`${upstreamHost}/b/61b104618b2c.js`, path.join(bFolder, "61b104618b2c.js"));

  // 4. Inject runtime Service Worker with local fallbacks
  console.log("4. Installing Service Worker...");
  const swCode = `
  const REPO_PREFIX = "${repoPrefix}";

  self.addEventListener("install", (e) => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Mock API
    if (url.pathname.includes("/api/presence") || url.pathname.includes("/api/stuff")) {
      return event.respondWith(
        new Response(JSON.stringify({ ok: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    // Rewrite domain-level asset paths (/assets/..., /b/...) to local repo paths
    if (url.origin === self.location.origin && !url.pathname.startsWith(REPO_PREFIX)) {
      if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/b/")) {
        const localPath = self.location.origin + REPO_PREFIX + url.pathname.slice(1) + url.search;
        return event.respondWith(fetch(localPath));
      }
    }

    // Intercept cover art and return a 1x1 transparent PNG fallback if not found
    if (url.pathname.includes("/!cover!/")) {
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
  });`;

  fs.writeFileSync(path.join(distDir, "sw-router.js"), swCode, "utf8");

  let appHtml = fs.readFileSync(appShellHtml, "utf8");
  const headShim = `
  <base href="${repoPrefix}">
  <script>
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("${repoPrefix}sw-router.js", { scope: "${repoPrefix}" })
        .catch(() => {});
    }
    try {
      localStorage.setItem("wisp-server", "wss://wisp.mercurywork.shop/");
      localStorage.setItem("bare-server", "wss://wisp.mercurywork.shop/");
    } catch(e) {}
  </script>`;

  appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n${headShim}`);
  fs.writeFileSync(appShellHtml, appHtml, "utf8");

  // 5. Patch file paths
  scanAndPatch(distDir);

  // 6. Generate 5,000 subdirectory endpoints
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

  // 7. Master Directory Dashboard
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

  // 8. 404 handler
  const fallbackHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script>window.location.replace("${repoPrefix}");</script>
</head>
<body></body>
</html>`;
  fs.writeFileSync(path.join(distDir, "404.html"), fallbackHtml);

  console.log("Build complete.");
}

runBuild();
