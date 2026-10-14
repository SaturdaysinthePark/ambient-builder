// Stands in for whisper.cpp's whisper-server in tests: accepts audio, returns canned lines.
import { createServer } from 'node:http'

const lines = [
  'So what if the app just tells you which subscriptions you forgot about?',
  'Yeah, and it should show the monthly total right at the top.',
  'We could color the ones you have not opened in a month.',
]
let i = 0
const port = Number(process.env.FAKE_WHISPER_PORT || 8179)
createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/inference')) {
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ text: lines[i++ % lines.length] }))
    })
    return
  }
  res.end('fake whisper')
}).listen(port, '127.0.0.1', () => console.log(`fake whisper on ${port}`))
