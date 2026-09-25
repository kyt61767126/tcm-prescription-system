// ============================================================================
//  analytics-core.js —— 数据统计核心（P2-1 · 2026-09-25）
//
//  从云端/离线两份 index.html 内联统计块（各 ~580 行）等体抽取，
//  两端字节同构（仅离线 exportStats 多一道 data-export 付费墙，
//  本模块以 "requireFeature 是否存在" 自适应，无需分支副本）。
//
//  内容：范围过滤 / 患者分析（初复诊）/ 病种分布 / 药材用量 Top10 /
//    就诊趋势 / canvas 手绘三型图表（柱/饼/横条，DPR+响应式+重试）/
//    月度统计报表（收入/诊疗费/成本/利润/剂数，权限隔离口径）/
//    CSV 报表导出 / 窗口 resize 防抖重绘 / 一键调取患者处方。
//
//  跨作用域访问（同 stock-core 范式）：本模块在 inline 主脚本之前
//    加载，函数调用时按裸标识符从全局词法环境读取主脚本的顶层绑定：
//    prescriptionHistory、medicines、getAllUserPrescriptions、
//    filterPrescriptionsByPermission、escapeHtml、escapeJs、formatPrice、
//    closeModal、searchPatientsQuick、showSideHistory。
//    禁用 new Function/eval（云端 CSP 拦 unsafe-eval）。
//
//  自安装：模块加载即把 refreshAnalytics / exportStats / loadPatientHistory
//    挂到 window（HTML 内联事件依赖全局解析），并暴露 window.AnalyticsCore。
//
//  权威源：shared/analytics-core.js（sync-all BusinessJs 组 +
//    copy-consistency 8 副本硬哈希门）。
// ============================================================================
(function (global) {
    'use strict';

        function getFilteredPrescriptions(rangeId) {
            const elementId = rangeId || 'analyticsRange';
            const range = document.getElementById(elementId)?.value || 'month';
            const now = new Date();
            let startDate = new Date(1970, 0, 1);
            
            switch(range) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'quarter':
                    const quarter = Math.floor(now.getMonth() / 3);
                    startDate = new Date(now.getFullYear(), quarter * 3, 1);
                    break;
                case 'year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    break;
            }
            
            const sourceData = prescriptionHistory;
            
            return sourceData.filter(p =>{
                const date = new Date(p.date || p.createdAt || 0);
                return date >= startDate;
            });
        }

        function analyzePatients() {
            const filteredPrescriptions = getFilteredPrescriptions();
            const patientMap = new Map();
            
            filteredPrescriptions.forEach(p =>{
                const name = p.patientName || '未知';
                if (!patientMap.has(name)) {
                    patientMap.set(name, {
                        visits: [],
                        firstVisit: null,
                        lastVisit: null
                    });
                }
                const patient = patientMap.get(name);
                // ★ 2026-09-14 日期优先级反转：p.date（就诊日期，可经 editPrescriptionDate 补录修改）
                //   优先于 createdAt（首建时间戳）；云端拉取的记录 createdAt 恒为首建值，
                //   若其优先则补录日期在患者分析页不生效（历史列表/统计页均按 p.date 归位）
                const visitDate = new Date(p.date || p.createdAt || 0);
                patient.visits.push(visitDate);
                if (!patient.firstVisit || visitDate< patient.firstVisit) {
                    patient.firstVisit = visitDate;
                }
                if (!patient.lastVisit || visitDate >patient.lastVisit) {
                    patient.lastVisit = visitDate;
                }
            });
            
            return Array.from(patientMap.entries()).map(([name, data]) =>({
                name,
                visitCount: data.visits.length,
                firstVisit: data.firstVisit,
                lastVisit: data.lastVisit
            }));
        }

        function analyzeDiseases() {
            const filteredPrescriptions = getFilteredPrescriptions();
            const diseaseMap = new Map();
            
            filteredPrescriptions.forEach(p =>{
                const diagnosis = p.diagnosis || '未诊断';
                diseaseMap.set(diagnosis, (diseaseMap.get(diagnosis) || 0) + 1);
            });
            
            return Array.from(diseaseMap.entries())
                .map(([name, count]) =>({ name, count }))
                .sort((a, b) =>b.count - a.count);
        }

        function analyzeMedicines() {
            const filteredPrescriptions = getFilteredPrescriptions();
            const medicineMap = new Map();
            
            filteredPrescriptions.forEach(p =>{
                if (p.items && Array.isArray(p.items)) {
                    p.items.forEach(m =>{
                        const name = m.name || m.medicineName || '未知';
                        const dosage = parseFloat(m.dosage) || 0;
                        const doseCount = parseFloat(p.doseCount) || 1;
                        medicineMap.set(name, (medicineMap.get(name) || 0) + dosage * doseCount);
                    });
                }
            });
            
            return Array.from(medicineMap.entries())
                .map(([name, totalDosage]) =>({ name, totalDosage }))
                .sort((a, b) =>b.totalDosage - a.totalDosage)
                .slice(0, 10);
        }

        function formatDate(date) {
            if (!date) return '-';
            return date.toLocaleDateString('zh-CN');
        }

        function analyzeVisitTrend() {
            const filteredPrescriptions = getFilteredPrescriptions();
            const dailyMap = new Map();
            
            filteredPrescriptions.forEach(p =>{
                const date = new Date(p.date || p.createdAt || 0);
                const dateStr = date.toLocaleDateString('zh-CN');
                dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + 1);
            });
            
            const dates = Array.from(dailyMap.keys()).sort();
            return {
                dates,
                counts: dates.map(d =>dailyMap.get(d))
            };
        }

        function createChart(canvasId, type, data, retryCount = 0) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return null;

            const ctx = canvas.getContext('2d');

            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();

            if (rect.width === 0 || rect.height === 0) {
                if (retryCount < 3) {
                    setTimeout(() => createChart(canvasId, type, data, retryCount + 1), 100);
                }
                return null;
            }

            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const width = rect.width;
            const height = rect.height;

            ctx.clearRect(0, 0, width, height);

            // 响应式参数：根据屏幕宽度调整字体和 padding，提升手机端可读性
            const isMobile = window.innerWidth < 768;
            const isSmall = window.innerWidth < 480;
            const labelFont = isMobile ? '12px Arial' : '10px Arial';
            const valueFont = isMobile ? 'bold 12px Arial' : 'bold 10px Arial';
            const axisFont = isMobile ? '11px Arial' : '10px Arial';
            const labelMaxLen = isMobile ? (isSmall ? 3 : 4) : 5;
            const pieLegendFont = isMobile ? '12px Arial' : '11px Arial';
            const pieLegendMaxLen = isMobile ? (isSmall ? 5 : 7) : 7;
            const hBarFont = isMobile ? '11px Arial' : '11px Arial';
            const hBarLabelMaxLen = isMobile ? (isSmall ? 3 : 4) : 7;

            if (type === 'bar') {
                if (!data.labels || !data.values || data.labels.length === 0) {
                    ctx.fillStyle = '#999';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('暂无数据', width / 2, height / 2);
                    return;
                }

                const padding = isMobile
                    ? { top: 18, right: 10, bottom: 32, left: 32 }
                    : { top: 20, right: 20, bottom: 40, left: 50 };
                const chartWidth = width - padding.left - padding.right;
                const chartHeight = height - padding.top - padding.bottom;

                const maxValue = Math.max(...data.values, 1);
                const barWidth = Math.min(chartWidth / data.labels.length * 0.7, isMobile ? 36 : 30);
                const gap = chartWidth / data.labels.length;

                ctx.fillStyle = '#333';
                ctx.font = labelFont;
                ctx.textAlign = 'center';
                data.labels.forEach((label, i) => {
                    const x = padding.left + i * gap + gap / 2;
                    ctx.fillText(label.length > labelMaxLen + 1 ? label.substring(0, labelMaxLen) + '…' : label, x, height - 10);
                });

                ctx.save();
                ctx.translate(padding.left, padding.top + chartHeight);
                ctx.scale(1, -1);

                data.values.forEach((value, i) => {
                    const x = i * gap + (gap - barWidth) / 2;
                    const barHeight = (value / maxValue) * chartHeight;
                    const gradient = ctx.createLinearGradient(x, 0, x, barHeight);
                    gradient.addColorStop(0, '#4CAF50');
                    gradient.addColorStop(1, '#2E7D32');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(x, 0, barWidth, barHeight);
                    ctx.strokeStyle = '#1B5E20';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x, 0, barWidth, barHeight);
                });

                ctx.restore();

                ctx.fillStyle = '#333';
                ctx.font = valueFont;
                ctx.textAlign = 'center';
                data.values.forEach((value, i) => {
                    const x = padding.left + i * gap + gap / 2;
                    const barHeight = (value / maxValue) * chartHeight;
                    ctx.fillText(value.toString(), x, padding.top + chartHeight - barHeight - 8);
                });

                ctx.strokeStyle = '#ddd';
                ctx.lineWidth = 1;
                for (let i = 0; i <= 4; i++) {
                    const y = padding.top + (chartHeight / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(padding.left, y);
                    ctx.lineTo(width - padding.right, y);
                    ctx.stroke();

                    const value = Math.round(maxValue * (1 - i / 4));
                    ctx.fillStyle = '#666';
                    ctx.font = axisFont;
                    ctx.textAlign = 'right';
                    ctx.fillText(value.toString(), padding.left - 5, y + 4);
                }

                ctx.strokeStyle = '#ddd';
                ctx.beginPath();
                ctx.moveTo(padding.left, padding.top);
                ctx.lineTo(padding.left, height - padding.bottom);
                ctx.stroke();

            } else if (type === 'pie') {
                if (!data.labels || !data.values || data.values.length === 0) {
                    ctx.fillStyle = '#999';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('暂无数据', width / 2, height / 2);
                    return;
                }

                // 手机端：饼图居中偏左，图例竖向排列在右侧；桌面端：保持原居中布局
                const centerX = isMobile ? width * 0.38 : width / 2;
                const centerY = isMobile ? height / 2 : height / 2;
                const radius = isMobile
                    ? Math.min(width * 0.35, height / 2) - 10
                    : Math.min(width, height) / 2 - 20;

                const total = data.values.reduce((a, b) => a + b, 0);
                let startAngle = -Math.PI / 2;

                const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'];

                data.values.forEach((value, i) => {
                    const sliceAngle = (value / total) * 2 * Math.PI;
                    const color = colors[i % colors.length];

                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    startAngle += sliceAngle;
                });

                ctx.fillStyle = '#333';
                ctx.font = pieLegendFont;
                ctx.textAlign = 'left';

                if (isMobile) {
                    // 手机端：图例竖向排列在饼图右侧，每行一项，便于阅读
                    const legendStartX = centerX + radius + 16;
                    const legendStartY = Math.max(20, (height - data.labels.length * 22) / 2);
                    data.labels.forEach((label, i) => {
                        const color = colors[i % colors.length];
                        const text = `${label.length > pieLegendMaxLen + 1 ? label.substring(0, pieLegendMaxLen) + '…' : label} (${data.values[i]})`;
                        const y = legendStartY + i * 22;
                        ctx.fillStyle = color;
                        ctx.fillRect(legendStartX, y, 14, 14);
                        ctx.fillStyle = '#333';
                        ctx.fillText(text, legendStartX + 20, y + 11);
                    });
                } else {
                    // 桌面端：保持原有横向布局
                    const legendY = 20;
                    let legendX = 20;
                    data.labels.forEach((label, i) => {
                        const color = colors[i % colors.length];
                        const text = `${label.length > pieLegendMaxLen + 1 ? label.substring(0, pieLegendMaxLen) + '…' : label} (${data.values[i]})`;

                        ctx.fillStyle = color;
                        ctx.fillRect(legendX, legendY + i * 18, 12, 12);
                        ctx.fillStyle = '#333';
                        ctx.fillText(text, legendX + 18, legendY + i * 18 + 10);

                        legendX += ctx.measureText(text).width + 25;
                        if (legendX > width - 100) {
                            legendX = 20;
                        }
                    });
                }

            } else if (type === 'horizontalBar') {
                if (!data.labels || !data.values || data.values.length === 0) {
                    ctx.fillStyle = '#999';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('暂无数据', width / 2, height / 2);
                    return;
                }

                // 手机端：左侧 padding 容纳药材名，右侧 padding 预留数值空间
                const padding = isMobile
                    ? { top: 3, right: 70, bottom: 3, left: 48 }
                    : { top: 10, right: 80, bottom: 10, left: 80 };
                const chartWidth = width - padding.left - padding.right;
                const chartHeight = height - padding.top - padding.bottom;

                const maxValue = Math.max(...data.values, 1);
                const barHeight = Math.min(chartHeight / data.labels.length * 0.85, isMobile ? 10 : 25);
                const gap = chartHeight / data.labels.length;

                const colors = ['#4CAF50', '#2196F3', '#FF9800', '#F44336', '#9C27B0', '#00BCD4', '#FFEB3B', '#E91E63', '#607D8B', '#8BC34A'];

                data.labels.forEach((label, i) => {
                    const y = padding.top + i * gap + (gap - barHeight) / 2;
                    const barWidth = (data.values[i] / maxValue) * chartWidth;
                    const color = colors[i % colors.length];

                    ctx.fillStyle = color;
                    ctx.fillRect(padding.left, y, barWidth, barHeight);
                    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(padding.left, y, barWidth, barHeight);

                    ctx.fillStyle = '#333';
                    ctx.font = hBarFont;
                    ctx.textAlign = 'right';
                    ctx.fillText(label.length > hBarLabelMaxLen + 1 ? label.substring(0, hBarLabelMaxLen) + '…' : label, padding.left - 5, y + barHeight / 2 + 4);

                    // 智能格式化数值：大数值转换为 kg
                    const dosageValue = data.values[i];
                    const dosageText = dosageValue >= 10000 ? Math.round(dosageValue / 1000) + 'kg' : Math.round(dosageValue) + 'g';
                    const textWidth = ctx.measureText(dosageText).width;

                    // 策略：条形足够宽时数值放条形内部（白色）；否则放右侧并确保不超出右边界
                    if (barWidth > textWidth + 10) {
                        ctx.textAlign = 'right';
                        ctx.fillStyle = '#fff';
                        ctx.fillText(dosageText, padding.left + barWidth - 3, y + barHeight / 2 + 4);
                    } else {
                        const textX = padding.left + barWidth + 3;
                        if (textX + textWidth > width - 2) {
                            // 超出右边界：改放条形内部（即使条形较短）
                            ctx.textAlign = 'right';
                            ctx.fillStyle = '#fff';
                            ctx.fillText(dosageText, padding.left + Math.max(barWidth, textWidth + 5) - 3, y + barHeight / 2 + 4);
                        } else {
                            ctx.textAlign = 'left';
                            ctx.fillStyle = '#333';
                            ctx.fillText(dosageText, textX, y + barHeight / 2 + 4);
                        }
                    }
                });

                ctx.strokeStyle = '#ddd';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                for (let i = 0; i <= 4; i++) {
                    const x = padding.left + (chartWidth / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(x, padding.top);
                    ctx.lineTo(x, height - padding.bottom);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            }
        }

        async function analyzeMonthlyStats() {
            const statsMap = new Map();
            // ★ 权限隔离（2026-08-22）：月度统计必须复用权限过滤，与历史列表口径一致。
            //   修复：此前 getAllUserPrescriptions() 不带参数读取全量数据，同一设备
            //   多账户登入时（或云端断网回退本地缓存时）统计会串号泄露其他用户处方。
            //   普通用户仅统计本人（createdBy === username），管理员统计全部。
            const allPrescriptions = filterPrescriptionsByPermission(await getAllUserPrescriptions());

            allPrescriptions.forEach(p => {
                const date = new Date(p.date || p.createdAt || 0);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

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
                    p.items.forEach(item => {
                        const medicine = medicines.find(m => m.name === (item.name || item.medicineName));
                        const costPrice = parseFloat(medicine?.costPrice) || parseFloat(item.costPrice) || parseFloat(item.price) || 0;
                        const dosage = parseFloat(item.dosage) || 0;
                        const doseCount = parseFloat(p.doseCount) || 1;
                        stats.totalCost += costPrice * dosage * doseCount;
                    });
                }
            });

            statsMap.forEach((stats, key) => {
                stats.totalProfit = stats.totalIncome - stats.totalCost;
                stats.month = key.split('-')[1];
            });

            return Array.from(statsMap.values())
                .sort((a, b) => b.month - a.month);
        }

        async function refreshAnalytics() {
          try {
            const patients = analyzePatients();
            const visitCountFilter = document.getElementById('visitCountFilter')?.value || 'all';
            const sortOption = document.getElementById('analyticsSort')?.value || 'visitCount-desc';
            
            let filteredPatients = patients;
            
            if (visitCountFilter !== 'all') {
                const count = parseInt(visitCountFilter);
                if (count === 4) {
                    filteredPatients = patients.filter(p =>p.visitCount >= 4);
                } else {
                    filteredPatients = patients.filter(p =>p.visitCount === count);
                }
            }
            
            filteredPatients.sort((a, b) =>{
                const [field, dir] = sortOption.split('-');
                let comparison = 0;
                
                if (field === 'visitCount') {
                    comparison = a.visitCount - b.visitCount;
                } else if (field === 'lastVisit') {
                    comparison = (a.lastVisit?.getTime() || 0) - (b.lastVisit?.getTime() || 0);
                }
                
                return dir === 'desc' ? -comparison : comparison;
            });
            
            const totalPatients = patients.length;
            const newPatients = patients.filter(p =>p.visitCount === 1).length;
            const returnPatients = patients.filter(p =>p.visitCount >1).length;
            const returnRate = totalPatients >0 ? ((returnPatients / totalPatients) * 100).toFixed(1) : '0.0';
            
            document.getElementById('statTotalPatients').textContent = totalPatients;
            document.getElementById('statNewPatients').textContent = newPatients;
            document.getElementById('statReturnPatients').textContent = returnPatients;
            document.getElementById('statReturnRate').textContent = returnRate + '%';
            
            const trend = analyzeVisitTrend();
            createChart('visitTrendChart', 'bar', {
                labels: trend.dates.slice(-14),
                values: trend.counts.slice(-14)
            });
            
            const diseases = analyzeDiseases().slice(0, 6);
            createChart('diseaseChart', 'pie', {
                labels: diseases.map(d =>d.name),
                values: diseases.map(d =>d.count)
            });
            
            const medicines = analyzeMedicines();
            createChart('medicineChart', 'horizontalBar', {
                labels: medicines.map(m =>m.name),
                values: medicines.map(m =>m.totalDosage)
            });
            
            const tbody = document.getElementById('patientVisitList');
            if (filteredPatients.length >0) {
                tbody.innerHTML = filteredPatients.slice(0, 50).map(p =>`<tr style="hover:background:#f5f5f5;"><td style="border:1px solid #ddd;padding:6px;">${escapeHtml(p.name)}</td><td style="border:1px solid #ddd;padding:6px;text-align:center;">${p.visitCount}</td><td style="border:1px solid #ddd;padding:6px;text-align:center;">${formatDate(p.firstVisit)}</td><td style="border:1px solid #ddd;padding:6px;text-align:center;">${formatDate(p.lastVisit)}</td><td style="border:1px solid #ddd;padding:6px;text-align:center;"><button class="small-btn" onclick="loadPatientHistory('${escapeJs(p.name)}')" style="padding:2px 8px;">调取处方</button></td></tr>`).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999;">暂无数据</td></tr>';
            }

            const monthlyStats = await analyzeMonthlyStats();
            const statsTbody = document.getElementById('monthlyStatsTable');
            if (monthlyStats.length > 0) {
                statsTbody.innerHTML = monthlyStats.map(s =>`<tr style="hover:background:#f5f5f5;"><td style="border:1px solid #ddd;padding:6px;text-align:center;">${escapeHtml(s.month)}月</td><td style="border:1px solid #ddd;padding:6px;text-align:center;">${s.visits}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatPrice(s.totalIncome)}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatPrice(s.totalRegFee)}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatPrice(s.totalCost)}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatPrice(s.totalProfit)}</td><td style="border:1px solid #ddd;padding:6px;text-align:center;">${s.totalDoses}</td></tr>`).join('');
            } else {
                statsTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#999;">暂无数据</td></tr>';
            }
          } catch (e) {
            console.error('refreshAnalytics 执行失败:', e);
            alert('数据统计加载失败: ' + e.message);
          }
        }

        // 窗口尺寸变化时防抖重绘图表（适配手机横竖屏切换）
        let _analyticsResizeTimer = null;
        let _analyticsLastWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            const currentWidth = window.innerWidth;
            if (currentWidth === _analyticsLastWidth) return;
            _analyticsLastWidth = currentWidth;
            if (_analyticsResizeTimer) clearTimeout(_analyticsResizeTimer);
            _analyticsResizeTimer = setTimeout(() => {
                const analyticsModal = document.getElementById('analyticsModal');
                if (analyticsModal && analyticsModal.style.display === 'flex') {
                    refreshAnalytics();
                }
            }, 300);
        });

        function loadPatientHistory(patientName) {
            closeModal('analyticsModal');
            const nameInput = document.getElementById('patientName');
            nameInput.value = patientName;
            // ★ 2026-09-25 修复：必须带 target（searchPatientsQuick 读 event.target.value）。
            //   旧写法只传 {key:'Enter'} → input 落 '' → 防抖后搜空串覆盖侧栏为"请输入患者姓名"。
            searchPatientsQuick({ target: nameInput, key: 'Enter' });
            showSideHistory();
        }

        async function exportStats() {
            // ★ 2026-09-21 免费版付费墙：统计报表导出（data-export；屏幕内统计查看仍免费）。
            //   仅离线端存在 requireFeature；云端网页无此函数自动跳过。
            if (typeof global.requireFeature === 'function') {
                if (!await global.requireFeature('data-export')) return;
            }
            const patients = analyzePatients();
            const diseases = analyzeDiseases();
            const medicines = analyzeMedicines();
            const trend = analyzeVisitTrend();
            
            const totalVisits = prescriptionHistory.length;
            const newPatients = patients.filter(p =>p.visitCount === 1).length;
            const returnPatients = patients.filter(p =>p.visitCount >1).length;
            const returnRate = totalVisits >0 ? ((returnPatients / patients.length) * 100) : 0;
            
            const range = document.getElementById('analyticsRange')?.value || 'month';
            const rangeText = { today: '今日', week: '本周', month: '本月', quarter: '本季度', year: '本年', all: '全部' };
            
            let csv = `统计范围,${rangeText[range] || '全部'}\n`;
            csv += `统计时间,${new Date().toLocaleString('zh-CN')}\n\n`;
            csv += `就诊总量,${totalVisits}\n`;
            csv += `初诊人数,${newPatients}\n`;
            csv += `复诊人数,${returnPatients}\n`;
            csv += `复诊率,${returnRate.toFixed(1)}%\n\n`;
            csv += `病种分布\n`;
            csv += `病种,次数\n`;
            diseases.slice(0, 10).forEach(d =>{
                csv += `"${d.name}",${d.count}\n`;
            });
            csv += `\n常用药材 Top 10\n`;
            csv += `药材名称,总用量(g)\n`;
            medicines.forEach(m =>{
                csv += `"${m.name}",${Math.round(m.totalDosage)}\n`;
            });
            
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.download = `统计报表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
            link.href = URL.createObjectURL(blob);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    // ------------------------------------------------------------------
    //  自安装：全局函数（HTML onchange/onclick 内联事件按全局作用域解析）
    // ------------------------------------------------------------------
    global.refreshAnalytics = refreshAnalytics;
    global.exportStats = exportStats;
    global.loadPatientHistory = loadPatientHistory;

    global.AnalyticsCore = {
        getFilteredPrescriptions: getFilteredPrescriptions,
        analyzePatients: analyzePatients,
        analyzeDiseases: analyzeDiseases,
        analyzeMedicines: analyzeMedicines,
        analyzeVisitTrend: analyzeVisitTrend,
        analyzeMonthlyStats: analyzeMonthlyStats,
        refreshAnalytics: refreshAnalytics,
        exportStats: exportStats,
        loadPatientHistory: loadPatientHistory,
        formatDate: formatDate,
        createChart: createChart
    };
})(typeof window !== 'undefined' ? window : this);
