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
      const year = String(now.getFullYear()).slice(-2);

      // 获取该用户当前年份的序号（按用户+年份隔离，不每日重置）
      let seq = await this.getSequence(username, year);
      seq += 1;

      // 保存该用户的序号
      await this.state.storage.put(`seq:${username}:${year}`, seq);

      // 生成处方号（格式：YY + 6位序号，如 26000001）
      const prescriptionNo = year + seq.toString().padStart(6, "0");

      const response = {
        success: true,
        prescriptionNo: prescriptionNo,
        timestamp: now.toISOString(),
        year: year,
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
      const year = String(now.getFullYear()).slice(-2);
      const seq = await this.getSequence(username, year);
      // 生成处方号（格式：YY + 6位序号，如 26000001）
      const prescriptionNo = year + seq.toString().padStart(6, "0");

      return new Response(JSON.stringify({
        success: true,
        prescriptionNo: prescriptionNo,
        sequence: seq,
        year: year,
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
      const year = String(now.getFullYear()).slice(-2);
      await this.state.storage.put(`seq:${username}:${year}`, 0);

      return new Response(JSON.stringify({
        success: true,
        message: "计数器已重置",
        year: year,
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

  async getSequence(username, year) {
    // 按用户+年份统计序号，不每日重置
    const seq = await this.state.storage.get(`seq:${username}:${year}`);
    return seq || 0;
  }

  getYYMMDD(date) {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + month + day;
  }
}
