import { hashPassword, authenticate, corsResponse, handleOptions, getUserKey } from '../_utils'

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
        createdAt: u.createdAt
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
  const userKey = getUserKey(username)
  const existingUser = await KV.get(userKey)
  
  if (existingUser) {
    return corsResponse({ error: '用户名已存在' }, 409)
  }
  
  const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password)
  
  const user = {
    _id: Date.now().toString(),
    username,
    passwordHash,
    passwordSalt,
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

export const onRequestPut = async (context) => {
  const admin = await authenticate(context)
  
  if (!admin || admin.role !== 'admin') {
    return corsResponse({ error: '需要管理员权限' }, 403)
  }
  
  const { username } = context.params
  const { name, role, password } = await context.request.json()
  
  const KV = getKV(context)
  const userKey = getUserKey(username)
  const existingUser = await KV.get(userKey)
  
  if (!existingUser) {
    return corsResponse({ error: '用户不存在' }, 404)
  }
  
  const user = JSON.parse(existingUser)
  
  if (name !== undefined) user.name = name
  if (role !== undefined) user.role = role === 'admin' ? 'admin' : 'user'
  
  if (password) {
    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password)
    user.passwordHash = passwordHash
    user.passwordSalt = passwordSalt
  }
  
  user.updatedAt = Date.now()
  
  await KV.put(userKey, JSON.stringify(user))
  
  return corsResponse({
    message: '用户信息更新成功',
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  })
}

export const onRequestDelete = async (context) => {
  const admin = await authenticate(context)
  
  if (!admin || admin.role !== 'admin') {
    return corsResponse({ error: '需要管理员权限' }, 403)
  }
  
  const { username } = context.params
  
  if (username === admin.username) {
    return corsResponse({ error: '不能删除自己的账号' }, 400)
  }
  
  const KV = getKV(context)
  const userKey = getUserKey(username)
  const existingUser = await KV.get(userKey)
  
  if (!existingUser) {
    return corsResponse({ error: '用户不存在' }, 404)
  }
  
  await KV.delete(userKey)
  
  const prescriptions = await KV.list({ prefix: `prescription_${username}_` })
  for (const key of prescriptions.keys) {
    await KV.delete(key.name)
  }
  
  return corsResponse({ message: '用户删除成功' })
}
