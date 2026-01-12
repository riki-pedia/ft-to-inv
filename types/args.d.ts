export interface ArgTable {
  token: string | null
  instance: string | null
  insecure: boolean
  cron: string | null
  marketplace: string | null
  silent: boolean
  veryVerbose: boolean
  verbose: boolean
  freetube_dir: string | null
  export_dir: string | null
  quiet: boolean
  no_sync: boolean
  subs: boolean
  history: boolean
  playlists: boolean
  dry_run: boolean
  dont_shorten_paths: boolean
  logs: boolean
}
// this function is for the core cli only, plugins should use the getGlobalVars to get the user config (its also passed into hooks for convenience)
// unless your plugin adds an arg or something you shouldnt ever need this
export function resolveConfig(
  key: string,
  options?: {
    cliNames?: string[]
    envNames?: string[]
    config?: Record<string, object>
    args?: string[]
    // eslint hates me using any for a type
    fallback?: null | string
    isFlag?: boolean
    positionalArgs?: string[]
  }
): Promise<string | boolean>

export function setGlobalVars(config: Partial<ArgTable>): Promise<void>
export function getGlobalVars(): ArgTable

export const argTable: ArgTable

declare const _default: {
  argTable: ArgTable
  resolveConfig: typeof resolveConfig
  setGlobalVars: typeof setGlobalVars
  getGlobalVars: typeof getGlobalVars
}

export default _default
