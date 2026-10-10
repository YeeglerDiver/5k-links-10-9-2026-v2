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
const fullScramPrefix = `${repoPrefix}scram/`;
const TARGET_WISP = "wss://wisp.mercurywork.shop/";

function fetchFile(url, dest) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchFile(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(true);
        });
      } else {
        resolve(false);
      }
    }).on("error", () => resolve(false));
  });
}

async function runBuild() {
  console.log("1. Pulling static client runtime...");
  const tarPath = path.join(process.cwd(), "temp_core.tar.gz");
  execSync(`curl -sL "https://codeload.github.com/scientific-studying/svg/tar.gz/refs/heads/main" -o "${tarPath}"`);
  execSync(`tar -xzf "${tarPath}" -C "${distDir}" --strip-components=1`);
  fs.rmSync(tarPath, { force: true });

  console.log("2. Downloading BareMux assets...");
  const baremuxDir = path.join(distDir, "baremux");
  fs.mkdirSync(baremuxDir, { recursive: true });
  await fetchFile("https://unpkg.com/@mercuryworkshop/bare-mux@2.1.9/dist/index.js", path.join(baremuxDir, "index.js"));
  await fetchFile("https://unpkg.com/@mercuryworkshop/bare-mux@2.1.9/dist/worker.js", path.join(baremuxDir, "worker.js"));

  console.log("3. Downloading Epoxy transport assets...");
  const epoxyDir = path.join(distDir, "epoxy");
  fs.mkdirSync(epoxyDir, { recursive: true });
  for (const f of ["index.mjs", "index.js", "epoxy-transport.wasm", "epoxy-transport.js"]) {
    await fetchFile(`https://unpkg.com/@mercuryworkshop/epoxy-transport@3.0.1/dist/${f}`, path.join(epoxyDir, f));
  }

  // 4. Patch Scramjet prefix across scripts
  const prefixRegex = /(['"`])\/scram\//g;
  function patchAllScripts(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        patchAllScripts(full);
      } else if (/\.(js|mjs|json|html)$/i.test(ent.name)) {
        let code = fs.readFileSync(full, "utf8");
        code = code.replace(prefixRegex, `$1${fullScramPrefix}`);
        code = code.replace(/(['"`])\/baremux\//g, `$1${repoPrefix}baremux/`);
        code = code.replace(/(['"`])\/epoxy\//g, `$1${repoPrefix}epoxy/`);
        code = code.replace(/wss?:\/\/[a-zA-Z0-9.-]+\/wisp\/?/g, TARGET_WISP);
        fs.writeFileSync(full, code, "utf8");
      }
    }
  }
  patchAllScripts(distDir);

  // 5. Patch sw.js to ensure required object stores exist and provide in-memory fallback
  const swPath = path.join(distDir, "sw.js");
  if (fs.existsSync(swPath)) {
    let swCode = fs.readFileSync(swPath, "utf8");

    const swPatch = [
      'self.__scramjet$config = self.__scramjet$config || {',
      '  prefix: "' + fullScramPrefix + '",',
      '  codec: {',
      '    encode(str) {',
      '      if (!str) return str;',
      '      return encodeURIComponent(str.split("").map((c, i) => i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c).join(""));',
      '    },',
      '    decode(str) {',
      '      if (!str) return str;',
      '      const [input, ...search] = str.split("?");',
      '      return decodeURIComponent(input).split("").map((c, i) => i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c).join("") + (search.length ? "?" + search.join("?") : "");',
      '    }',
      '  }',
      '};',
      'const originalIDBOpen = indexedDB.open.bind(indexedDB);',
      'indexedDB.open = function(name, version) {',
      '  const req = originalIDBOpen(name, version);',
      '  req.addEventListener("upgradeneeded", (event) => {',
      '    const db = event.target.result;',
      '    const stores = ["config", "baremux", "sync", "settings", "__scramjet$config"];',
      '    for (const s of stores) {',
      '      if (!db.objectStoreNames.contains(s)) {',
      '        db.createObjectStore(s, { keyPath: "name" });',
      '      }',
      '    }',
      '  });',
      '  return req;',
      '};'
    ].join("\n");

    swCode = swPatch + "\n" + swCode;
    fs.writeFileSync(swPath, swCode);
  }

  // 6. Generate app.html
  const lyraAppHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>lyra</title>
  <base href="${repoPrefix}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d0d11; color: #e4e4e7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh; display: flex; flex-direction: column; justify-content: space-between;
      overflow-x: hidden;
    }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; }
    .badge { background: #1f1f23; padding: 4px 10px; border-radius: 9999px; font-size: 13px; font-weight: 700; }
    .btn-sync { background: #18181b; border: 1px solid #27272a; color: #a1a1aa; padding: 6px 14px; border-radius: 9999px; font-size: 13px; }
    main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; max-width: 680px; margin: 0 auto; width: 100%; }
    .avatar-box { width: 80px; height: 80px; border-radius: 16px; background: #18181b; border: 1px solid #27272a; display: flex; align-items: center; justify-content: center; margin-bottom: 28px; }
    .avatar-box svg { width: 38px; height: 38px; fill: #71717a; }
    .search-wrapper { width: 100%; margin-bottom: 24px; }
    .search-input { width: 100%; background: #121216; border: 1px solid #27272a; border-radius: 12px; padding: 14px 18px; color: #fafafa; font-size: 15px; outline: none; }
    .search-input:focus { border-color: #52525b; box-shadow: 0 0 0 2px rgba(82, 82, 91, 0.3); }
    .section-title { align-self: flex-start; font-size: 12px; color: #71717a; margin-bottom: 12px; text-transform: lowercase; }
    .bookmarks { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; width: 100%; }
    .bookmark-card { background: #141418; border: 1px solid #222227; border-radius: 14px; padding: 16px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; color: #a1a1aa; transition: background 0.15s, transform 0.1s; }
    .bookmark-card:hover { background: #1f1f24; color: #fff; transform: translateY(-2px); }
    .icon-circle { width: 36px; height: 36px; border-radius: 50%; background: #1d1d22; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
    .bookmark-name { font-size: 12px; }
    footer { display: flex; justify-content: space-between; padding: 16px 24px; font-size: 12px; color: #52525b; }
    footer a { color: #71717a; text-decoration: none; margin-left: 12px; }
    footer a:hover { color: #d4d4d8; }
    #viewport { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; border: none; background: #000; z-index: 100; }
  </style>
</head>
<body>
  <header>
    <span class="badge">lyraaaa /ᐠ - ˕ -マ</span>
    <button class="btn-sync" id="sync-status">connecting...</button>
  </header>

  <main>
    <div class="avatar-box">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
    </div>

    <form class="search-wrapper" id="search-form">
      <input type="text" id="search-bar" class="search-input" placeholder="1 update per year" autocomplete="off" />
    </form>

    <div class="section-title">bookmarks</div>
    <div class="bookmarks">
      <div class="bookmark-card" data-url="https://mangadex.org">
        <div class="icon-circle">m</div>
        <div class="bookmark-name">mangas</div>
      </div>
      <div class="bookmark-card" data-url="https://now.gg">
        <div class="icon-circle">🎮</div>
        <div class="bookmark-name">games</div>
      </div>
      <div class="bookmark-card" data-url="https://aniwatchtv.to">
        <div class="icon-circle">⛩</div>
        <div class="bookmark-name">anime</div>
      </div>
      <div class="bookmark-card" data-url="https://archiveofourown.org">
        <div class="icon-circle">a</div>
        <div class="bookmark-name">ao3</div>
      </div>
      <div class="bookmark-card" data-url="https://youtube.com">
        <div class="icon-circle">y</div>
        <div class="bookmark-name">youtube</div>
      </div>
    </div>
  </main>

  <footer>
    <div>~ client engine: scramjet / wisp</div>
    <div><a href="javascript:void(0)" onclick="location.reload()">reload</a></div>
  </footer>

  <iframe id="viewport"></iframe>

  <script src="${repoPrefix}baremux/index.js"></script>
  <script src="${repoPrefix}runtime/scramjet/scramjet.all.js"></script>
  <script>
    const searchForm = document.getElementById("search-form");
    const searchBar = document.getElementById("search-bar");
    const viewport = document.getElementById("viewport");
    const syncStatus = document.getElementById("sync-status");
    let isReady = false;

    window.__scramjet$config = {
      prefix: "${fullScramPrefix}",
      codec: {
        encode(str) {
          if (!str) return str;
          return encodeURIComponent(
            str.split('').map((c, i) => i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c).join('')
          );
        },
        decode(str) {
          if (!str) return str;
          const [input, ...search] = str.split('?');
          return decodeURIComponent(input)
            .split('').map((c, i) => i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c).join('') + 
            (search.length ? '?' + search.join('?') : '');
        }
      }
    };

    async function initClient() {
      try {
        if ("serviceWorker" in navigator) {
          await navigator.serviceWorker.register("${repoPrefix}sw.js", { scope: "${fullScramPrefix}" });
          await navigator.serviceWorker.ready;
        }

        if (window.BareMux) {
          const workerUrl = new URL("${repoPrefix}baremux/worker.js", window.location.href).toString();
          const connection = new BareMux.BareMuxConnection(workerUrl);
          const wispUrl = (location.protocol === "https:" ? "wss://" : "ws://") + "wisp.mercurywork.shop/";
          const epoxyUrl = new URL("${repoPrefix}epoxy/index.mjs", window.location.href).toString();

          await connection.setTransport(epoxyUrl, [{ wisp: wispUrl }]);
        }

        isReady = true;
        syncStatus.textContent = "cloud sync";
      } catch (err) {
        console.error("Init Error:", err);
        syncStatus.textContent = "ready";
        isReady = true;
      }
    }

    initClient();

    function launchUrl(rawUrl) {
      let target = rawUrl.trim();
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        if (target.includes(".") && !target.includes(" ")) {
          target = "https://" + target;
        } else {
          target = "https://www.google.com/search?q=" + encodeURIComponent(target);
        }
      }

      const encoded = window.__scramjet$config.codec.encode(target);
      viewport.src = "${fullScramPrefix}" + encoded;
      viewport.style.display = "block";
    }

    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (searchBar.value) launchUrl(searchBar.value);
    });

    document.querySelectorAll(".bookmark-card").forEach(card => {
      card.addEventListener("click", () => {
        launchUrl(card.getAttribute("data-url"));
      });
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(distDir, "app.html"), lyraAppHtml, "utf8");

  // 7. Subfolder wrapper template
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

  // 8. Generate 5,000 unique paths
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

  // 9. Root Directory Index
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
  console.log("Build complete.");
}

runBuild();
