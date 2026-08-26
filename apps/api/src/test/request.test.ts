import { afterEach, expect, test, vi } from 'vitest'
import { request } from './request.js'

const originalBaseUrl = process.env.API_TEST_BASE_URL
const originalAllowRemote = process.env.API_TEST_ALLOW_REMOTE

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.API_TEST_BASE_URL
  else process.env.API_TEST_BASE_URL = originalBaseUrl
  if (originalAllowRemote === undefined) delete process.env.API_TEST_ALLOW_REMOTE
  else process.env.API_TEST_ALLOW_REMOTE = originalAllowRemote
  vi.unstubAllGlobals()
})

test('rejects a remote API_TEST_BASE_URL unless explicitly allowed', async () => {
  process.env.API_TEST_BASE_URL = 'https://contract.example.test'
  delete process.env.API_TEST_ALLOW_REMOTE

  expect(() => request('/api/health')).toThrow('contract.example.test')
})

test('allows a remote API_TEST_BASE_URL only with API_TEST_ALLOW_REMOTE=1', async () => {
  process.env.API_TEST_BASE_URL = 'https://contract.example.test'
  process.env.API_TEST_ALLOW_REMOTE = '1'
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(request('/api/health')).resolves.toMatchObject({ status: 204 })
  expect(fetchMock).toHaveBeenCalledWith(new URL('https://contract.example.test/api/health'), undefined)
})

test('allows a localhost API_TEST_BASE_URL without an override', async () => {
  process.env.API_TEST_BASE_URL = 'http://127.0.0.1:3020'
  delete process.env.API_TEST_ALLOW_REMOTE
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(request('/api/health')).resolves.toMatchObject({ status: 200 })
  expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:3020/api/health'), undefined)
})
