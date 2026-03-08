import https from 'https'

async function testPlaylistApi() {
  const req = https.request('https://invidiou.s', {})
  req.end()
}
testPlaylistApi()
