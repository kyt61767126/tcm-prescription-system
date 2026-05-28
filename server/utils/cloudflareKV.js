const axios = require('axios');

let mockStorage = {};

class CloudflareKV {
    constructor() {
        this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        this.namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
        this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
        
        const isPlaceholder = (value) => {
            return !value || value.startsWith('your-') || value.startsWith('YOUR_');
        };
        
        this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}`;
        this.headers = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
        };

        this.localCache = {};
        this.cacheTTL = 5000;
        
        this.isMockMode = isPlaceholder(this.accountId) || isPlaceholder(this.namespaceId) || isPlaceholder(this.apiToken);
        this.cloudEnabled = !this.isMockMode;
        
        if (this.isMockMode) {
            console.log('⚠️  使用本地模拟存储模式（请配置 Cloudflare KV 环境变量以启用云端存储）');
        } else {
            console.log('☁️  Cloudflare KV 云端存储已启用');
            // 测试连接
            this.testConnection();
        }
    }
    
    async testConnection() {
        try {
            await this.list('test_');
            console.log('✅ Cloudflare KV 连接测试成功');
        } catch (error) {
            console.log('⚠️ Cloudflare KV 连接测试失败，降级到本地模拟模式');
            console.log('错误原因:', error.message);
            this.isMockMode = true;
        }
    }

    async get(key) {
        if (this.isMockMode) {
            return mockStorage[key] || null;
        }

        const cacheKey = `kv_${key}`;
        const cached = this.localCache[cacheKey];
        
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.value;
        }

        try {
            const response = await axios.get(`${this.baseUrl}/values/${encodeURIComponent(key)}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
            
            let value = response.data.result;
            if (typeof value === 'string') {
                try {
                    value = JSON.parse(value);
                } catch {
                }
            }

            this.localCache[cacheKey] = {
                value: value,
                timestamp: Date.now()
            };

            return value;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            console.error('Cloudflare KV GET error:', error.message);
            return null;
        }
    }

    async put(key, value) {
        if (this.isMockMode) {
            mockStorage[key] = value;
            return true;
        }

        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        
        try {
            await axios.put(`${this.baseUrl}/values/${encodeURIComponent(key)}`, stringValue, {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'text/plain'
                }
            });

            const cacheKey = `kv_${key}`;
            this.localCache[cacheKey] = {
                value: value,
                timestamp: Date.now()
            };

            return true;
        } catch (error) {
            console.error('Cloudflare KV PUT error:', error.message);
            if (error.response) {
                console.error('KV PUT Status:', error.response.status);
                console.error('KV PUT Response:', JSON.stringify(error.response.data));
                if (error.response.status === 400) {
                    console.log('🔄 请求格式错误，自动降级到本地模拟模式');
                    this.isMockMode = true;
                    mockStorage[key] = value;
                    return true;
                }
            }
            if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                console.log('🔄 云端存储权限不足，自动降级到本地模拟模式');
                this.isMockMode = true;
                mockStorage[key] = value;
                return true;
            }
            if (error.response && error.response.status === 404) {
                console.log('🔄 KV Namespace 不存在或配置错误，自动降级到本地模拟模式');
                this.isMockMode = true;
                mockStorage[key] = value;
                return true;
            }
            return false;
        }
    }

    async delete(key) {
        if (this.isMockMode) {
            delete mockStorage[key];
            return true;
        }

        try {
            await axios.delete(`${this.baseUrl}/values/${encodeURIComponent(key)}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });

            const cacheKey = `kv_${key}`;
            delete this.localCache[cacheKey];

            return true;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return true;
            }
            console.error('Cloudflare KV DELETE error:', error.message);
            return false;
        }
    }

    async list(prefix = '') {
        if (this.isMockMode) {
            return Object.keys(mockStorage)
                .filter(key => key.startsWith(prefix))
                .map(key => ({ name: key }));
        }

        try {
            const response = await axios.get(`${this.baseUrl}/keys`, {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                },
                params: {
                    prefix: prefix,
                    limit: 1000
                }
            });

            return response.data.result || [];
        } catch (error) {
            console.error('Cloudflare KV LIST error:', error.message);
            return [];
        }
    }

    async deleteByPrefix(prefix) {
        const keys = await this.list(prefix);
        const deletePromises = keys.map(key => this.delete(key.name));
        await Promise.all(deletePromises);
        return keys.length;
    }
}

module.exports = new CloudflareKV();