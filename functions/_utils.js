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
    username: decoded.username
  }
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
