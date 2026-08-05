// ============================================================================
// print-utils.js — 打印工具模块
// 提供处方打印模板生成、A4适配、Excel导出等公共方法
// ============================================================================
(function (global) {
    'use strict';

    const PrintUtils = {
        // 打印页面尺寸常量
        PAGE_SIZES: {
            A4: { width: '210mm', height: '297mm', margin: '10mm' },
            A5_PORTRAIT: { width: '148mm', height: '210mm', margin: '0' },
            A5_LANDSCAPE: { width: '210mm', height: '148mm', margin: '0' }
        },

        // 生成处方打印HTML
        generatePrescriptionPrintHTML(content, orientation) {
            const isLandscape = orientation === 'landscape';
            const pageSize = isLandscape ? 'A5 landscape' : 'A5 portrait';
            const paperWidth = isLandscape ? '210mm' : '148mm';
            const paperHeight = isLandscape ? '148mm' : '210mm';

            return `<!DOCTYPE html><html><head><title>打印处方</title><style>
@page { size: ${pageSize}; margin: 0; }
body { font-family: 'SimSun', '宋体', serif; padding: 0; margin: 0; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; line-height: 1.8; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; }
.prescription-paper { width: ${paperWidth}; height: ${paperHeight}; padding: 20mm 15mm; margin: 0 auto; box-sizing: border-box; }
.clinic-name { text-align: center; font-size: 22px; font-weight: bold; color: #000; margin-bottom: 10px; letter-spacing: 2px; font-family: 'KaiTi', '楷体_GB2312', '楷体', serif; }
.prescription-title { text-align: center; font-size: 22px; font-weight: bold; color: #000; margin-bottom: 12px; letter-spacing: 4px; font-family: 'KaiTi', '楷体_GB2312', '楷体', serif; }
.prescription-info { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px 2px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 4px; font-size: 14px; color: #000; }
.prescription-info > div { white-space: nowrap; text-align: center; min-width: 0; }
.prescription-info > div:nth-child(1) { grid-column: 1 / 3; }
.prescription-info > div:nth-child(2) { grid-column: 3 / 5; }
.prescription-info > div:nth-child(3) { grid-column: 5 / 7; }
.prescription-info > div:nth-child(4) { grid-column: 1 / 4; }
.prescription-info > div:nth-child(5) { grid-column: 4 / 7; }
.prescription-grid { border-top: 1px solid #000; border-bottom: 1px solid #000; min-height: 200px; margin-top: 8px; }
.prescription-grid-inner { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 2px; }
.prescription-line { padding: 5px 0; font-size: 15px; text-align: center; font-weight: 500; color: #000; }
.rp-mark { font-size: 22px; font-weight: bold; font-style: italic; color: #000; font-family: 'Times New Roman', serif; }
.dose-count { text-align: right; font-size: 15px; color: #000; font-weight: bold; font-family: 'Times New Roman', serif; }
.prescription-footer { margin-top: 8px; padding-top: 4px; border-top: none; font-size: 14px; color: #000; }
.usage-text { margin-bottom: 6px; font-size: 14px; color: #000; font-weight: bold; white-space: nowrap; border: none; text-decoration: none; }
.signature-row { display: flex; justify-content: space-between; font-size: 14px; color: #000; }
.signature-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 10px; margin-top: 8px; }
.signature-item { font-size: 14px; color: #000; padding: 2px 0; }
</style></head><body><div class="prescription-paper">${content}</div></body></html>`;
        },

        // 打印处方
        printPrescription(orientation) {
            orientation = orientation || 'portrait';
            const printContent = document.getElementById('prescriptionPaper').innerHTML;
            const html = this.generatePrescriptionPrintHTML(printContent, orientation);

            // 安卓原生打印
            if (global.AndroidNative) {
                if (global.AndroidNative.printHtml) {
                    // 离线APP：直接调用 printHtml
                    global.AndroidNative.printHtml(html);
                    return;
                } else if (global.AndroidNative.invoke) {
                    // 云端APP：通过 invoke 调用 printPrescription
                    try {
                        global.AndroidNative.invoke('printPrescription', JSON.stringify({
                            html: html,
                            orientation: orientation
                        }));
                        return;
                    } catch(e) {
                        console.error('AndroidNative打印失败:', e);
                    }
                }
            }

            // Electron桌面端：通过IPC调用打印
            if (global.electronAPI && global.electronAPI.printPrescription) {
                global.electronAPI.printPrescription(html, orientation);
                return;
            }

            // 网页端：iframe打印
            let printFrame = document.getElementById('printFrame');
            if (!printFrame) {
                printFrame = document.createElement('iframe');
                printFrame.id = 'printFrame';
                printFrame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
                document.body.appendChild(printFrame);
            }
            const doc = printFrame.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
        },

        // 生成药材清单打印HTML
        generateMedicineListHTML(medicines, clinicName) {
            const rows = medicines.map((m, i) =>
                `<tr><td>${i + 1}</td><td>${m.name || ''}</td><td>${m.code || ''}</td><td>${m.unit || ''}</td><td>${m.price || ''}</td></tr>`
            ).join('');
            return `<!DOCTYPE html><html><head><title>药材清单</title><style>
@page { size: A4; margin: 10mm; }
body { font-family: SimSun, serif; }
h2 { text-align: center; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #000; padding: 4px 8px; font-size: 12px; text-align: center; }
th { background: #f0f0f0; }
</style></head><body>
<h2>${clinicName || ''} — 药材清单</h2>
<table><thead><tr><th>#</th><th>药名</th><th>简码</th><th>单位</th><th>单价</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
        },

        // 导出CSV
        exportCSV(filename, rows) {
            const csv = rows.map(row =>
                row.map(cell => {
                    const val = String(cell || '');
                    return val.includes(',') || val.includes('"') ? '"' + val.replace(/"/g, '""') + '"' : val;
                }).join(',')
            ).join('\n');
            const bom = '\uFEFF';
            const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
            this.downloadBlob(blob, filename);
        },

        // 下载Blob
        downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    global.PrintUtils = PrintUtils;

})(typeof window !== 'undefined' ? window : this);
