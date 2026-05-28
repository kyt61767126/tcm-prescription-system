export default {
  async onRequest({ request, env }) {
    const pass = request.headers.get("x-sync-password");
    const user = request.headers.get("x-username");

    if (pass !== env.SYNC_PASSWORD || !user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const key = "prescriptions_" + user;

    if (request.method === "GET") {
      const data = await env.TCM_KV.get(key);
      return new Response(data || "[]", {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method === "POST") {
      const body = await request.text();
      await env.TCM_KV.put(key, body);
      return new Response("ok");
    }

    return new Response("error", { status: 400 });
  }
};