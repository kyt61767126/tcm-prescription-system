// ============================================================================
// 平台总管理员 — 全平台处方监管 API
// ============================================================================
// 端点契约：
//   GET /api/platform-prescriptions
//     仅 platform_admin 可访问
//     参数：
//       ?clinic=clinicId        按诊所筛选
//       ?doctor=username        按医师筛选
//       ?patient=姓名           按患者姓名筛选
//       ?medicine=药材名        按药材筛选
//       ?startDate=YYYY-MM-DD   日期范围起
//       ?endDate=YYYY-MM-DD     日期范围止
//       ?keyword=关键词         综合关键词（患者/诊断/药材）
//     返回：
//       { success, data: [...], stats: {...}, clinics: [...] }
// ============================================================================
import {
    ROLE, clinicKey, parseAuthHeader,
    corsResponse, handleOptions, getKV,
    getBeijingTime, formatBeijingDateYYMMDD
} from '../_lib/auth.js';

// 处方脱敏：移除内部字段，附加诊所名称
function decoratePrescription(p, clinicName, clinicId) {
    return {
        id: p.id,
        cloudSeq: p.cloudSeq || p.prescriptionNo || '',
        patientName: p.patientName || p.name || '',
        gender: p.gender || '',
        age: p.age || '',
        diagnosis: p.diagnosis || '',
        doctorName: p.doctorName || p.createdBy || '',
        createdBy: p.createdBy || '',
        date: p.date || p.createdAt || '',
        medicines: p.medicines || [],
        medicineText: p.medicineText || '',
        dosage: p.dosage || '',
        usage: p.usage || '',
        fee: p.fee || p.totalFee || '',
        clinicName: clinicName,
        clinicId: clinicId,
        raw: p
    };
}

