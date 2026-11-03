// ============================================================================
//  manifest.js — 题库注册表（多题库扩展的唯一登记点）
//
//  新增题库步骤：
//    1) 把数据文件放入 public/quiz/data/<bank-id>.js（纯 ASCII 文件名）
//    2) 在本数组追加一条登记项（id/name/category/count/file/global/version/sha256）
//    3) 跑 `node tools/check-quiz-data.cjs` 校验
//  渲染代码（quiz-core.js）只读本清单，不含任何题库名称或文件名常量。
//
//  字段约定：
//    id      全局唯一题库标识（小写 ASCII，hyphen 分隔），永不复用
//    count   题目总数（必须与数据文件 questions.length 一致）
//    file    相对 quiz-core.js 所在目录的数据文件路径，带 ?v=<version> 便于缓存失效
//    global  数据文件挂到 window 上的变量名（QUIZ_BANK_<ID>）
//    sha256  数据文件完整 SHA-256（check-quiz-data.cjs 强校验）
//    enabled 是否对用户可见（false=灰度下架，不删文件）
//    order   列表排序（升序）
//
//  ★ 授权：题库不挂 license-manager features 授权位（P4 明确）。存量激活码不含新位，
//    按授权位拦截会误伤老客户；离线端无法补授权。入口显隐只按角色，见 quiz-core.js 头注。
//
//  ★ id 稳定性：题目 id = `<bankId>:<4 位题号>`，修订题库时保持题号不变；确需改题号时
//    旧 id 会在客户端下次加载时被静默清理（见 quiz-core.js migrateBankRecords）。
// ============================================================================
window.QUIZ_MANIFEST = [
    {
        id: 'sb-1200',
        name: '伤寒求真',
        category: '伤寒',
        count: 1200,
        file: 'data/sb-1200.js?v=1.0.0',
        global: 'QUIZ_BANK_SB_1200',
        version: '1.0.0',
        sha256: '71f997c8d55ede236f6715b93a0d3eaa010ec3887460ec5c032d8243913bcff5',
        enabled: true,
        order: 1
    },
    // 本能论正式库（2026-11-02 校审通过后启用；数据/哈希见 tools/check-quiz-data.cjs）
    {
        id: 'by-426',
        name: '本能论',
        category: '本能论',
        count: 426,
        file: 'data/by-426.js?v=1.0.1',
        global: 'QUIZ_BANK_BY426',
        version: '1.0.1',
        sha256: '0e28b97b9c7fdbff3d13c17a7caf042249590acc24fd0f2380c59e4273c5dab9',
        enabled: true,
        order: 90
    },
    // 说白伤寒论正式库（2026-11-03 由 docx 转录稿全量挖掘，剔除复核可疑题后定稿 65）
    // 题型：定义/方剂/判断/短答；引文均为完整句，答案 ≤20 字且落在词边界
    {
        id: 'sb-shanghan-65',
        name: '说白伤寒论·全量65',
        category: '伤寒',
        count: 65,
        file: 'data/sb-shanghan-65.js?v=1.0.0',
        global: 'QUIZ_BANK_SB_SHANGHAN_65',
        version: '1.0.0',
        sha256: '1eea5ec985f30005ff6bbd11bd7fb291f5149b0e770586372b199d8057d8fde3',
        enabled: true,
        order: 92
    }
];
