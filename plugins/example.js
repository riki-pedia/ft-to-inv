// example plugin for the ft-to-inv tool
/* 
   here's some expected usage:
    register a plugin with a name, description, and version
    you can add other metadata, but it won't be used
    for example:
    {
      name: "example-plugin",
      description: "An example plugin",
      version: "1.0.0",
      author: "Your Name",
      hooks: ["beforeMain", "beforeSync", "afterSync"]
    }
      the full list of hooks is:
      beforeMain,
      duringMain,
      afterMain,
      beforeSync,
      duringSync,
      afterSync,

    duringMain triggers in the middle of bootstrap.
    duringSync triggers right after diffs are calculated.

    please add your plugin name to any console output, see below
    if you need more data i'd be happy to help, just open an issue on the repo
    https://github.com/riki-pedia/ft-to-inv/issues
*/
// ==== please import from @riki-pedia/ft-to-inv/src/[module].js ====
//                 or just rikipedia on npmjs, @riki-pedia on github pkgs
// this isn't in the package yet, which is why we import directly
import { log } from '../src/logs.js'
export function register() {
  return {
    name: "example-plugin",
    version: "1.0.0",
    description: "Example plugin for ft-to-inv",
    // prefer either github or npmJS name 
    author: "riki-pedia",
    hooks: ["beforeMain", "beforeSync", "afterSync", "duringSync", 'afterMain'] // optional, for clarity
  };
}

export async function beforeMain({ overrides }) {
  console.log("🔧 [example-plugin] beforeMain called", overrides);
  log('test', {err: 'info'})
}
export async function duringMain({ overrides }) {
  // ==== THIS RUNS BEFORE SOME VARIABLES ARE SET. USE CAUTION WITH THIS HOOK ====
  console.log("🔧 [example-plugin] duringMain called", overrides);
}
export async function afterMain({ overrides, config }) {
  // runs after all the vars are set but before sync() is called
  console.log("🔧 [example-plugin] afterMain called", overrides);
}
export async function beforeSync({ config, data }) {
  console.log("🔧 [example-plugin] beforeSync called");
  // config is an object containing the resolved config for ft-to-inv
  // data is an object containing the sync/export data
}
export async function duringSync({ data }) {
  console.log("🔧 [example-plugin] duringSync called", { data });
}
export async function afterSync({ data }) {
  // the sync process is full of early exits, i would reccomend using duringSync instead
  // gets called at the very end if there are no early exits
  console.log("✅ [example-plugin] afterSync finished");
}
export async function onError({ error }) {
  // triggers on any fatal error, ignores warnings
  console.error("❌ [example-plugin] Error occurred:", error);
}