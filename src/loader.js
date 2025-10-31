// loader.js
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getGlobalVars } from './args.js'
export const plugins = []
export const pluginMeta = []

export async function loadPlugins() {
  // moving this log to export.js
  const pluginsDir = path.resolve('./plugins')
  if (!fs.existsSync(pluginsDir)) {
    console.log('[ft-to-inv] ℹ️ No plugins found')
    return
  }
  const dirs = fs
    .readdirSync(pluginsDir)
    .filter(f => fs.statSync(path.join(pluginsDir, f)).isDirectory())
  if (dirs.length >= 2) {
    console.warn(`[ft-to-inv] ⚠️ You probably shouldn't have multiple plugins running`)
  }
  for (const dir of dirs) {
    const manifestPath = path.join(pluginsDir, dir, `${dir}.json`)
    const scriptPath = path.join(pluginsDir, dir, `${dir}.js`)

    if (!fs.existsSync(manifestPath) || !fs.existsSync(scriptPath)) {
      console.warn(`[ft-to-inv] ⚠️ Skipping ${dir}: missing .json or .js`)
      continue
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    const filePath = pathToFileURL(scriptPath).href
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

      const gv = await getGlobalVars()
      if (!gv.quiet && !gv.silent) {
        console.log(
          `[ft-to-inv] 📦 Loaded plugin: ${meta.name} v${meta.version} by ${meta.author || 'Unknown'}`
        )
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
