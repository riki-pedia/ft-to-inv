import https from 'https'

const args = process.argv.slice(2)
// test parser
const token = args[0] || process.env.INVIDIOUS_TOKEN

async function testPlaylistApi(playlist) {
  const req = https.request('https://[placeholder]/api/v1/auth/playlists', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'ft-to-inv-bot/1.0 (+https://ft-to-inv-bot.riki-pedia.org/)',
      Accept: 'application/json',
      Cookie: `SID=${token}`,
    },
  })
  req.write(JSON.stringify(playlist))
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
  const id = JSON.parse(response.body).playlistId ?? 'unknown'
  console.log('Created playlist with ID:', id)
  console.log('adding videos...')
  for (const videoId of playlist.videos) {
    const addVideoReq = https.request(`https://[placeholder]/api/v1/auth/playlists/${id}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ft-to-inv-bot/1.0 (+https://ft-to-inv-bot.riki-pedia.org/)',
        Accept: 'application/json',
        Cookie: `SID=${token}`,
      },
    })
    addVideoReq.write(JSON.stringify({ videoId }))
    const addVideoResponse = await new Promise((resolve, reject) => {
      addVideoReq.on('response', res => {
        let data = ''
        res.on('data', chunk => {
          data += chunk
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: data })
        })
      })
      addVideoReq.on('error', err => {
        reject(err)
      })
      addVideoReq.end()
    })
    console.log(`Added video ${videoId}:`, addVideoResponse)
  }
}
testPlaylistApi({
  title: 'Test Playlist',
  description: 'A simple test playlist',
  privacy: 'private',
  videos: ['QZfH7cFp3Ys', 'dQw4w9WgXcQ'],
})
