// loader.js
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export const plugins = [];
export const pluginMeta = [];
import {log} from './logs.js';

export async function loadPlugins() {
  const pluginsDir = path.resolve("./plugins");
  if (!fs.existsSync(pluginsDir)) {
    log('no plugins found', {err: 'info'})
    return
  };

  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith(".js"));

  for (const file of files) {
    const filePath = pathToFileURL(path.join(pluginsDir, file)).href;
    const plugin = await import(filePath);

    if (plugin.register) {
      const meta = plugin.register();
      pluginMeta.push(meta);
      console.log(`📦 Loaded plugin: ${meta.name} v${meta.version} by ${meta.author}`);
    }
    plugins.push(plugin);
  }
}

export async function runHook(hookName, context = {}) {
  for (const plugin of plugins) {
    if (typeof plugin[hookName] === "function") {
      await plugin[hookName](context);
    }
  }
}
await loadPlugins();
await runHook("beforeMain", { overrides: {} });