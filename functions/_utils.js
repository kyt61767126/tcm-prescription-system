// SHA256 密码哈希函数
export const sha256 = async (password) => {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// 生成随机盐
export const generateSalt = () => {
  const array = new Uint32Array(8)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b.toString(16).padStart(8, '0')).join('')
}

// 带盐的密码哈希
export const hashPassword = async (password, salt = null) => {
  const passwordSalt = salt || generateSalt()
  const hash = await sha256(password + passwordSalt)
  return { hash, salt: passwordSalt }
}

// 验证密码
export const verifyPassword = async (inputPassword, storedHash, salt) => {
  const { hash } = await hashPassword(inputPassword, salt)
  return hash === storedHash
}

// 简单的 JWT 实现
export const createToken = (payload, jwtSecret) => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerEncoded = btoa(JSON.stringify(header))
  const payloadEncoded = btoa(JSON.stringify(payload))
  const signature = btoa(`${headerEncoded}.${payloadEncoded}.${jwtSecret}`)
  return `${headerEncoded}.${payloadEncoded}.${signature}`
}

export const verifyToken = (token, jwtSecret) => {
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
export const authenticate = async (context) => {
  const authHeader = context.request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  
  const token = authHeader.split(' ')[1]
  const jwtSecret = context.env.JWT_SECRET || 'test-secret-key-for-development'
  const decoded = verifyToken(token, jwtSecret)
  
  if (!decoded) {
    return null
  }
  
  return {
    _id: decoded.userId,
    username: decoded.username,
    role: decoded.role || 'user'
  }
}

// 管理员权限检查
export const requireAdmin = async (context, next) => {
  const user = await authenticate(context)
  if (!user || user.role !== 'admin') {
    return corsResponse({ error: '需要管理员权限' }, 403)
  }
  context.user = user
  await next()
}

// CORS 响应
export const corsResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}

export const handleOptions = () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  })
}

// 生成用户数据键前缀
export const getUserKeyPrefix = (username) => {
  return `user_${username}_`
}

// 生成处方键
export const getPrescriptionKey = (username, prescriptionId) => {
  return `prescription_${username}_${prescriptionId}`
}

// 生成用户信息键
export const getUserKey = (username) => {
  return `userinfo_${username}`
}
