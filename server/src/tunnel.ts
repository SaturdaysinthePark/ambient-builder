import { spawn } from 'node:child_process'

/**
 * Free Cloudflare quick tunnel: gives a public https://*.trycloudflare.com URL for this laptop.
 * Phones need HTTPS for microphone access. No Cloudflare account required.
 */
export function startTunnel(port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`])
    let done = false
    const finish = (url?: string) => {
      if (!done) {
        done = true
        resolve(url)
      }
    }
    child.on('error', () => {
      console.log('  cloudflared not found. Install it (macOS: brew install cloudflared), then run `npm run tunnel` again.\n')
      finish()
    })
    const scan = (d: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(d.toString())
      if (m) finish(m[0])
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    setTimeout(() => {
      if (!done) console.log('  Tunnel is taking a while; still trying…')
    }, 20_000)
    process.on('exit', () => child.kill())
  })
}
