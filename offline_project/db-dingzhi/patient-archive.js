/**
 * patient-archive.js — 患者档案与统计公共模块
 *
 * 提取8个index.html中重复的统计计算逻辑为纯函数：
 *   - filterPrescriptionsByRange: 按时间范围过滤处方
 *   - analyzePatients: 患者就诊统计
 *   - analyzeDiseases: 病种分布统计
 *   - analyzeMedicines: 常用药材Top10统计
 *   - analyzeVisitTrend: 每日就诊趋势
 *   - analyzeMonthlyStats: 月度收支统计
 *   - formatDate: 日期格式化
 *   - calculateReturnRate: 复诊率计算
 *   - buildStatsCSV: 统计报表CSV构建
 *
 * 设计原则：
 *   - 纯函数无副作用，不依赖DOM或全局变量
 *   - 所有数据通过参数传入，便于各端复用
 *   - 全局挂载 window.PatientArchive，向后兼容
 *   - 各index.html原有函数保持不变，可渐进式迁移
 */
(function (global) {
    'use strict';

    /**
     * 按时间范围过滤处方
     * @param {Array} prescriptions - 处方列表
     * @param {string} range - 时间范围: today/week/month/quarter/year/all
     * @returns {Array} 过滤后的处方列表
     */
    function filterPrescriptionsByRange(prescriptions, range) {
        if (!Array.isArray(prescriptions)) return [];
        const now = new Date();
        let startDate = new Date(1970, 0, 1);

        switch (range) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'quarter': {
                const quarter = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), quarter * 3, 1);
                break;
            }
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            case 'all':
            default:
                // 不限制
                break;
        }

        return prescriptions.filter(function (p) {
            const date = new Date(p.createdAt || p.date || 0);
            return date >= startDate;
        });
    }

    /**
     * 患者就诊统计
     * @param {Array} prescriptions - 处方列表
     * @returns {Array} 患者统计列表 [{name, visitCount, firstVisit, lastVisit}]
     */
    function analyzePatients(prescriptions) {
        const list = Array.isArray(prescriptions) ? prescriptions : [];
        const patientMap = new Map();

        list.forEach(function (p) {
            const name = p.patientName || '未知';
            if (!patientMap.has(name)) {
                patientMap.set(name, {
                    visits: [],
                    firstVisit: null,
                    lastVisit: null
                });
            }
            const patient = patientMap.get(name);
            const visitDate = new Date(p.createdAt || p.date || 0);
            patient.visits.push(visitDate);
            if (!patient.firstVisit || visitDate < patient.firstVisit) {
                patient.firstVisit = visitDate;
            }
            if (!patient.lastVisit || visitDate > patient.lastVisit) {
                patient.lastVisit = visitDate;
            }
        });

        return Array.from(patientMap.entries()).map(function (entry) {
            return {
                name: entry[0],
                visitCount: entry[1].visits.length,
                firstVisit: entry[1].firstVisit,
                lastVisit: entry[1].lastVisit
            };
        });
    }

    /**
     * 病种分布统计
     * @param {Array} prescriptions - 处方列表
     * @returns {Array} 病种统计列表 [{name, count}] 按次数倒序
     */
    function analyzeDiseases(prescriptions) {
        const list = Array.isArray(prescriptions) ? prescriptions : [];
        const diseaseMap = new Map();

        list.forEach(function (p) {
            const diagnosis = p.diagnosis || '未诊断';
            diseaseMap.set(diagnosis, (diseaseMap.get(diagnosis) || 0) + 1);
        });

        return Array.from(diseaseMap.entries())
            .map(function (entry) {
                return { name: entry[0], count: entry[1] };
            })
            .sort(function (a, b) { return b.count - a.count; });
    }

    /**
     * 常用药材Top10统计
     * @param {Array} prescriptions - 处方列表
     * @param {number} [topN=10] - 返回前N项
     * @returns {Array} 药材统计列表 [{name, totalDosage}] 按用量倒序
     */
    function analyzeMedicines(prescriptions, topN) {
        const list = Array.isArray(prescriptions) ? prescriptions : [];
        const limit = (typeof topN === 'number') ? topN : 10;
        const medicineMap = new Map();

        list.forEach(function (p) {
            if (p.items && Array.isArray(p.items)) {
                p.items.forEach(function (m) {
                    const name = m.name || m.medicineName || '未知';
                    const dosage = parseFloat(m.dosage) || 0;
                    const doseCount = parseFloat(p.doseCount) || 1;
                    medicineMap.set(name, (medicineMap.get(name) || 0) + dosage * doseCount);
                });
            }
        });

        return Array.from(medicineMap.entries())
            .map(function (entry) {
                return { name: entry[0], totalDosage: entry[1] };
            })
            .sort(function (a, b) { return b.totalDosage - a.totalDosage; })
            .slice(0, limit);
    }

    /**
     * 每日就诊趋势
     * @param {Array} prescriptions - 处方列表
     * @returns {Object} {dates: Array<string>, counts: Array<number>}
     */
    function analyzeVisitTrend(prescriptions) {
        const list = Array.isArray(prescriptions) ? prescriptions : [];
        const dailyMap = new Map();

        list.forEach(function (p) {
            const date = new Date(p.createdAt || p.date || 0);
            const dateStr = date.toLocaleDateString('zh-CN');
            dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
        });

        const dates = Array.from(dailyMap.keys()).sort();
        const counts = dates.map(function (d) { return dailyMap.get(d); });
        return { dates: dates, counts: counts };
    }

    /**
     * 月度收支统计
     * @param {Array} prescriptions - 处方列表
     * @param {Array} medicines - 药品字典（用于查询成本价）
     * @returns {Array} 月度统计列表 [{visits,totalIncome,totalRegFee,totalCost,totalProfit,totalDoses,month}] 按月份倒序
     */
    function analyzeMonthlyStats(prescriptions, medicines) {
        const list = Array.isArray(prescriptions) ? prescriptions : [];
        const medList = Array.isArray(medicines) ? medicines : [];
        const statsMap = new Map();

        list.forEach(function (p) {
            const date = new Date(p.createdAt || p.date || 0);
            const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');

            if (!statsMap.has(monthKey)) {
                statsMap.set(monthKey, {
                    visits: 0,
                    totalIncome: 0,
                    totalRegFee: 0,
                    totalCost: 0,
                    totalProfit: 0,
                    totalDoses: 0
                });
            }

            const stats = statsMap.get(monthKey);
            stats.visits++;
            stats.totalIncome += (parseFloat(p.totalAmount) || 0) + (parseFloat(p.registrationFee) || 0);
            stats.totalRegFee += parseFloat(p.registrationFee) || 0;
            stats.totalDoses += parseFloat(p.doseCount) || 0;

            if (p.items && Array.isArray(p.items)) {
                p.items.forEach(function (item) {
                    const medicine = medList.find(function (m) {
                        return m.name === (item.name || item.medicineName);
                    });
                    const costPrice = parseFloat(medicine && medicine.costPrice) ||
                        parseFloat(item.costPrice) ||
                        parseFloat(item.price) || 0;
                    const dosage = parseFloat(item.dosage) || 0;
                    const doseCount = parseFloat(p.doseCount) || 1;
                    stats.totalCost += costPrice * dosage * doseCount;
                });
            }
        });

        statsMap.forEach(function (stats, key) {
            stats.totalProfit = stats.totalIncome - stats.totalCost;
            stats.month = key.split('-')[1];
        });

        return Array.from(statsMap.values())
            .sort(function (a, b) { return b.month - a.month; });
    }

    /**
     * 日期格式化（中文区域）
     * @param {Date|string|number} date
     * @returns {string} 格式化后的日期字符串，空值返回 '-'
     */
    function formatDate(date) {
        if (!date) return '-';
        return date.toLocaleDateString('zh-CN');
    }

    /**
     * 计算复诊率
     * @param {Array} patients - analyzePatients 返回的患者列表
     * @param {number} totalVisits - 总就诊次数
     * @returns {number} 复诊率百分比（0-100）
     */
    function calculateReturnRate(patients, totalVisits) {
        const list = Array.isArray(patients) ? patients : [];
        const visits = (typeof totalVisits === 'number') ? totalVisits : 0;
        const returnPatients = list.filter(function (p) { return p.visitCount > 1; }).length;
        if (list.length === 0 || visits === 0) return 0;
        return (returnPatients / list.length) * 100;
    }

    /**
     * 构建统计报表CSV字符串
     * @param {Object} params
     * @param {Array} params.patients - analyzePatients 结果
     * @param {Array} params.diseases - analyzeDiseases 结果
     * @param {Array} params.medicines - analyzeMedicines 结果
     * @param {Object} params.trend - analyzeVisitTrend 结果
     * @param {number} params.totalVisits - 总就诊次数
     * @param {string} params.range - 时间范围标识
     * @returns {string} CSV字符串
     */
    function buildStatsCSV(params) {
        const p = params || {};
        const patients = Array.isArray(p.patients) ? p.patients : [];
        const diseases = Array.isArray(p.diseases) ? p.diseases : [];
        const medicines = Array.isArray(p.medicines) ? p.medicines : [];
        const totalVisits = (typeof p.totalVisits === 'number') ? p.totalVisits : 0;
        const range = p.range || 'month';

        const newPatients = patients.filter(function (x) { return x.visitCount === 1; }).length;
        const returnPatients = patients.filter(function (x) { return x.visitCount > 1; }).length;
        const returnRate = totalVisits > 0 ? ((returnPatients / patients.length) * 100) : 0;

        const rangeText = {
            today: '今日', week: '本周', month: '本月',
            quarter: '本季度', year: '本年', all: '全部'
        };

        let csv = '统计范围,' + (rangeText[range] || '全部') + '\n';
        csv += '统计时间,' + new Date().toLocaleString('zh-CN') + '\n\n';
        csv += '就诊总量,' + totalVisits + '\n';
        csv += '初诊人数,' + newPatients + '\n';
        csv += '复诊人数,' + returnPatients + '\n';
        csv += '复诊率,' + returnRate.toFixed(1) + '%\n\n';
        csv += '病种分布\n';
        csv += '病种,次数\n';
        diseases.slice(0, 10).forEach(function (d) {
            csv += '"' + d.name + '",' + d.count + '\n';
        });
        csv += '\n常用药材 Top 10\n';
        csv += '药材名称,总用量(g)\n';
        medicines.forEach(function (m) {
            csv += '"' + m.name + '",' + Math.round(m.totalDosage) + '\n';
        });

        return csv;
    }

    var PatientArchive = {
        filterPrescriptionsByRange: filterPrescriptionsByRange,
        analyzePatients: analyzePatients,
        analyzeDiseases: analyzeDiseases,
        analyzeMedicines: analyzeMedicines,
        analyzeVisitTrend: analyzeVisitTrend,
        analyzeMonthlyStats: analyzeMonthlyStats,
        formatDate: formatDate,
        calculateReturnRate: calculateReturnRate,
        buildStatsCSV: buildStatsCSV
    };

    global.PatientArchive = PatientArchive;

    // CommonJS 兼容（Electron preload 等场景）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PatientArchive;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
