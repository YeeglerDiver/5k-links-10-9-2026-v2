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
      const safePrefix = repoPrefix.replace(/\/$/, "");

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
  } catch
