import { Octokit } from 'octokit'
// will need later
import fs from 'fs'
import dotenv from 'dotenv'
import path from 'path'
import AdmZip from 'adm-zip'
dotenv.config({ path: path.resolve('.env'), quiet: true })
const token = process.env.token
const octokit = new Octokit({
  auth: token,
})
const artifacts = await octokit.request('GET /repos/{owner}/{repo}/actions/artifacts', {
  owner: 'riki-pedia',
  repo: 'ft-to-inv',
})
const data = artifacts.data
const ids = []
async function getMostRecentArtifact() {
  const logs = data.artifacts.filter(art => art.name === 'ft-to-inv-logs')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [k, v] of Object.entries(logs)) {
    ids.push(v.id)
  }
  ids.sort((a, b) => b - a)
  return ids[0]
}
const latest = await getMostRecentArtifact()
async function downloadArtifact() {
  octokit
    .request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip', {
      owner: 'riki-pedia',
      repo: 'ft-to-inv',
      artifact_id: await latest,
    })
    .then(response => {
      // download returns an arraybuffer
      const buffer = Buffer.from(response.data)
      fs.writeFileSync(path.resolve('./artifact/artifact.zip'), buffer)
      console.log('Downloaded artifact zip to artifact.zip')
    })
}
await downloadArtifact()
async function sleep(s) {
  return new Promise(resolve => setTimeout(resolve, s * 1000))
}
console.log('Waiting 5 seconds before extracting...')
await sleep(5)
console.log('Extracting artifact.zip to ./artifact...')
fs.mkdirSync('./artifact', { recursive: true })
const zip = new AdmZip(path.resolve('./artifact/artifact.zip'))
zip.extractAllTo('./artifact', true)
