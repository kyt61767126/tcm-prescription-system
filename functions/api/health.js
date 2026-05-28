import { corsResponse, handleOptions } from '../_utils'

export const onRequestOptions = () => {
  return handleOptions()
}

export const onRequestGet = async (context) => {
  return corsResponse({
    status: 'ok',
    message: '服务器运行正常',
    version: 'Cloudflare Pages Functions KV版',
    timestamp: Date.now()
  })
}
