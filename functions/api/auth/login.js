import { createToken, verifyToken, corsResponse, handleOptions } from '../../_utils'

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPost = async (context) => {
  const { username, password } = await context.request.json()
  
  const userKey = `user_${username}`
  const userData = await context.env.KV.get(userKey)
  
  if (!userData) {
    return corsResponse({ error: '用户不存在' }, 401)
  }
  
  const user = JSON.parse(userData)
  
  if (user.password !== password) {
    return corsResponse({ error: '密码错误' }, 401)
  }
  
  const jwtSecret = context.env.JWT_SECRET || 'test-secret-key-for-development'
  
  const tokenPayload = {
    userId: user._id,
    username: user.username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  }
  
  const token = createToken(tokenPayload, jwtSecret)
  
  return corsResponse({
    token,
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  })
}
