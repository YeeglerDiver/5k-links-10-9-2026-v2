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

function patchAbsolutePaths(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        patchAbsolutePaths(fullPath);
      }
    } else if (/\.(html|js|mjs|json|css)$/i.test(entry.name)) {
      let text = fs.readFileSync(fullPath, "utf8");
      
      // Prevent double prefixing if already patched
      const safePrefix = repoPrefix.replace(/\/$/, "");
      
      // Patch leading slash asset references
      text = text.replace(/(['"])\/(assets|baremux|scramjet|scram|storage|images|scripts)\//g, `$1${safePrefix}/$2/`);
      text = text.replace(/href=(['"])\/(?!\/)/g, `href=$1${safePrefix}/`);
      text = text.replace(/src=(['"])\/(?!\/)/g, `src=$1${safePrefix}/`);
      
      fs.writeFileSync(fullPath, text, "utf8");
    }
  }
}

async function runBuild() {
  console.log("Cloning gayq/lyra source package...");

  const extractDir = path.join(process.cwd(), "temp_extracted");
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  try {
    execSync(`git clone --depth 1 https://github.com/gayq/lyra.git "${extractDir}"`, {
      stdio: "inherit"
    });
  } catch (err) {
    console.error("Git clone failed:", err.message);
    process.exit(1);
  }

  // 1. Install and compile production bundle with explicit base path
  const pkgPath = path.join(extractDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    console.log(`Building project with base path: ${repoPrefix}`);
    try {
      execSync("npm install", { cwd: extractDir, stdio: "inherit" });
      
      // Run build passing base parameter for Vite/Astro/Webpack
      try {
        execSync(`npm run build -- --base=${repoPrefix}`, { cwd: extractDir, stdio: "inherit" });
      } catch (e) {
        console.log("npm run build with flags failed, attempting default build...");
        execSync("npm run build", { cwd: extractDir, stdio: "inherit" });
      }
    } catch (e) {
      console.warn("Compilation notice:", e.message);
    }
  }

  // 2. Identify the compiled production directory
  const candidateFolders = ["dist", "build", "out", "public", ""];
  let sourceRoot = null;

  for (const folder of candidateFolders) {
    const checkPath = path.join(extractDir, folder);
    if (fs.existsSync(checkPath) && fs.existsSync(path.join(checkPath, "index.html"))) {
      // Ensure we do not pick uncompiled source root if dist or build exists
      if (folder === "" && (fs.existsSync(path.join(extractDir, "dist")) || fs.existsSync(path.join(extractDir, "build")))) {
        continue;
      }
      sourceRoot = checkPath;
      break;
    }
  }

  if (!sourceRoot) {
    console.error("Fatal error: Could not find compiled output with index.html.");
    process.exit(1);
  }

  console.log(`Deploying production assets from: ${sourceRoot}`);
  fs.cpSync(sourceRoot, distDir, { recursive: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  // 3. Rename root index.html to app.html
  const origHtml = path.join(distDir, "index.html");
  const appShellHtml = path.join(distDir, "app.html");

  if (!fs.existsSync(origHtml)) {
    console.error("Fatal: dist/index.html not found.");
    process.exit(1);
  }
  fs.renameSync(origHtml, appShellHtml);

  // 4. Inject runtime shims for Bare-Mux and Wisp
  let appHtmlContent = fs.readFileSync(appShellHtml, "utf8");
  const runtimePatch = `
  <base href="${repoPrefix}">
  <script>
    (function() {
      const WISP_ENDPOINT = "wss://wisp.mercurywork.shop/";
      try {
        localStorage.setItem("wisp-server", WISP_ENDPOINT);
        localStorage.setItem("bare-server", WISP_ENDPOINT);
        localStorage.setItem("baremux-transport", "epoxy");
      } catch(e) {}
    })();
  </script>`;
  appHtmlContent = appHtmlContent.replace(/<head([^>]*)>/i, `<head$1>\n${runtimePatch}`);
  fs.writeFileSync(appShellHtml, appHtmlContent, "utf8");

  // 5. Sweep and fix absolute paths across all generated assets
  patchAbsolutePaths(distDir);

  // 6. Subfolder template
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

  // 7. Generate 5,000 unique paths
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

  // 8. Directory dashboard
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
