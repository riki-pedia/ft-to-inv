// loader.js
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getGlobalVars } from './args.js'
import { log } from './logs.js'
import { sanitizePath } from './sanitize.js'
export const plugins = []
export const pluginMeta = []

export async function loadPlugins() {
  // moving this log to export.js
  const pluginsDir = path.resolve('./plugins')
  if (!fs.existsSync(pluginsDir)) {
    const conf = getGlobalVars()
    if (!conf.silent) log(' ℹ️ No plugins found', { level: 'info' })
    return
  }
  const dirs = fs
    .readdirSync(pluginsDir)
    .filter(f => fs.statSync(sanitizePath(path.join(pluginsDir, f))).isDirectory())
  if (dirs.length >= 2) {
    log(`⚠️ You probably shouldn't have multiple plugins running`, { level: 'warning' })
  }
  for (const dir of dirs) {
    const manifestPath = path.join(pluginsDir, dir, `${dir}.json`)
    // this is stupidly recursive but it works and it supports .js, .mjs, and .cjs extensions without needing to specify which one in the manifest, which is nice for plugin developers.
    const scriptPath = fs.existsSync(path.join(pluginsDir, dir, `${dir}.mjs`)) // try module first since the tool is ESM and .js extensions that are ESM can cause warnings in node
      ? path.join(pluginsDir, dir, `${dir}.mjs`)
      : fs.existsSync(path.join(pluginsDir, dir, `${dir}.cjs`)) // next try commonjs for "legacy" plugins
        ? path.join(pluginsDir, dir, `${dir}.cjs`)
        : path.join(pluginsDir, dir, `${dir}.js`) // fallback to .js for "backwards" compatibility, even though .js can be either ESM or CJS which can cause issues, but we'll let the user deal with that since it's their own plugin and they can just rename the extension if it causes problems

    if (!fs.existsSync(manifestPath) || !fs.existsSync(scriptPath)) {
      log(`⚠️ Skipping ${dir}: missing manifest or script`, { level: 'warning' })
      continue
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    const filePath = pathToFileURL(scriptPath).href
    // this is a bit risky considering import runs any top-level code, but its the only way to dynamically load either esm or cjs without forcing ridiculous requirements on plugin devs like exporting classes or functions instead of just their hooks/register. the manifest is validated but it's STUPIDLY simple for a bad actor to make a "legit" manifest that passes validation but then have malicious code in the script (especially since all the gaurds protecting the user are in the github repo). only install plugins from trusted sources (like the built-in marketplace) or read the code yourself before installing if it's from a third party.
    const plugin = await import(filePath)

    if (plugin.register) {
      const meta = plugin.register()
      // ✅ Validate metadata matches manifest
      if (
        meta.name !== manifest.name ||
        meta.version !== manifest.version ||
        (manifest.author && meta.author !== manifest.author)
      ) {
        throw new Error(
          `[ft-to-inv] ❌ Plugin ${dir} metadata mismatch. Manifest: ${manifest.name}@${manifest.version}, Register: ${meta.name}@${meta.version}`
        )
      }
      pluginMeta.push(meta)
      plugins.push(plugin)

      const gv = getGlobalVars()
      if (!gv.quiet && !gv.silent) {
        log(`📦 Loaded plugin: ${meta.name} v${meta.version} by ${meta.author || 'Unknown'}`, {
          level: 'info',
        })
      }
    } else {
      throw new Error(`[ft-to-inv] ❌ ${dir} does not export register()`)
    }
  }
}

export async function runHook(hookName, context = {}) {
  for (const plugin of plugins) {
    if (typeof plugin[hookName] === 'function') {
      await plugin[hookName](context)
    }
  }
}
