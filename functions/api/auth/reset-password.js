import { authenticate, corsResponse, handleOptions } from './_utils'

const getKV = (context) => context.env.TCM_KV || context.env.KV

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPut = async (context) => {
  const admin = await authenticate(context)
  
  if (!admin || admin.role !== 'admin') {
    return corsResponse({ error: '需要管理员权限' }, 403)
  }
  
  const { username, newPassword } = await context.request.json()
  
  if (!username || !newPassword) {
    return corsResponse({ error: '缺少必要参数' }, 400)
  }
  
  const KV = getKV(context)
  const userKey = `userinfo_${username}`
  const existingUser = await KV.get(userKey)
  
  if (!existingUser) {
    return corsResponse({ error: '用户不存在' }, 404)
  }
  
  const encoder = new TextEncoder()
  const salt = Array.from(crypto.getRandomValues(new Uint32Array(8)))
    .map(b => b.toString(16).padStart(8, '0')).join('')
  const data = encoder.encode(newPassword + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const passwordHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  
  const user = JSON.parse(existingUser)
  user.passwordHash = passwordHash
  user.passwordSalt = salt
  user.updatedAt = Date.now()
  
  await KV.put(userKey, JSON.stringify(user))
  
  return corsResponse({
    message: '密码重置成功',
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  })
}