// 检查处方是否包含指定药材
function containsMedicine(p, medicineName) {
    if (!medicineName) return true;
    if (Array.isArray(p.medicines)) {
        return p.medicines.some(m =>
            (m.name || '').includes(medicineName) ||
            (m.pinyin || '').includes(medicineName.toLowerCase())
        );
    }
    if (p.medicineText) return p.medicineText.includes(medicineName);
    return false;
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return handleOptions();

    try {
        const kv = getKV(env);
        if (!kv) {
            return corsResponse({ success: false, error: 'KV存储未配置' }, { status: 500 });
        }

        const currentUser = parseAuthHeader(request);
        // 仅平台总管理员可访问
        if (!currentUser || !currentUser.isPlatformAdmin) {
            return corsResponse({ success: false, error: '仅平台总管理员可访问' }, { status: 403 });
        }

        // 读取所有诊所列表
        const clinicsRaw = await kv.get('system:clinics', 'json');
        const clinics = Array.isArray(clinicsRaw) ? clinicsRaw : [];
        const clinicMap = {};
        for (const c of clinics) {
            clinicMap[c.id] = c;
        }

        // 读取筛选参数
        const filterClinic = url.searchParams.get('clinic') || '';
        const filterDoctor = url.searchParams.get('doctor') || '';
        const filterPatient = url.searchParams.get('patient') || '';
        const filterMedicine = url.searchParams.get('medicine') || '';
        const filterStartDate = url.searchParams.get('startDate') || '';
        const filterEndDate = url.searchParams.get('endDate') || '';
        const filterKeyword = url.searchParams.get('keyword') || '';

        // 遍历所有诊所，收集处方
        const allPrescriptions = [];
        const targetClinics = filterClinic
            ? clinics.filter(c => c.id === filterClinic)
            : clinics;

        for (const clinic of targetClinics) {
            try {
                const key = clinicKey(clinic.id, 'prescriptions');
                let prescriptions = await kv.get(key, 'json');
                if (!prescriptions || !Array.isArray(prescriptions)) continue;

                for (const p of prescriptions) {
                    // 跳过已删除的处方
                    if (p.deleted) continue;

                    const decorated = decoratePrescription(p, clinic.name, clinic.id);

                    // 筛选：医师
                    if (filterDoctor) {
                        const dName = (decorated.doctorName || '').toLowerCase();
                        const dBy = (decorated.createdBy || '').toLowerCase();
                        if (!dName.includes(filterDoctor.toLowerCase()) && !dBy.includes(filterDoctor.toLowerCase())) continue;
                    }

                    // 筛选：患者姓名
                    if (filterPatient) {
                        if (!(decorated.patientName || '').includes(filterPatient)) continue;
                    }

                    // 筛选：药材
                    if (filterMedicine) {
                        if (!containsMedicine(decorated, filterMedicine)) continue;
                    }

                    // 筛选：日期范围
                    if (filterStartDate || filterEndDate) {
                        const pDate = (decorated.date || '').slice(0, 10);
                        if (filterStartDate && pDate < filterStartDate) continue;
                        if (filterEndDate && pDate > filterEndDate) continue;
                    }

                    // 筛选：综合关键词
                    if (filterKeyword) {
                        const kw = filterKeyword.toLowerCase();
                        const haystack = [
                            decorated.patientName, decorated.diagnosis,
                            decorated.doctorName, decorated.clinicName,
                            decorated.medicineText,
                            JSON.stringify(decorated.medicines || [])
                        ].join(' ').toLowerCase();
                        if (!haystack.includes(kw)) continue;
                    }

                    allPrescriptions.push(decorated);
                }
            } catch (e) {
                console.error(`读取诊所 ${clinic.id} 处方失败:`, e);
            }
        }

        // 按日期倒序
        allPrescriptions.sort((a, b) => {
            const tA = new Date(a.date || a.id || 0).getTime();
            const tB = new Date(b.date || b.id || 0).getTime();
            return tB - tA;
        });

        // 生成统计数据
        const now = getBeijingTime();
        const todayStr = now.toISOString().slice(0, 10);
        const monthStr = todayStr.slice(0, 7);
        const clinicStats = {};
        const doctorStats = {};
        let todayCount = 0, monthCount = 0;

        for (const p of allPrescriptions) {
            const pDate = (p.date || '').slice(0, 10);
            const clinicKey2 = p.clinicName || '未知诊所';
            const doctorKey = p.doctorName || p.createdBy || '未知';

            if (!clinicStats[clinicKey2]) clinicStats[clinicKey2] = { count: 0, todayCount: 0, monthCount: 0 };
            clinicStats[clinicKey2].count++;

            if (!doctorStats[doctorKey]) doctorStats[doctorKey] = { count: 0, clinic: p.clinicName || '' };
            doctorStats[doctorKey].count++;

            if (pDate === todayStr) { todayCount++; clinicStats[clinicKey2].todayCount++; }
            if (pDate.startsWith(monthStr)) { monthCount++; clinicStats[clinicKey2].monthCount++; }
        }

        // 限制返回数量（防止数据量过大）
        const MAX_RETURN = 2000;
        const truncated = allPrescriptions.length > MAX_RETURN;
        const returnedData = truncated ? allPrescriptions.slice(0, MAX_RETURN) : allPrescriptions;

        return corsResponse({
            success: true,
            data: returnedData,
            totalCount: allPrescriptions.length,
            truncated: truncated,
            stats: {
                total: allPrescriptions.length,
                todayCount,
                monthCount,
                clinicCount: clinics.length,
                doctorCount: Object.keys(doctorStats).length,
                clinicStats: Object.entries(clinicStats)
                    .map(([name, s]) => ({ name, ...s }))
                    .sort((a, b) => b.count - a.count),
                doctorStats: Object.entries(doctorStats)
                    .map(([name, s]) => ({ name, ...s }))
                    .sort((a, b) => b.count - a.count)
            },
            clinics: clinics.map(c => ({ id: c.id, name: c.name }))
        });

    } catch (e) {
        console.error('平台处方监管 API 异常:', e);
        return corsResponse({ success: false, error: '服务器异常: ' + e.message }, { status: 500 });
    }
}
