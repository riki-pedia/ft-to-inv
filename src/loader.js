// loader.js
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export const plugins = [];
export const pluginMeta = [];

export async function loadPlugins() {
  console.log("🔌 Loading plugins...");
  const pluginsDir = path.resolve("./plugins");
  if (!fs.existsSync(pluginsDir)) {
    console.log("ℹ️ No plugins found");
    return;
  }
  const dirs = fs.readdirSync(pluginsDir).filter(f =>
    fs.statSync(path.join(pluginsDir, f)).isDirectory()
  );
  if (dirs.length >= 2) {
    console.warn("⚠️ You probably shouldn't have multiple plugins running");
  }
  for (const dir of dirs) {
    const manifestPath = path.join(pluginsDir, dir, `${dir}.json`);
    const scriptPath = path.join(pluginsDir, dir, `${dir}.js`);

    if (!fs.existsSync(manifestPath) || !fs.existsSync(scriptPath)) {
      console.warn(`⚠️ Skipping ${dir}: missing .json or .js`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    const filePath = pathToFileURL(scriptPath).href;
    const plugin = await import(filePath);

    if (plugin.register) {
      const meta = plugin.register();
      // ✅ Validate metadata matches manifest
      if (
        meta.name !== manifest.name ||
        meta.version !== manifest.version ||
        (manifest.author && meta.author !== manifest.author)
      ) {
        throw new Error(
          `❌ Plugin ${dir} metadata mismatch. Manifest: ${manifest.name}@${manifest.version}, Register: ${meta.name}@${meta.version}`
        );
      }
      pluginMeta.push(meta);
      plugins.push(plugin);

      console.log(
        `📦 Loaded plugin: ${meta.name} v${meta.version} by ${meta.author || "Unknown"}`
      );
    } else {
      throw new Error(`❌ ${dir} does not export register()`);
    }
  }
}

export async function runHook(hookName, context = {}) {
  for (const plugin of plugins) {
    if (typeof plugin[hookName] === "function") {
      await plugin[hookName](context);
    }
  }
}