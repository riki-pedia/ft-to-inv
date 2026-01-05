// this is a script to automate my dual release hell
// not reusable without tinkering
import fs from 'fs'
import { execSync } from 'child_process'
import { Octokit } from 'octokit'
import path from 'path'

function run(cmd) {
  console.log(`▶️ ${cmd}`)
  execSync(cmd, { stdio: 'inherit' })
}

const releaseName = path.resolve('RELEASE.md')

const pkgPath = path.resolve('package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
let version = pkg.version

const owner = 'riki-pedia'
const repo = 'ft-to-inv'

// --- GitHub API ---
const token = process.env.GITHUB_TOKEN || process.env.TOKEN
if (!token) {
  console.error('❌ Missing GITHUB_TOKEN env var')
  process.exit(1)
}
const octokit = new Octokit({ auth: token })

async function getLatestReleaseTag() {
  try {
    const { data } = await octokit.rest.repos.getLatestRelease({ owner, repo })
    return data.tag_name.replace(/^v/, '') // e.g. "0.1.6"
  } catch (e) {
    if (e.status === 404) return null // no releases yet
    throw e
  }
}

async function bumpIfNeeded() {
  const latest = await getLatestReleaseTag()
  if (latest === version) {
    console.log(`⚠️ Version ${version} already released. Bumping patch...`)
    const [major, minor, patch] = version.split('.').map(Number)
    version = `${major}.${minor}.${patch + 1}`
    pkg.version = version
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
    // give time for write
    setTimeout(() => {
      run(`git add package.json`)
      run(`git commit -m "chore: bump version to ${version}. ran by automation script"`)
    }, 100)
  } else {
    console.log(`✅ package.json version ${version} is ahead of latest tag (${latest})`)
  }
}

async function main() {
  await bumpIfNeeded()
  // --- Step 1: publish to GitHub Packages ---
  const origName = pkg.name
  pkg.name = '@riki-pedia/ft-to-inv'
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  run('npm publish --registry https://npm.pkg.github.com')

  // --- Step 2: publish to npmjs.org ---
  try {
    pkg.name = 'ft-to-inv'
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
    run('npm publish --registry https://registry.npmjs.org')
  } catch (e) {
    // npm has a BIG thing about security, it makes me login once a day
    console.warn('npm publish failed, trying npm login first. the error was:', e)
    run('npm login')
    pkg.name = 'ft-to-inv'
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
    run('npm publish --registry https://registry.npmjs.org')
  }
  // --- Step 3: git tag + push ---
  run(`git tag v${version}`)
  try {
    run(`git commit -a -m "chore: release v${version}. ran by automation script"`)
  } catch (e) {
    console.warn(
      ' doesnt look like theres anything to commit, or maybe lefthook blocked it. Continuing anyway. The error was:',
      e
    )
  }
  // ssh here because github desktop uses https and fails
  run('git push --tags git@github.com:riki-pedia/ft-to-inv.git')
  // need this to push on master
  try {
    run(`git push git@github.com:riki-pedia/ft-to-inv.git`)
  } catch (e) {
    console.warn('⚠️ Failed to push to GitHub. Continuing anyway. The error was:', e)
  }
  // --- Step 4: GitHub release ---
  // note: files are read from the dir the command is run from, not where the script is
  await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: `v${version}`,
    name: `v${version}`,
    body: fs.readFileSync(releaseName, 'utf8'),
    draft: false,
    prerelease: false,
  })

  console.log(`✅ Release v${version} created successfully!`)

  // restore original name
  pkg.name = origName
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
}

main().catch(err => {
  console.error('❌ Release failed:', err)
  process.exit(1)
})
