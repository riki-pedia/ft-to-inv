export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  hooks: string[]
}

export interface hookContext {
  data: {
    added: {
      history: string[]
      subs: string[]
      playlists: string[]
    }
    removed: {
      history: string[]
      subs: string[]
      playlists: string[]
    }
    // for legacy plugins:
    history: string[]
    subs: string[]
    playlists: string[]
  }
  conf: {
    token: string
    instance: string
    export_dir: string
    freetube_dir: string
    verbose: boolean
    dry_run: boolean
    dont_shorten_paths: boolean
    no_sync: boolean
    quiet: boolean
    silent: boolean
    cron_schedule: string
    insecure: boolean
    history: boolean
    subs: boolean
    playlists: boolean
    veryVerbose: boolean
  }
  success?: boolean
}

export type HookName =
  | 'beforeMain'
  | 'duringMain'
  | 'afterMain'
  | 'beforeSync'
  | 'duringSync'
  | 'afterSync'
  | 'onError'

export type HookFunction = (context: hookContext) => Promise<void> | void

export interface registerPlugin {
  (manifest: PluginManifest): void
}

export interface Plugin {
  register: registerPlugin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [hookName: string]: HookFunction | any
}
