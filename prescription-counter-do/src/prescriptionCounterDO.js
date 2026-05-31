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
    const username = url.searchParams.get('username') || 'default';
    const type = url.searchParams.get('type') || 'daily'; // daily: YYMMDDNN, yearly: YY + 6位

    // GET /next-prescription-no - 获取下一个处方号（支持按用户隔离）
    if (url.pathname === "/next-prescription-no") {
      return this.getNextPrescriptionNo(username, type);
    }

    // GET /current-prescription-no - 获取当前处方号（不递增，支持按用户隔离）
    if (url.pathname === "/current-prescription-no") {
      return this.getCurrentPrescriptionNo(username, type);
    }

    // GET /reset - 重置计数器（支持按用户隔离）
    if (url.pathname === "/reset") {
      return this.resetCounter(username, type);
    }

    return new Response("Not Found", { status: 404 });
  }

  async getNextPrescriptionNo(username, type) {
    try {
      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);
      const yymmdd = this.getYYMMDD(now);
      
      let seq, prescriptionNo, storageKey;

      if (type === 'yearly') {
        // yearly 类型：YY + 6位序号，不每日重置
        storageKey = `seq:${username}:yearly:${year}`;
        seq = await this.state.storage.get(storageKey) || 0;
        seq += 1;
        await this.state.storage.put(storageKey, seq);
        prescriptionNo = year + seq.toString().padStart(6, "0");
      } else {
        // daily 类型（默认）：YYMMDDNN，每日重置
        storageKey = `seq:${username}:daily:${yymmdd}`;
        const lastDate = await this.state.storage.get(`last_date:${username}:daily`);
        
        if (lastDate !== yymmdd) {
          seq = 1;
        } else {
          seq = await this.state.storage.get(storageKey) || 0;
          seq += 1;
        }
        
        await this.state.storage.put(storageKey, seq);
        await this.state.storage.put(`last_date:${username}:daily`, yymmdd);
        prescriptionNo = yymmdd + seq.toString().padStart(2, "0");
      }

      const response = {
        success: true,
        prescriptionNo: prescriptionNo,
        timestamp: now.toISOString(),
        year: year,
        date: yymmdd,
        sequence: seq,
        username: username,
        type: type
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

  async getCurrentPrescriptionNo(username, type) {
    try {
      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);
      const yymmdd = this.getYYMMDD(now);
      
      let seq, prescriptionNo;

      if (type === 'yearly') {
        // yearly 类型：YY + 6位序号
        seq = await this.state.storage.get(`seq:${username}:yearly:${year}`) || 0;
        prescriptionNo = year + seq.toString().padStart(6, "0");
      } else {
        // daily 类型（默认）：YYMMDDNN
        const lastDate = await this.state.storage.get(`last_date:${username}:daily`);
        if (lastDate !== yymmdd) {
          seq = 0;
        } else {
          seq = await this.state.storage.get(`seq:${username}:daily:${yymmdd}`) || 0;
        }
        prescriptionNo = yymmdd + seq.toString().padStart(2, "0");
      }

      return new Response(JSON.stringify({
        success: true,
        prescriptionNo: prescriptionNo,
        sequence: seq,
        year: year,
        date: yymmdd,
        nextSequence: seq + 1,
        username: username,
        type: type
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

  async resetCounter(username, type) {
    try {
      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);
      const yymmdd = this.getYYMMDD(now);
      
      if (type === 'yearly') {
        await this.state.storage.put(`seq:${username}:yearly:${year}`, 0);
      } else {
        await this.state.storage.put(`seq:${username}:daily:${yymmdd}`, 0);
        await this.state.storage.put(`last_date:${username}:daily`, yymmdd);
      }

      return new Response(JSON.stringify({
        success: true,
        message: "计数器已重置",
        year: year,
        date: yymmdd,
        username: username,
        type: type
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

  getYYMMDD(date) {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + month + day;
  }
}
