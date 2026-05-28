import { createToken, verifyToken, corsResponse, handleOptions } from '../../_utils'

const PRESCRIPTION_KEY_PREFIX = 'prescription_'

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPost = async (context) => {
  const { username, password, name } = await context.request.json()
  
  const userKey = `user_${username}`
  const existingUser = await context.env.KV.get(userKey)
  
  if (existingUser) {
    return corsResponse({ 
      message: '管理员已存在', 
      user: JSON.parse(existingUser) 
    })
  }
  
  const user = {
    _id: Date.now().toString(),
    username,
    password,
    name,
    role: 'admin',
    createdAt: Date.now()
  }
  
  await context.env.KV.put(userKey, JSON.stringify(user))
  
  return corsResponse({ 
    message: '管理员账户初始化成功', 
    user 
  })
}
