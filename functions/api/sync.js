import { authenticate, corsResponse, handleOptions } from '../_utils'

const PRESCRIPTION_KEY_PREFIX = 'prescription_'

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestPost = async (context) => {
  const user = await authenticate(context)
  
  if (!user) {
    return corsResponse({ error: '未授权' }, 401)
  }
  
  try {
    const { action, data } = await context.request.json()
    
    switch (action) {
      case 'upload':
        return await uploadPrescriptions(context, user, data)
      case 'download':
        return await downloadPrescriptions(context, user)
      case 'sync':
        return await syncPrescriptions(context, user, data)
      default:
        return corsResponse({ error: '未知操作' }, 400)
    }
  } catch (error) {
    console.error('Sync error:', error)
    return corsResponse({ error: '同步失败: ' + error.message }, 500)
  }
}

async function uploadPrescriptions(context, user, prescriptions) {
  const username = user.username
  let count = 0
  
  for (const prescription of prescriptions) {
    const id = prescription.id || prescription._id || Date.now().toString()
    const key = `${PRESCRIPTION_KEY_PREFIX}${username}_${id}`
    
    const existing = await context.env.KV.get(key)
    if (!existing) {
      const fullPrescription = {
        _id: id,
        ...prescription,
        userId: user._id,
        createdAt: prescription.createdAt || Date.now(),
        updatedAt: Date.now()
      }
      await context.env.KV.put(key, JSON.stringify(fullPrescription))
      count++
    }
  }
  
  return corsResponse({ 
    message: `成功上传 ${count} 条处方`,
    uploaded: count 
  })
}

async function downloadPrescriptions(context, user) {
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
  
  return corsResponse({
    message: `成功下载 ${prescriptions.length} 条处方`,
    prescriptions,
    count: prescriptions.length
  })
}

async function syncPrescriptions(context, user, localData) {
  const username = user.username
  const prefix = `${PRESCRIPTION_KEY_PREFIX}${username}_`
  
  const list = await context.env.KV.list({ prefix })
  const cloudPrescriptions = []
  
  for (const key of list.keys) {
    const prescription = await context.env.KV.get(key.name)
    if (prescription) {
      cloudPrescriptions.push(JSON.parse(prescription))
    }
  }
  
  const cloudMap = new Map()
  cloudPrescriptions.forEach(p => cloudMap.set(p._id || p.id, p))
  
  const localMap = new Map()
  localData.forEach(p => localMap.set(p._id || p.id, p))
  
  const toUpload = []
  const toDownload = []
  
  localMap.forEach((local, id) => {
    const cloud = cloudMap.get(id)
    if (!cloud) {
      toUpload.push(local)
    } else if (local.updatedAt && cloud.updatedAt && local.updatedAt > cloud.updatedAt) {
      toUpload.push(local)
    }
  })
  
  cloudMap.forEach((cloud, id) => {
    const local = localMap.get(id)
    if (!local) {
      toDownload.push(cloud)
    } else if (cloud.updatedAt && local.updatedAt && cloud.updatedAt > local.updatedAt) {
      toDownload.push(cloud)
    }
  })
  
  for (const prescription of toUpload) {
    const id = prescription.id || prescription._id || Date.now().toString()
    const key = `${PRESCRIPTION_KEY_PREFIX}${username}_${id}`
    const fullPrescription = {
      _id: id,
      ...prescription,
      userId: user._id,
      createdAt: prescription.createdAt || Date.now(),
      updatedAt: Date.now()
    }
    await context.env.KV.put(key, JSON.stringify(fullPrescription))
  }
  
  return corsResponse({
    message: '同步完成',
    uploaded: toUpload.length,
    downloaded: toDownload.length,
    prescriptions: [...toDownload, ...toUpload]
  })
}
