import { authenticate, corsResponse, handleOptions } from '../_utils'

const PRESCRIPTION_KEY_PREFIX = 'prescription_'

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestGet = async (context) => {
  const user = await authenticate(context)
  
  if (!user) {
    return corsResponse({ error: '未授权' }, 401)
  }
  
  const { id } = context.params
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  const prescription = await context.env.KV.get(key)
  
  if (!prescription) {
    return corsResponse({ error: '处方不存在' }, 404)
  }
  
  return corsResponse({ prescription: JSON.parse(prescription) })
}

export const onRequestPut = async (context) => {
  const user = await authenticate(context)
  
  if (!user) {
    return corsResponse({ error: '未授权' }, 401)
  }
  
  const { id } = context.params
  const body = await context.request.json()
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  const existing = await context.env.KV.get(key)
  
  if (!existing) {
    return corsResponse({ error: '处方不存在' }, 404)
  }
  
  const updatedPrescription = {
    ...JSON.parse(existing),
    ...body,
    updatedAt: Date.now()
  }
  
  await context.env.KV.put(key, JSON.stringify(updatedPrescription))
  
  return corsResponse({
    message: '处方更新成功',
    prescription: updatedPrescription
  })
}

export const onRequestDelete = async (context) => {
  const user = await authenticate(context)
  
  if (!user) {
    return corsResponse({ error: '未授权' }, 401)
  }
  
  const { id } = context.params
  const key = `${PRESCRIPTION_KEY_PREFIX}${user.username}_${id}`
  const existing = await context.env.KV.get(key)
  
  if (!existing) {
    return corsResponse({ error: '处方不存在' }, 404)
  }
  
  await context.env.KV.delete(key)
  
  return corsResponse({ message: '处方删除成功' })
}
