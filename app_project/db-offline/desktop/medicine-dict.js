// ============================================================================
// medicine-dict.js — 中药字典工具模块
// 提供药品搜索、拼音简码匹配、字典加载等公共方法
// ============================================================================
(function (global) {
    'use strict';

    const MedicineDict = {
        _medicines: null,
        _pinyinIndex: null,

        // 初始化药材库
        init(medicines) {
            this._medicines = medicines || [];
            this._buildIndex();
        },

        // 构建搜索索引
        _buildIndex() {
            if (!this._medicines) return;
            this._pinyinIndex = this._medicines.map(m => ({
                name: (m.name || '').toLowerCase(),
                code: (m.code || '').toLowerCase(),
                pinyin: (m.pinyin || '').toLowerCase(),
                original: m
            }));
        },

        // 搜索药品（支持名称、简码、拼音）
        search(keyword, limit) {
            if (!this._pinyinIndex || !keyword) return [];
            limit = limit || 20;
            const kw = keyword.toLowerCase().trim();
            const exact = [];
            const prefix = [];
            const contains = [];

            for (const item of this._pinyinIndex) {
                if (item.name === kw || item.code === kw) {
                    exact.push(item.original);
                } else if (item.name.startsWith(kw) || item.code.startsWith(kw)) {
                    prefix.push(item.original);
                } else if (item.name.includes(kw) || item.code.includes(kw) || item.pinyin.includes(kw)) {
                    contains.push(item.original);
                }
                if (exact.length + prefix.length + contains.length >= limit * 2) break;
            }

            return [...exact, ...prefix, ...contains].slice(0, limit);
        },

        // 简码匹配（输入简码自动找到药名）
        findByCode(code) {
            if (!this._pinyinIndex || !code) return null;
            const lc = code.toLowerCase().trim();
            const match = this._pinyinIndex.find(m => m.code === lc);
            return match ? match.original : null;
        },

        // 名称匹配
        findByName(name) {
            if (!this._pinyinIndex || !name) return null;
            const lc = name.toLowerCase().trim();
            const match = this._pinyinIndex.find(m => m.name === lc);
            return match ? match.original : null;
        },

        // 格式化药材显示文本
        formatMedicine(m) {
            if (!m) return '';
            const parts = [m.name];
            if (m.unit) parts.push(`(${m.unit})`);
            if (m.price) parts.push(`¥${m.price}`);
            return parts.join(' ');
        },

        // 计算药材总价
        calculateTotal(medicines) {
            if (!medicines || !medicines.length) return 0;
            return medicines.reduce((sum, m) => {
                const qty = parseFloat(m.quantity) || 0;
                const price = parseFloat(m.price) || 0;
                return sum + (qty * price);
            }, 0);
        },

        // 生成药材编号（自动递增）
        generateId() {
            return 'med_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        },

        // 验证药材数据完整性
        validate(medicine) {
            const errors = [];
            if (!medicine.name || !medicine.name.trim()) errors.push('药名不能为空');
            if (!medicine.unit) errors.push('单位不能为空');
            if (medicine.price !== undefined && isNaN(parseFloat(medicine.price))) {
                errors.push('单价必须是数字');
            }
            return errors;
        },

        // 从 localStorage 加载药材库
        loadFromStorage(key) {
            key = key || 'medicine_library';
            try {
                const data = localStorage.getItem(key);
                const medicines = data ? JSON.parse(data) : [];
                this.init(medicines);
                return medicines;
            } catch (e) {
                console.warn('[DBG] 加载药材库失败:', e);
                this.init([]);
                return [];
            }
        },

        // 保存药材库到 localStorage
        saveToStorage(medicines, key) {
            key = key || 'medicine_library';
            try {
                localStorage.setItem(key, JSON.stringify(medicines));
                this.init(medicines);
                return true;
            } catch (e) {
                console.error('[DBG] 保存药材库失败:', e);
                return false;
            }
        },

        // 获取所有药材
        getAll() {
            return this._medicines || [];
        },

        // 按分类筛选
        filterByCategory(category) {
            if (!this._medicines) return [];
            if (!category) return this._medicines;
            return this._medicines.filter(m => m.category === category);
        }
    };

    global.MedicineDict = MedicineDict;

})(typeof window !== 'undefined' ? window : this);
