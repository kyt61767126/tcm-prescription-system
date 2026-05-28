import { hashPassword, corsResponse, handleOptions, getUserKey } from './_utils'

const getKV = (context) => context.env.TCM_KV || context.env.KV

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPost = async (context) => {
  const { username, password, name } = await context.request.json()
  
  const KV = getKV(context)
  const userKey = getUserKey(username)
  const existingUser = await KV.get(userKey)
  
  if (existingUser) {
    const user = JSON.parse(existingUser)
    return corsResponse({ 
      message: '管理员已存在', 
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    })
  }
  
  const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password)
  
  const user = {
    _id: Date.now().toString(),
    username,
    passwordHash,
    passwordSalt,
    name,
    role: 'admin',
    createdAt: Date.now()
  }
  
  await KV.put(userKey, JSON.stringify(user))
  
  return corsResponse({ 
    message: '管理员账户初始化成功', 
    user: {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }
  })
}
