import { createToken, verifyToken, verifyPassword, corsResponse, handleOptions, getUserKey } from '../../_utils'

const getKV = (context) => context.env.TCM_KV || context.env.KV

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPost = async (context) => {
  const { username, password } = await context.request.json()
  
  const KV = getKV(context)
  const userKey = getUserKey(username)
  const userData = await KV.get(userKey)
  
  if (!userData) {
    return corsResponse({ error: '用户不存在' }, 401)
  }
  
  const user = JSON.parse(userData)
  
  if (!user.passwordHash || !user.passwordSalt) {
    return corsResponse({ error: '用户数据格式错误' }, 500)
  }
  
  const isPasswordValid = await verifyPassword(password, user.passwordHash, user.passwordSalt)
  
  if (!isPasswordValid) {
    return corsResponse({ error: '密码错误' }, 401)
  }
  
  const jwtSecret = context.env.JWT_SECRET || 'test-secret-key-for-development'
  
  const tokenPayload = {
    userId: user._id,
    username: user.username,
    role: user.role || 'user',
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  }
  
  const token = createToken(tokenPayload, jwtSecret)
  
  return corsResponse({
    token,
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role || 'user'
    }
  })
}
