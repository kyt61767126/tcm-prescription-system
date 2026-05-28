export default {
  async onRequest() {
    return new Response(JSON.stringify({ message: "Hello from Functions!" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};