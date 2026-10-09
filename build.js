const fs = require("fs");
const path = require("path");
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

function patchCode(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchCode(full);
    } else if (/\.(html|js|mjs|css)$/i.test(entry.name)) {
      let code = fs.readFileSync(full, "utf8");
      
      // Fix root-relative asset prefixes in compiled bundles
      code = code.replace(/(['"])\/(assets|b|api|!cover!)\//g, `$1${repoPrefix}$2/`);
      
      fs.writeFileSync(full, code, "utf8");
    }
  }
}

async function runBuild() {
  console.log("Mirroring upstream source...");
  try {
    execSync(
      `wget --mirror --no-parent --convert-links --adjust-extension --page-requisites ` +
      `--no-host-directories --directory-prefix="${distDir}" ` +
      `${upstreamHost}/`,
      { stdio: "inherit" }
    );
  } catch (e) {
    console.log("Initial download complete.");
  }

  // Ensure root index.html is moved to app.html
  const origHtml = path.join(distDir, "index.html");
  const appShellHtml = path.join(distDir, "app.html");

  if (!fs.existsSync(origHtml)) {
    const candidates = fs.readdirSync(distDir);
    for (const c of candidates) {
      const p = path.join(distDir, c, "index.html");
      if (fs.existsSync(p)) {
        fs.cpSync(path.join(distDir, c), distDir, { recursive: true });
        break;
      }
    }
  }

  if (fs.existsSync(origHtml)) {
    fs.renameSync(origHtml, appShellHtml);
  } else {
    console.error("Fatal: Failed to download base index.html");
    process.exit(1);
  }

  // Inject upstream asset fallback and mock API interceptor into app.html
  let appHtml = fs.readFileSync(appShellHtml, "utf8");

  const interceptorScript = `
  <base href="${repoPrefix}">
  <script>
    (function() {
      const REPO_PREFIX = "${repoPrefix}";
      const UPSTREAM = "${upstreamHost}";
      
      // Auto-fallback for fetch
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        let url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        
        // Mock non-existent API endpoints
        if (url.includes("/api/presence") || url.includes("/api/stuff")) {
          return new Response(JSON.stringify({ ok: true, data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        // Redirect 404 asset chunks and images to upstream origin
        if (url.startsWith(window.location.origin) && !url.includes(REPO_PREFIX)) {
          const relativePath = url.replace(window.location.origin, "");
          if (relativePath.startsWith("/assets/") || relativePath.startsWith("/b/") || relativePath.startsWith("/!cover!/")) {
            url = UPSTREAM + relativePath;
            if (typeof args[0] === "string") args[0] = url;
            else args[0].url = url;
          }
        }
        
        try {
          const res = await origFetch.apply(this, args);
          if (res.status === 404 && (url.includes("/assets/") || url.includes("/b/") || url.includes("/!cover!/"))) {
            const upUrl = UPSTREAM + url.substring(url.indexOf("/assets/"));
            return origFetch(upUrl);
          }
          return res;
        } catch (e) {
          return origFetch.apply(this, args);
        }
      };

      // Set Wisp default
      try {
        localStorage.setItem("wisp-server", "wss://wisp.mercurywork.shop/");
        localStorage.setItem("bare-server", "wss://wisp.mercurywork.shop/");
      } catch(e) {}
    })();
  </script>`;

  appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n${interceptorScript}`);
  fs.writeFileSync(appShellHtml, appHtml, "utf8");

  // Patch references inside existing static files
  patchCode(distDir);

  // Subfolder template
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

  // 5,000 unique paths
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

  // Root Directory Index Dashboard
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
  console.log("Build and interceptors deployed successfully.");
}

runBuild();
