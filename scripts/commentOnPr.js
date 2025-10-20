// post-triage-comment-octokit5.js
// Uses octokit (v5-style) - set GITHUB_TOKEN, OWNER, REPO, PR_NUMBER.
// Optional: TRIAGE_JSON_PATH (defaults to triage-results.json)

import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import { Octokit } from 'octokit'

const MARKER = '<!-- ft-to-inv-triage-bot -->'
const MAX_COMMENT_LENGTH = 60000
const MAX_INDIVIDUAL_DETAILS = 200

function safeCodeFence(snippet, lang = '') {
  return '```' + lang + '\n' + snippet.replace(/```/g, '`\u200b``') + '\n```'
}

function buildDetailsBlock(result, index) {
  const id = result.id || `alert-${index + 1}`
  const file = result.file || result.path || (result.analysis && result.analysis.path) || 'unknown'
  const snippet = result.snippet || ''
  const analysis = result.analysis || {}
  const classification = analysis.classification || 'unknown'
  const confidence = analysis.confidence !== undefined ? `${analysis.confidence}%` : 'n/a'
  const explanation = analysis.explanation || ''
  const suggested = analysis.suggested_fix || ''
  const number = result.number || 'N/A'

  return [
    `<details>`,
    `<summary><strong>${id}</strong> — <em>${file}</em> — ${classification} (${confidence})</summary>`,
    '',
    `**Finding number**: ${number}`,
    '',
    `**Snippet**`,
    '',
    safeCodeFence(snippet, extname(file).slice(1) || ''),
    '',
    `**Explanation**`,
    '',
    explanation || '_none provided_',
    '',
    `**Suggested fix**`,
    '',
    suggested || '_none provided_',
    '',
    `</details>`,
    '',
  ].join('\n')
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  if (!token) return console.error('Missing GITHUB_TOKEN env var')

  const owner = process.env.OWNER
  const repo = process.env.REPO
  const prNumber = parseInt(process.env.PR_NUMBER, 10)
  if (!owner || !repo || !prNumber) return console.error('Set OWNER, REPO, PR_NUMBER env vars')

  const octokit = new Octokit({ auth: token })

  const jsonPath = process.env.TRIAGE_JSON_PATH || 'triage-results.json'
  if (!existsSync(jsonPath)) return console.error(`Triage JSON not found at ${jsonPath}`)

  let raw
  try {
    raw = readFileSync(jsonPath, 'utf8')
  } catch (e) {
    return console.error('Failed to read triage JSON:', e)
  }

  let results
  try {
    results = JSON.parse(raw)
  } catch (e) {
    console.error('Invalid JSON in', jsonPath, ':', e)
    return
  }

  const counts = results.reduce((acc, r) => {
    const cls = r.analysis && r.analysis.classification ? r.analysis.classification : 'unknown'
    acc[cls] = (acc[cls] || 0) + 1
    return acc
  }, {})

  const header = [
    MARKER,
    `## ft-to-inv security triage — automated summary`,
    '',
    `**Total findings:** ${results.length}`,
    '',
    `**Breakdown:**`,
    ...Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`),
    '',
    `> This comment is auto-generated. If you'd like inline PR review comments or check-run annotations, let the bot know (open an issue).`,
    '',
  ].join('\n')

  const detailsBlocks = []
  for (let i = 0; i < Math.min(results.length, MAX_INDIVIDUAL_DETAILS); i++) {
    detailsBlocks.push(buildDetailsBlock(results[i], i))
  }

  let body = [header, ...detailsBlocks].join('\n')
  if (results.length > MAX_INDIVIDUAL_DETAILS) {
    body += `\n\n_...and ${results.length - MAX_INDIVIDUAL_DETAILS} more findings. Full results attached below or available via gist._\n`
  }

  // If body too long => gist fallback
  if (body.length > MAX_COMMENT_LENGTH) {
    console.warn('Comment body too large; attempting gist fallback (token needs gist scope).')
    try {
      const gistResp = await octokit.request('POST /gists', {
        files: { 'triage-results.json': { content: raw } },
        public: false,
        description: `ft-to-inv triage for PR #${prNumber} (${owner}/${repo})`,
      })
      const gistUrl = gistResp.data.html_url
      const trimmedBody = [
        header,
        `**Full results**: too large to include here. View the full JSON gist: ${gistUrl}`,
        '',
        `**Top ${Math.min(10, results.length)} findings (inline)**`,
        '',
        ...results.slice(0, Math.min(10, results.length)).map((r, i) => {
          const file = r.file || r.path || 'unknown'
          const cls =
            r.analysis && r.analysis.classification ? r.analysis.classification : 'unknown'
          const conf =
            r.analysis && r.analysis.confidence !== undefined ? `${r.analysis.confidence}%` : 'n/a'
          return `- **${r.id || `alert-${i + 1}`}** — ${file} — ${cls} (${conf})`
        }),
        '',
        `_Gist created by ft-to-inv triage bot._`,
      ].join('\n')

      body = trimmedBody
    } catch (e) {
      console.error('Failed to create gist fallback:', e.message || e)
      body = [header, ...detailsBlocks.slice(0, 10)].join('\n')
      body += `\n\n_Comment truncated: full triage JSON could not be uploaded._`
    }
  }

  // Find existing bot comment
  try {
    const listResp = await octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
      {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 200,
      }
    )
    const existing = listResp.data.find(c => c.body && c.body.includes(MARKER))

    if (existing) {
      await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        owner,
        repo,
        comment_id: existing.id,
        body,
      })
      console.log('Updated existing triage comment (id:', existing.id, ')')
    } else {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: prNumber,
        body,
      })
      console.log('Posted new triage comment')
    }
  } catch (e) {
    console.error('Failed to post or update comment:', e)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
