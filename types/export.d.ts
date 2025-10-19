// types/export.d.ts
export interface SyncOptions {
  token: string
  instance: string
  exportDir?: string
  freetubeDir?: string
  cron?: string
  help?: boolean
  verbose?: boolean
  dryRun?: boolean
  quiet?: boolean
  insecure?: boolean
  noSync?: boolean
  playlists?: boolean
  subscriptions?: boolean
  history?: boolean
  helpcmd?: string
}
export function main(overrides?: Partial<SyncOptions>): Promise<void>
export function sync(opts: SyncOptions): Promise<void>
