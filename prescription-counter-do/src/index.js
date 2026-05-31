export { PrescriptionCounterCloudflare } from './PrescriptionCounterCloudflare';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/next-prescription-no") {
      return new Response("Not Found", { status: 404 });
    }

    const now = new Date();
    const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, "");
    const id = env.PRESCRIPTION_SEQ.idFromName(yymmdd);
    const stub = env.PRESCRIPTION_SEQ.get(id);

    return stub.fetch(request);
  }
};
