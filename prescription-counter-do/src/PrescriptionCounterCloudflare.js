export class PrescriptionCounterCloudflare {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const now = new Date();
    const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, "");
    const key = `seq:${yymmdd}`;

    let seq = await this.state.storage.get(key) || 0;
    seq += 1;
    await this.state.storage.put(key, seq);

    const prescriptionNo = yymmdd + seq.toString().padStart(2, "0");

    return new Response(JSON.stringify({ prescriptionNo }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}
