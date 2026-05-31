import { DurableObject } from "cloudflare:workers";

export class PrescriptionCounterCloudflare {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
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

    const url = new URL(request.url);

    // GET /next-prescription-no - 获取下一个处方号
    if (url.pathname === "/next-prescription-no") {
      return this.getNextPrescriptionNo();
    }

    // GET /current-prescription-no - 获取当前处方号（不递增）
    if (url.pathname === "/current-prescription-no") {
      return this.getCurrentPrescriptionNo();
    }

    // GET /reset - 重置计数器（仅用于测试）
    if (url.pathname === "/reset") {
      return this.resetCounter();
    }

    return new Response("Not Found", { status: 404 });
  }

  async getNextPrescriptionNo() {
    try {
      const now = new Date();
      const yymmdd = this.getYYMMDD(now);

      // 获取今天的序号
      let seq = await this.getSequence(yymmdd);
      seq += 1;

      // 保存序号
      await this.state.storage.put(`seq:${yymmdd}`, seq);
      await this.state.storage.put(`last_date`, yymmdd);

      // 生成处方号（格式：YYMMDDNN，序号从01开始）
      const prescriptionNo = yymmdd + seq.toString().padStart(2, "0");

      const response = {
        success: true,
        prescriptionNo: prescriptionNo,
        timestamp: now.toISOString(),
        date: yymmdd,
        sequence: seq
      };

      return new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }
  }

  async getCurrentPrescriptionNo() {
    try {
      const now = new Date();
      const yymmdd = this.getYYMMDD(now);
      const seq = await this.getSequence(yymmdd);
      // 生成处方号（格式：YYMMDDNN）
      const prescriptionNo = yymmdd + seq.toString().padStart(2, "0");

      return new Response(JSON.stringify({
        success: true,
        prescriptionNo: prescriptionNo,
        sequence: seq,
        date: yymmdd,
        nextSequence: seq + 1
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }
  }

  async resetCounter() {
    try {
      const now = new Date();
      const yymmdd = this.getYYMMDD(now);
      await this.state.storage.put(`seq:${yymmdd}`, 0);

      return new Response(JSON.stringify({
        success: true,
        message: "计数器已重置",
        date: yymmdd
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }
  }

  async getSequence(yymmdd) {
    // 检查是否是同一天
    const lastDate = await this.state.storage.get("last_date");

    // 如果日期变了，自动从 01 开始
    if (lastDate !== yymmdd) {
      return 0;
    }

    const seq = await this.state.storage.get(`seq:${yymmdd}`);
    return seq || 0;
  }

  getYYMMDD(date) {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + month + day;
  }
}
