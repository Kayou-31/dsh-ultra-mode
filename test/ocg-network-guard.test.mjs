import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const guard = fileURLToPath(new URL('../scripts/host-acceptance/ocg-network-guard.cjs', import.meta.url))
function run(code, origins = '["https://opencode.ai"]') {
  return spawnSync(process.execPath, ['-e', `globalThis.fetch=async()=>({ok:true});require(${JSON.stringify(guard)});${code}`], { env: { ...process.env, ULTRA_ACCEPTANCE_ALLOWED_ORIGINS: origins, ULTRA_ACCEPTANCE_NETWORK_LOG: '' }, encoding: 'utf8', timeout: 5000, windowsHide: true })
}
test('OCG network guard permits selected HTTPS fetch and blocks every other origin before dispatch', () => {
  assert.equal(run("fetch('https://opencode.ai/inference/go/v1').then(r=>console.log(r.ok))").stdout.trim(), 'true')
  for (const url of ['https://example.com', 'http://opencode.ai', 'https://opencode.ai:8443', 'https://opencode.ai.attacker.example', 'https://user:secret@opencode.ai']) {
    const response = run(`try{fetch(${JSON.stringify(url)});console.log('UNSAFE')}catch(e){console.log(e.code)}`)
    assert.equal(response.stdout.trim(), 'OCG_NETWORK_DENIED', url)
  }
})
test('OCG network guard rejects socket, DNS and startup-origin bypasses without actual networking', () => {
  for (const code of ["require('node:net').connect({host:'127.0.0.1',port:443})", "require('node:net').connect({host:'opencode.ai',port:80})", "require('node:dns').lookup('example.com',()=>{})"]) {
    const response = run(`try{${code};console.log('UNSAFE')}catch(e){console.log(e.code)}`)
    assert.equal(response.stdout.trim(), 'OCG_NETWORK_DENIED')
  }
  const response = run("console.log('UNSAFE')", '["https://example.com"]')
  assert.notEqual(response.status, 0)
  assert.ok(!response.stdout.includes('UNSAFE'))
})
