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

    const swPatch = `
      self.__scramjet$config = self.__scramjet$config || {
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

      const originalIDBOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = function(name, version) {
        const req = originalIDBOpen(name, version);
        req.addEventListener("upgradeneeded", (event) => {
          const db = event.target.result;
          const stores = ["config", "baremux", "sync", "settings", "__scramjet$config"];
          for (const s of stores) {
            if (!db.objectStoreNames.contains(s)) {
              db.createObjectStore(s, { keyPath: "name" });
            }
          }
        });
        return req;
      };
    `;

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
    <span class="badge">lyra
