import { Hono } from 'hono'

class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status }
}

const app = new Hono()
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ caught: 'onError', code: err.code }, err.status)
  return c.json({ caught: 'internal' }, 500)
})
app.use('/api/v1/*', async (c, next) => { c.set('rid', 'r1'); await next() })

const api = new Hono()
api.get('/users', async () => { throw new ApiError('UNAUTHORIZED', 401) })
app.route('/api/v1', api)

const res = await app.request('http://x/api/v1/users')
console.log('status:', res.status, 'body:', await res.text())
