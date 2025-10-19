// types/plugin.d.ts

/** Metadata every plugin must provide via `register()` */
export interface PluginMeta {
  name: string // short id, e.g. "example-plugin"
  version: string // semver
  description?: string // optional description
  author: string // required author
  hooks?: string[] // optional: which hooks are implemented
}

/** Context object passed into hooks */
export interface HookContext {
  config?: object // resolved config for ft-to-inv
  overrides?: Record<string, object> // runtime overrides from main()
  data?: Record<string, object> // sync/export data
  // eslint really hates this but its the only way to allow extensions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any // allow extension
}

/** Every plugin must export at least this */
export interface PluginModule {
  register: () => PluginMeta
  beforeMain?: (context: HookContext) => Promise<void> | void
  beforeSync?: (context: HookContext) => Promise<void> | void
  afterSync?: (context: HookContext) => Promise<void> | void
  afterMain?: (context: HookContext) => Promise<void> | void
}
