// Independent-profile preload: only the selected subscription HTTPS origin.
// Logs contain denial kind/time only, never a URL, credential or request body.
'use strict'
const fs = require('node:fs'), net = require('node:net'), dns = require('node:dns')
let origins
try { origins = JSON.parse(process.env.ULTRA_ACCEPTANCE_ALLOWED_ORIGINS ?? 'null') } catch {}
if (!Array.isArray(origins) || origins.length !== 1 || origins[0] !== 'https://opencode.ai') throw Object.assign(new Error('Explicit OCG origin is required'), { code: 'OCG_GUARD_CONFIGURATION' })
const logfile = process.env.ULTRA_ACCEPTANCE_NETWORK_LOG
function deny(kind) {
  if (logfile) fs.appendFileSync(logfile, JSON.stringify({ kind, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
  throw Object.assign(new Error('Independent OCG acceptance refused a network route'), { code: 'OCG_NETWORK_DENIED' })
}
const fetch = globalThis.fetch
globalThis.fetch = function (input, ...rest) {
  let url; try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url) } catch { return deny('fetch-url') }
  if (url.origin !== 'https://opencode.ai' || url.username || url.password) return deny('fetch-origin')
  return fetch.call(this, input, ...rest)
}
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = first && typeof first === 'object' ? first : typeof first === 'number' || typeof first === 'string' && /^\d+$/u.test(first) ? { port: first, host: typeof args[1] === 'string' ? args[1] : undefined } : {}
  const host = options.hostname ?? options.host
  if (host !== 'opencode.ai' || Number(options.port) !== 443 || options.path) return deny('socket')
  return connect.apply(this, args)
}
const lookup = dns.lookup
dns.lookup = function (hostname, ...rest) { if (hostname !== 'opencode.ai') return deny('dns'); return lookup.call(this, hostname, ...rest) }
const promiseLookup = dns.promises.lookup
dns.promises.lookup = function (hostname, ...rest) { if (hostname !== 'opencode.ai') return deny('dns-promises'); return promiseLookup.call(this, hostname, ...rest) }
