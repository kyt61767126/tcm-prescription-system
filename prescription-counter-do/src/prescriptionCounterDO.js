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

    // GET /next-prescription-no - 获取下一个处方号（支持按用户隔离）
    if (url.pathname === "/next-prescription-no") {
      const username = url.searchParams.get('username') || 'default';
      return this.getNextPrescriptionNo(username);
    }

    // GET /current-prescription-no - 获取当前处方号（不递增，支持按用户隔离）
    if (url.pathname === "/current-prescription-no") {
      const username = url.searchParams.get('username') || 'default';
      return this.getCurrentPrescriptionNo(username);
    }

    // GET /reset - 重置计数器（支持按用户隔离）
    if (url.pathname === "/reset") {
      const username = url.searchParams.get('username') || 'default';
      return this.resetCounter(username);
    }

    return new Response("Not Found", { status: 404 });
  }

  async getNextPrescriptionNo(username) {
    try {
      const now = new Date();
      const yymmdd = this.getYYMMDD(now);

      // 获取该用户今天的序号（按用户隔离）
      let seq = await this.getSequence(username, yymmdd);
      seq += 1;

      // 保存该用户的序号
      await this.state.storage.put(`seq:${username}:${yymmdd}`, seq);
      await this.state.storage.put(`last_date:${username}`, yymmdd);

      // 生成处方号（格式：YYMMDDNN，序号从01开始）
      const prescriptionNo = yymmdd + seq.toString().padStart(2, "0");

      const response = {
        success: true,
        prescriptionNo: prescriptionNo,
        timestamp: now.toISOString(),
        date: yymmdd,
        sequence: seq,
        username: username
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

  async getCurrentPrescriptionNo(username) {
    try {
      const now = new Date();
      const yymmdd = this.getYYMMDD(now);
      const seq = await this.getSequence(username, yymmdd);
      // 生成处方号（格式：YYMMDDNN）
      const prescriptionNo = yymmdd + seq.toString().padStart(2, "0");

      return new Response(JSON.stringify({
        success: true,
        prescriptionNo: prescriptionNo,
        sequence: seq,
        date: yymmdd,
        nextSequence: seq + 1,
        username: username
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

  async resetCounter(username) {
    try {
      const now = new Date();
      const yymmdd = this.getYYMMDD(now);
      await this.state.storage.put(`seq:${username}:${yymmdd}`, 0);

      return new Response(JSON.stringify({
        success: true,
        message: "计数器已重置",
        date: yymmdd,
        username: username
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

  async getSequence(username, yymmdd) {
    // 检查该用户是否是同一天
    const lastDate = await this.state.storage.get(`last_date:${username}`);

    // 如果日期变了，自动从 01 开始
    if (lastDate !== yymmdd) {
      return 0;
    }

    const seq = await this.state.storage.get(`seq:${username}:${yymmdd}`);
    return seq || 0;
  }

  getYYMMDD(date) {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + month + day;
  }
}
