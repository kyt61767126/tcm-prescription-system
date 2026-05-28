import { authenticate, corsResponse, handleOptions } from '../_utils'

const getKV = (context) => context.env.TCM_KV || context.env.KV

export const onRequestOptions = () => {
  return handleOptions()
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
