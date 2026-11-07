// Build-time step: fetch the official Xray-core release binary and install it
// into ./bin so the runtime image ships the binary (no shell needed in the
// final container).
const https = require("https");
const fs = require("fs");
const path = require("path");

const FALLBACK_VERSION = "v26.10.31";

function getJson(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "node-setup" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          return resolve(getJson(res.headers.location, redirects + 1));
        }
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " for " + url));
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function download(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { "User-Agent": "node-setup" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
          res.resume();
          file.close();
          fs.unlinkSync(dest);
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error("HTTP " + res.statusCode + " for " + url));
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      })
      .on("error", (e) => {
        try { file.close(); fs.unlinkSync(dest); } catch (_) {}
        reject(e);
      });
  });
}

async function runSetup() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    console.log("setup: skip download on", process.platform, process.arch);
    return;
  }
  let version = FALLBACK_VERSION;
  try {
    const rel = await getJson("https://api.github.com/repos/XTLS/Xray-core/releases/latest");
    if (rel && rel.tag_name) version = rel.tag_name;
  } catch (e) {
    console.log("setup: latest-version lookup failed, falling back to", FALLBACK_VERSION, String(e));
  }

  const url = "https://github.com/XTLS/Xray-core/releases/download/" + version + "/Xray-linux-64.zip";
  const zipPath = path.join("/tmp", "xray-linux-64.zip");
  const binDir = path.join(__dirname, "bin");
  console.log("setup: downloading", url);
  await download(url, zipPath);

  const AdmZip = require("adm-zip");
  const zip = new AdmZip(zipPath);
  fs.mkdirSync(binDir, { recursive: true });
  const entry = zip.getEntries().find((e) => e.entryName === "xray");
  if (!entry) throw new Error("xray binary not found in release archive");
  fs.writeFileSync(path.join(binDir, "xray"), entry.getData());
  fs.chmodSync(path.join(binDir, "xray"), 0o755);
  try { fs.unlinkSync(zipPath); } catch (_) {}
  console.log("setup: xray", version, "installed to", path.join(binDir, "xray"));
}

if (require.main === module) {
  runSetup().catch((e) => {
    console.error("setup failed:", e);
    process.exit(1);
  });
}

module.exports = { runSetup };
