import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'
import { basicAuth } from 'hono/basic-auth'

const app = new Hono()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))

const PRESCRIPTION_KEY_PREFIX = 'prescription_'

// 简单的 JWT 实现
const createToken = (payload, jwtSecret) => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerEncoded = btoa(JSON.stringify(header))
  const payloadEncoded = btoa(JSON.stringify(payload))
  const signature = btoa(`${headerEncoded}.${payloadEncoded}.${jwtSecret}`)
  return `${headerEncoded}.${payloadEncoded}.${signature}`
}

const verifyToken = (token, jwtSecret) => {
  try {
    const [headerEncoded, payloadEncoded, signature] = token.split('.')
    const expectedSignature = btoa(`${headerEncoded}.${payloadEncoded}.${jwtSecret}`)
    if (signature !== expectedSignature) {
      return null
    }
    return JSON.parse(atob(payloadEncoded))
  } catch {
    return null
  }
}

// 认证中间件
const authenticate = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: '未授权' }, 401)
  }
  
  const token = authHeader.split(' ')[1]
  const jwtSecret = c.env.JWT_SECRET || 'test-secret-key-for-development'
  const decoded = verifyToken(token, jwtSecret)
  
  if (!decoded) {
    return c.json({ error: '无效的token' }, 401)
  }
  
  c.set('user', {
    _id: decoded.userId,
    username: decoded.username
  })
  
  await next()
}

// 初始化管理员账户
app.post('/api/auth/init-admin', async (c) => {
  const { username, password, name } = await c.req.json()
  
  const userKey = `user_${username}`
  const existingUser = await c.env.KV.get(userKey)
  
  if (existingUser) {
    return c.json({ message: '管理员已存在', user: JSON.parse(existingUser) })
  }
  
  const user = {
    _id: Date.now().toString(),
    username,
    password,
    name,
    role: 'admin',
    createdAt: Date.now()
  }
  
  await c.env.KV.put(userKey, JSON.stringify(user))
  
  return c.json({ message: '管理员账户初始化成功', user })
})

// 登录
app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json()
  
  const userKey = `user_${username}`
  const userData = await c.env.KV.get(userKey)
  
  if (!userData) {
    return c.json({ error: '用户不存在' }, 401)
  }
  
  const user = JSON.parse(userData)
  
  if (user.password !== password) {
    return c.json({ error: '密码错误' }, 401)
  }
  
  const tokenPayload = {
    userId: user._id,
    username: user.username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  }
  
  const jwtSecret = c.env.JWT_SECRET || 'test-secret-key-for-development'
  const token = createToken(tokenPayload, jwtSecret)
  
  return c.json({
    token,
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  })
})

// 获取处方列表
app.get('/api/prescriptions', authenticate, async (c) => {
  const username = c.get('user').username
  const prefix = `${PRESCRIPTION_KEY_PREFIX}${username}_`
  
  const list = await c.env.KV.list({ prefix })
  const prescriptions = []
  
  for (const key of list.keys) {
    const prescription = await c.env.KV.get(key.name)
    if (prescription) {
      prescriptions.push(JSON.parse(prescription))
    }
  }
  
  prescriptions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  
  return c.json({ prescriptions })
})

// 创建处方
app.post('/api/prescriptions', authenticate, async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  
  const id = Date.now().toString()
  const prescription = {
    _id: id,
    ...body,
    userId: user._id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  await c.env.KV.put(key, JSON.stringify(prescription))
  
  return c.json({
    message: '处方保存成功',
    prescription
  }, 201)
})

// 获取单个处方
app.get('/api/prescriptions/:id', authenticate, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  const prescription = await c.env.KV.get(key)
  
  if (!prescription) {
    return c.json({ error: '处方不存在' }, 404)
  }
  
  return c.json({ prescription: JSON.parse(prescription) })
})

// 更新处方
app.put('/api/prescriptions/:id', authenticate, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const body = await c.req.json()
  
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  const existing = await c.env.KV.get(key)
  
  if (!existing) {
    return c.json({ error: '处方不存在' }, 404)
  }
  
  const updatedPrescription = {
    ...JSON.parse(existing),
    ...body,
    updatedAt: Date.now()
  }
  
  await c.env.KV.put(key, JSON.stringify(updatedPrescription))
  
  return c.json({
    message: '处方更新成功',
    prescription: updatedPrescription
  })
})

// 删除处方
app.delete('/api/prescriptions/:id', authenticate, async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  const existing = await c.env.KV.get(key)
  
  if (!existing) {
    return c.json({ error: '处方不存在' }, 404)
  }
  
  await c.env.KV.delete(key)
  
  return c.json({ message: '处方删除成功' })
})

// 健康检查
app.get('/api/health', (c) => {
  return c.json({ 
    status: 'ok', 
    message: '服务器运行正常', 
    version: 'Cloudflare Workers KV版',
    timestamp: Date.now()
  })
})

export default app
