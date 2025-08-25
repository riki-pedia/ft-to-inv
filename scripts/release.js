// this is a script to automate my dual release hell
// not reusable without tinkering
import fs from "fs";
import { execSync } from "child_process";
import { Octokit } from "octokit";
import path from 'path'

function run(cmd) {
  console.log(`▶️ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

const releaseName = path.resolve('RELEASE.md');

const pkgPath = path.resolve("package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
let version = pkg.version;

const owner = "riki-pedia"; 
const repo = "ft-to-inv";   

// --- GitHub API ---
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("❌ Missing GITHUB_TOKEN env var");
  process.exit(1);
}
const octokit = new Octokit({ auth: token });

async function getLatestReleaseTag() {
  try {
    const { data } = await octokit.rest.repos.getLatestRelease({ owner, repo });
    return data.tag_name.replace(/^v/, ""); // e.g. "0.1.6"
  } catch (e) {
    if (e.status === 404) return null; // no releases yet
    throw e;
  }
}

async function bumpIfNeeded() {
  const latest = await getLatestReleaseTag();
  if (latest === version) {
    console.log(`⚠️ Version ${version} already released. Bumping patch...`);
    const [major, minor, patch] = version.split(".").map(Number);
    version = `${major}.${minor}.${patch + 1}`;
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    run(`git add package.json`);
    run(`git commit -m "chore: bump version to ${version}. ran by automation script"`);
  } else {
    console.log(`✅ package.json version ${version} is ahead of latest tag (${latest})`);
  }
}

async function main() {
  await bumpIfNeeded();
  // --- Step 1: publish to GitHub Packages ---
  const origName = pkg.name;
  pkg.name = "@riki-pedia/ft-to-inv";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  run("npm publish --registry https://npm.pkg.github.com");

  // --- Step 2: publish to npmjs.org ---
  pkg.name = "ft-to-inv";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  run("npm publish --registry https://registry.npmjs.org");

  // --- Step 3: git tag + push ---
  run(`git commit -a -m "chore: release v${version}. ran by automation script"`)
  run(`git tag v${version}`);
  run("git push --tags git@github.com:riki-pedia/ft-to-inv.git");
  // need this to push on master
  run(`git push git@github.com:riki-pedia/ft-to-inv.git`);

  // --- Step 4: GitHub release ---
  // note: files are read from the dir the command is run from, not where the script is
  run(`gh release create v${version} --title "Release v${version}" -F ${releaseName}`);

  console.log(`✅ Release v${version} created successfully!`);

  // restore original name
  pkg.name = origName;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
}

main().catch(err => {
  console.error("❌ Release failed:", err);
  process.exit(1);
});
