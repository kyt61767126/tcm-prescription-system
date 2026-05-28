import { createToken, verifyToken, corsResponse, handleOptions } from '../../_utils'

const PRESCRIPTION_KEY_PREFIX = 'prescription_'
const getKV = (context) => context.env.TCM_KV || context.env.KV

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPost = async (context) => {
  const { username, password, name } = await context.request.json()
  
  const KV = getKV(context)
  const userKey = `user_${username}`
  const existingUser = await KV.get(userKey)
  
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
  
  await KV.put(userKey, JSON.stringify(user))
  
  return corsResponse({ 
    message: '管理员账户初始化成功', 
    user 
  })
}
