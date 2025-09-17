import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import https from "https";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HEADERS = {
  "User-Agent": "ft-to-inv-bot/1.0 (+https://dev.riki-pedia.org/projects/ft-to-inv.html)",
  "Accept": "application/json",
};

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function fetchText(url) {
  const options = new URL(url);
  options.headers = DEFAULT_HEADERS;
  return new Promise((resolve, reject) => {
    https.get(options, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}, HTTP ${res.statusCode}`));
      }
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}
const registryUrl = "https://ft-to-inv-pkg.riki-pedia.org/marketplace.json";
let regis;
try {
  const registryData = await fetchText(registryUrl);
  regis = JSON.parse(registryData);
} catch (err) {
  console.error(`Failed to load or parse registry from ${registryUrl}:`, err);
  throw err;
}
// this doesnt look like its used, but im too lazy to check rn
async function downloadFile(url, dest, expectedSha) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actualSha = sha256(buf);
  if (expectedSha && actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error(
      `❌ SHA mismatch for ${url}. Expected ${expectedSha}, got ${actualSha}`
    );
  }
  fs.writeFileSync(dest, buf);
  return actualSha;
}
let hasNoErrors = true;
async function verifyPlugin(url, sha) {
  const res = await fetchText(url);
  const actualSha = sha256(res);
  if (actualSha.toLowerCase() !== sha.toLowerCase()) {
    throw new Error(
      `❌ SHA mismatch for ${url}. Expected ${sha}, got ${actualSha}`
    );
  }
  console.log(`✅ Verified ${url} (${actualSha})`);
}

export async function installPlugin(name, registry = regis) {
  const plugin = registry[name];
  if (!plugin) throw new Error(`Plugin '${name}' not found in registry`);

  const pluginsDir = path.resolve("./plugins");
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);

  const pluginDir = path.join(pluginsDir, name);
  if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir);

  console.log(`📦 Installing ${plugin.name} v${plugin.version}...`);

  if (plugin.json && plugin.script) {
    // new format
    try {
      const jsonDest = path.join(pluginDir, `${name}.json`);
      const scriptDest = path.join(pluginDir, `${name}.js`);
      const json = await fetchText(plugin.json);
      await verifyPlugin(plugin.json, plugin.jsonSha).catch(err => {
        console.error(`Failed to verify ${plugin.json}:`, err);
        hasNoErrors = false;
      });
      const js = await fetchText(plugin.script);
      await verifyPlugin(plugin.script, plugin.scriptSha).catch(err => {
        console.error(`Failed to verify ${plugin.script}:`, err);
        hasNoErrors = false;
      });
      if (hasNoErrors === true) {
        fs.writeFileSync(jsonDest, json);
        fs.writeFileSync(scriptDest, js);
      }
    } catch (error) {
      console.error(`Failed to install ${plugin.name}:`, error);
  }
} else if (plugin.url && plugin.sha256) {
    // legacy format
    const scriptDest = path.join(pluginDir, `${name}.js`);
    const js = await fetchText(plugin.url);
   await verifyPlugin(plugin.url, plugin.sha256 + 1).catch(err => {
     console.error(`Failed to verify ${plugin.url}:`, err);
     hasNoErrors = false;
   });
   if (hasNoErrors === true) {
     fs.writeFileSync(scriptDest, js);
   }
  } else {
    throw new Error(`Registry entry for '${name}' is invalid`);
  }
  if (hasNoErrors === true) {
    console.log(`🎉 Installed '${plugin.name}' successfully!`);
  }
  else {
    throw new Error(`Errors occured while installing ${name}`)
  }
}

export async function listStore(registry = regis) {
  console.log("🛒 Available plugins:");
  for (const [key, info] of Object.entries(registry)) {
    console.log(`- ${info.name} (${info.version}): ${info.desc}\n To install, run: \`ft-to-inv add ${key}\``);
  }
  console.log("More plugins coming soon!");
}

export async function listInstalled() {
  const pluginsDir = path.resolve("./plugins");
  if (!fs.existsSync(pluginsDir)) {
    console.log("⚠️ No plugins installed");
    return;
  }
  const dirs = fs.readdirSync(pluginsDir);
  console.log("🔌 Installed plugins:");
  for (const dir of dirs) {
    const manifestPath = path.join(pluginsDir, dir, `${dir}.json`);
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      console.log(`- ${manifest.name} v${manifest.version}`);
    } else {
      console.log(`- ${dir} (legacy or missing manifest)`);
    }
  }
}
export async function removePlugin(plugin) {
    const pluginsDir = path.resolve("./plugins");
    const pluginDir = path.join(pluginsDir, plugin);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      console.log(`🗑️ Removed plugin '${plugin}'`);
    } else {
      throw new Error(`⚠️ Plugin '${plugin}' not found`);
    }
}