import { authenticate, corsResponse, handleOptions } from '../../_utils'

const getKV = (context) => context.env.TCM_KV || context.env.KV

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestGet = async (context) => {
  const user = await authenticate(context)
  
  if (!user || user.role !== 'admin') {
    return corsResponse({ error: '需要管理员权限' }, 403)
  }
  
  const KV = getKV(context)
  const list = await KV.list({ prefix: 'userinfo_' })
  const users = []
  
  for (const key of list.keys) {
    const userData = await KV.get(key.name)
    if (userData) {
      const u = JSON.parse(userData)
      users.push({
        _id: u._id,
        username: u.username,
        name: u.name,
        role: u.role || 'user',
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      })
    }
  }
  
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  
  return corsResponse({ users })
}

export const onRequestPost = async (context) => {
  const admin = await authenticate(context)
  
  if (!admin || admin.role !== 'admin') {
    return corsResponse({ error: '需要管理员权限' }, 403)
  }
  
  const { username, password, name, role = 'user' } = await context.request.json()
  
  if (!username || !password || !name) {
    return corsResponse({ error: '缺少必要参数' }, 400)
  }
  
  const KV = getKV(context)
  const userKey = `userinfo_${username}`
  const existingUser = await KV.get(userKey)
  
  if (existingUser) {
    return corsResponse({ error: '用户名已存在' }, 409)
  }
  
  const encoder = new TextEncoder()
  const salt = Array.from(crypto.getRandomValues(new Uint32Array(8)))
    .map(b => b.toString(16).padStart(8, '0')).join('')
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const passwordHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  
  const user = {
    _id: Date.now().toString(),
    username,
    passwordHash,
    passwordSalt: salt,
    name,
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: Date.now()
  }
  
  await KV.put(userKey, JSON.stringify(user))
  
  return corsResponse({
    message: '用户创建成功',
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  }, 201)
}
