// this fetches code scanning alerts from a repo, and uses an LLM to triage them\
// outputs results to triage-results.json
// you need ollama installed and a github token with repo access set in GITHUB_TOKEN env var
// ollama: https://ollama.com/
// you do need to get an ollama acc and login, but the gpt-oss model is free to use
// its really heavy, which is why i got the cloud model instead
// its a smarter model, so it should be more accurate
// you know its heavy when i cant run it on my rx 6600
// i do have the github repo and user hardcoded for now, since its just for my own use
// if you REALLY want to use this, change the owner and repo variables in main()
// pass in a token with repo access to read code scanning alerts
// you can get a token here:
// https://github.com/settings/tokens
// half of these comments are for me in a month when i forget how this works
// you need a code scanning workflow set up in the repo too
// theres one in here (./.github/workflows/ci.yml) that tests the main tool, then runs scanning with ESLint, Semgrep, and CodeQL
// theres probably more but i dont remember them all
// i probably wont maintain this because its just for my own use, but if you want to improve it, go ahead
// you can open a PR/issue and ill take a look if i have time
// this tool's logs are VERY spammy, but it exports a nice json file at the end
// with all the results, so you can parse that however you want
// you can also modify the prompt in analyzeWithLLM() to change how the LLM analyzes things
// just make sure it responds with valid JSON in the expected format
// if it cant parse the response, it marks it as "unknown" classification with 0 confidence
// look at the console logs to see the raw LLM response
// the likely reason it cant parse is because the model went off the rails and responded with something that isnt JSON
// example:
/* 
```
JSON:
{ "classification": "true_positive", "confidence": 95, "explanation": "The alert indicates a potential security vulnerability in the code, which is a valid concern.", "suggested_fix": "Review the affected code and implement necessary security measures to mitigate the vulnerability." }
```
*/
// this is a tricky problem, because LLMs are not perfect, and security is a hard problem
// please be careful when using this, and always double-check the results
// if you can think of a better way to do this (maybe some prompt engineering trick or a better model) please let me know immidiately

import ollama from 'ollama'
import { Octokit } from 'octokit'
import notifier from 'node-notifier'
import fs from 'fs'
import path from 'path'
// not used yet, but might be useful later
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const args = process.argv.slice(2)

async function getSnippetForAlert(octokit, owner, repo, alert) {
  try {
    const loc = alert.most_recent_instance?.location
    if (!loc?.path) return null

    const file = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: loc.path,
      ref: alert.most_recent_instance.ref || 'main',
    })

    const content = Buffer.from(file.data.content, 'base64').toString('utf8')
    const { start_line, end_line } = loc
    return content
      .split('\n')
      .slice(start_line - 1, end_line)
      .join('\n')
  } catch (e) {
    console.warn(`⚠️ Could not fetch snippet for ${alert.rule.id}: ${e.message}`)
    return null
  }
}

async function analyzeWithLLM(alert) {
  const prompt = `
You are an AI security triage assistant.

Alert:
- Title: ${alert.rule?.id || 'N/A'}
- Number: ${alert.number || 'N/A'}
- Tool: ${alert.tool?.name || 'Unknown'}
- Description: ${alert.rule?.description || 'N/A'}
- Affected file(s) snippet: ${alert.snippet || 'N/A'}
(Note: The snippet provided may be incomplete. Use your best judgment based on the available information. If it's not enough to make a decision, indicate that in your explanation or suggest human review.)

Classify:
1. classification = true_positive | false_positive | linter_error | human_review_needed
2. confidence = number 0-100
3. explanation = text
4. Suggested fix (if true_positive)

Respond STRICTLY to this JSON schema:
{ "classification": "true_positive | false_positive | linter_error | human_review_needed", "confidence": 0-100, "explanation": " a breif explanation on the previous reasoning", "suggested_fix": "what to do in order to fix the issue. please watch quotes in this section. if you don't have a fix, you can just leave this blank." }
`

  const res = await ollama.chat({
    model: 'gpt-oss:20b-cloud',
    messages: [{ role: 'user', content: prompt }],
  })
  try {
    //                                                 newline for readability
    console.log('LLM response:', res.message.content, '\n\n')
    return JSON.parse(res.message.content)
  } catch {
    return {
      classification: 'unknown',
      confidence: 0,
      explanation: 'Could not parse model output',
    }
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.TOKEN
  if (!token) throw new Error('Missing GITHUB_TOKEN env var')

  const octokit = new Octokit({ auth: token })
  const owner = 'riki-pedia'
  const repo = 'ft-to-inv'

  // fetch alerts
  // temporary
  const prRef = 'refs/pull/31/head'
  const advs = await octokit.rest.codeScanning.listAlertsForRepo({
    owner,
    repo,
    ref: prRef,
  })

  const results = []
  for (const alert of advs.data) {
    console.log(`Analyzing alert ${alert.rule?.id || 'N/A'}...`)

    // fetch snippet for this alert
    const snippet = await getSnippetForAlert(octokit, owner, repo, alert)
    alert.snippet = snippet // attach snippet to the alert object

    const analysis = await analyzeWithLLM(alert)
    results.push({
      id: alert.rule?.id || 'N/A',
      number: alert.number || 'N/A',
      file: alert.most_recent_instance?.location?.path || 'N/A',
      snippet: snippet || 'N/A',
      analysis,
    })
  }

  console.log('Analysis complete.')
  notifier.notify({
    title: 'Triage Complete',
    message: 'Security alert triage is complete.',
    action: 'cool idc',
  })

  try {
    fs.writeFileSync(
      path.resolve('triage-results.json'),
      // maybe parse instead of stringify?
      JSON.stringify(results, null, 2)
    )
    console.log('Results saved to triage-results.json')
  } catch (e) {
    console.error('Failed to save results:', e)
    console.log('dumping results to console instead:')
    console.log(JSON.stringify(results, null, 2))
    process.exit(1)
  }
}

main()
