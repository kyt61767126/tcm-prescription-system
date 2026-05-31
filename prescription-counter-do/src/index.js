export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 路由到对应的 Durable Object
    const now = new Date();
    const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, "");

    // 使用日期作为 DO 实例名，确保每天一个独立的计数器
    const id = env.PRESCRIPTION_COUNTER.idFromName(yymmdd);
    const stub = env.PRESCRIPTION_COUNTER.get(id);

    return stub.fetch(request);
  },
};
