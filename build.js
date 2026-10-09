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

function patchCode(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchCode(full);
    } else if (/\.(html|js|mjs|css)$/i.test(entry.name)) {
      let code = fs.readFileSync(full, "utf8");

      // Rewrite root-relative assets to repository path
      code = code.replace(/(['"`])\/(assets|b|api|!cover!|controller\.sw\.js)\//g, `$1${repoPrefix}$2/`);
      code = code.replace(/(['"`])\/controller\.sw\.js/g, `$1${repoPrefix}controller.sw.js`);

      // Point backend POST /!!/ requests to the live upstream server instead of static GitHub Pages
      code = code.replace(/(['"`])\/!!\//g, `$1${upstreamHost}/!!/`);

      // Enforce live Wisp server
      code = code.replace(/wss?:\/\/[a-zA-Z0-9.-]+\/wisp\/?/g, "wss://wisp.mercurywork.shop/");

      fs.writeFileSync(full, code, "utf8");
    }
  }
}

async function runBuild() {
  console.log("1. Mirroring root production files...");
  try {
    execSync(
      `wget --mirror --no-parent --convert-links --adjust-extension --page-requisites ` +
      `--no-host-directories --directory-prefix="${distDir}" ` +
      `${upstreamHost}/`,
      { stdio: "inherit" }
    );
  } catch (e) {
    console.log("Base mirror complete.");
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

  // 2. Fetch the full chunk and asset manifest from the trace
  const hashDir = "20f91fe9a88a";
  const assetsTarget = path.join(distDir, "assets", hashDir);
  fs.mkdirSync(assetsTarget, { recursive: true });

  const chunkManifest = [
    // JS Chunks
    "UOdLBK0kdg2D.js", "BddaZkrO20eG.js", "DqtUK8-EIpN6.js", "G6bmQJ4LeSaU.js",
    "B3CqrJhTi617.js", "CPZGefi03ZTl.js", "H_PjY6_iZLOx.js", "DK_3ESdGI_ak.js",
    "C4jsyO_Hz52E.js", "DGv8aKp0GoXR.js", "CcLA70Nwdkej.js", "DEWLmYI_-C5q.js",
    "CqmBnD6S4PLy.js", "DEz2lYRI65mJ.js", "Caj2LYFr3GhH.js", "Yf2u6mJbmdkN.js",
    "qUxjXZz8bCeo.js", "B9AQkL5aXPLO.js", "DEJoJwj_TZi8.js", "CUbMlW6JiVjS.js",
    "Dt5oErwtlMtc.js", "ytZeOYrVXsFe.js", "Dh8ztjyrItSJ.js", "MPKSK0Li_GTn.js",
    "XIJNnfL8tqW0.js", "BKmok_OwGP0c.js",
    // CSS Bundles
    "Ds4AInl-voGA.css", "Cks2NftInTfc.css", "BgmhFvNNpqlE.css", "CvC0uaMeUIwq.css",
    "B7iY9mVTBbSe.css", "mZjD-goPHC1N.css", "xjQkSKhQ6l0o.css", "DLxFS7yvUPGa.css",
    "CkBwQCr_ktjH.css",
    // WebP Images & Media
    "BimkyYNarS_x.webp", "CI179FRhiUPm.webp", "BDxLTZBK0w1-.webp"
  ];

  console.log("2. Downloading all application chunks...");
  for (const file of chunkManifest) {
    const dest = path.join(assetsTarget, file);
    if (!fs.existsSync(dest)) {
      await downloadFile(`${upstreamHost}/assets/${hashDir}/${file}`, dest);
    }
  }

  // Fetch peaks background images
  const peaksTarget = path.join(distDir, "assets", "images", "peaks");
  fs.mkdirSync(peaksTarget, { recursive: true });
  for (const img of ["azu.webp", "kona.webp", "hachii.webp"]) {
    await downloadFile(`${upstreamHost}/assets/images/peaks/${img}`, path.join(peaksTarget, img));
  }

  // Fetch worker scripts (/b/)
  const bTarget = path.join(distDir, "b");
  fs.mkdirSync(bTarget, { recursive: true });
  await downloadFile(`${upstreamHost}/b/61b104618b2c.js`, path.join(bTarget, "61b104618b2c.js"));

  // Fetch and patch Lyra's actual Service Worker (controller.sw.js)
  console.log("3. Fetching and patching controller.sw.js...");
  const swDest = path.join(distDir, "controller.sw.js");
  await downloadFile(`${upstreamHost}/controller.sw.js`, swDest);

  if (fs.existsSync(swDest)) {
    let swContent = fs.readFileSync(swDest, "utf8");
    // Intercept API endpoints inside the worker
    const swShim = `
      // Lyra Static Shim
      const UPSTREAM = "${upstreamHost}";
      const REPO = "${repoPrefix}";

      const origFetch = self.fetch;
      self.fetch = async function(...args) {
        let url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        if (url.includes("/api/presence") || url.includes("/api/stuff")) {
          return new Response(JSON.stringify({ ok: true, data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/!cover!/")) {
          return new Response(
            Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]),
            { status: 200, headers: { "Content-Type": "image/png" } }
          );
        }
        return origFetch.apply(this, args);
      };
    `;
    swContent = swShim + "\n" + swContent;
    fs.writeFileSync(swDest, swContent, "utf8");
  }

  // 4. Inject base tag and configuration seed into app.html
  let appHtml = fs.readFileSync(appShellHtml, "utf8");
  const headShim = `
  <base href="${repoPrefix}">
  <script>
    (function() {
      try {
        localStorage.setItem("wisp-server", "wss://wisp.mercurywork.shop/");
        localStorage.setItem("bare-server", "wss://wisp.mercurywork.shop/");
      } catch(e) {}
    })();
  </script>`;
  appHtml = appHtml.replace(/<head([^>]*)>/i, `<head$1>\n${headShim}`);
  fs.writeFileSync(appShellHtml, appHtml, "utf8");

  // 5. Sweep and update all static file links
  console.log("4. Patching paths across dist...");
  patchCode(distDir);

  // 6. Generate 5,000 subfolders
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

  // 7. Directory index dashboard
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

  // 8. Fallback 404 handler
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
