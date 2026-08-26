import { app } from '../app.js'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function testBaseUrl(): URL | undefined {
  const value = process.env.API_TEST_BASE_URL
  if (!value) return undefined

  const base = new URL(value)
  if (!LOCAL_HOSTS.has(base.hostname) && process.env.API_TEST_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing contract test request to non-local API_TEST_BASE_URL host: ${base.hostname}`,
    )
  }

  return base
}

export function request(path: string, init?: RequestInit): Promise<Response>
export function request(raw: Request): Promise<Response>
export function request(input: string | Request, init?: RequestInit): Promise<Response> {
  const base = testBaseUrl()
  if (!base) {
    return Promise.resolve(input instanceof Request ? app.request(input) : app.request(input, init))
  }

  if (input instanceof Request) {
    const url = new URL(input.url)
    url.protocol = base.protocol
    url.host = base.host
    return fetch(new Request(url, input))
  }

  return fetch(new URL(input, base), init)
}
