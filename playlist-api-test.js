import https from 'https'

const args = process.argv.slice(2)
// test parser
const token = args[0] || process.env.INVIDIOUS_TOKEN

async function testPlaylistApi() {
  const req = https.request('https://invidiou.s/api/v1/auth/playlists', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'ft-to-inv-bot/1.0 (+https://ft-to-inv-bot.riki-pedia.org/)',
      Accept: 'application/json',
      Cookie: `SID=${token}`,
    },
  })
  const response = await new Promise((resolve, reject) => {
    req.on('response', res => {
      let data = ''
      res.on('data', chunk => {
        data += chunk
      })
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data })
      })
    })
    req.on('error', err => {
      reject(err)
    })
    req.end()
  })

  console.log('Response:', response)
}
testPlaylistApi()
