import { authenticate, corsResponse, handleOptions } from '../../_utils'

const PRESCRIPTION_KEY_PREFIX = 'prescription_'

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestGet = async (context) => {
  const user = await authenticate(context)
  
  if (!user) {
    return corsResponse({ error: '未授权' }, 401)
  }
  
  const username = user.username
  const prefix = `${PRESCRIPTION_KEY_PREFIX}${username}_`
  
  const list = await context.env.KV.list({ prefix })
  const prescriptions = []
  
  for (const key of list.keys) {
    const prescription = await context.env.KV.get(key.name)
    if (prescription) {
      prescriptions.push(JSON.parse(prescription))
    }
  }
  
  prescriptions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  
  return corsResponse({ prescriptions })
}

export const onRequestPost = async (context) => {
  const user = await authenticate(context)
  
  if (!user) {
    return corsResponse({ error: '未授权' }, 401)
  }
  
  const body = await context.request.json()
  
  const id = Date.now().toString()
  const prescription = {
    _id: id,
    ...body,
    userId: user._id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  await context.env.KV.put(key, JSON.stringify(prescription))
  
  return corsResponse({
    message: '处方保存成功',
    prescription
  }, 201)
}
