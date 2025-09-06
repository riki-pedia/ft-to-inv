// types/index.d.ts
export interface SyncOptions {
  token: string;
  instance: string;
  exportDir?: string;
  freetubeDir?: string;
  cron?: string;
  help?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  insecure?: boolean;
  noSync?: boolean;
  playlists?: boolean;
  subscriptions?: boolean;
  history?: boolean;
  helpcmd?: string;
}
// the few exports in @riki-pedia/ft-to-inv/src/export.js
// tools like my helpers are gonna be fun to make
// not
export function main(overrides?: Partial<SyncOptions>): Promise<void>;
export function sync(opts: SyncOptions): Promise<void>;
