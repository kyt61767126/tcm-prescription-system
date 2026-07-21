// ============================================================================
//  gen-ecdsa-keys.cjs — 生成 ECDSA P-256 密钥对（任务2 配套工具）
//
//  用途：
//    1. 生成 LICENSE_SIGN_PRIVATE_KEY（私钥，PEM PKCS#8 格式，存 Cloudflare Secrets）
//    2. 生成 LICENSE_VERIFY_PUBLIC_KEY（公钥，PEM SPKI 格式，嵌入客户端）
//
//  使用方法：
//    cd c:\Users\61767\Documents\trae_projects\kyt-zy
//    node tools/gen-ecdsa-keys.cjs
//
//  操作流程：
//    1. 运行此脚本生成密钥对
//    2. 复制私钥 PEM 内容到 Cloudflare Pages → Settings → Environment Variables
//       名称：LICENSE_SIGN_PRIVATE_KEY
//       类型：Plaintext
//       内容：脚本输出的完整 -----BEGIN PRIVATE KEY----- 块
//    3. 复制公钥 PEM 内容到 4 端 license-manager.js 的 ECDSA_VERIFY_PUBLIC_KEY_PEM 常量
//    4. 重新打包 4 端 exe（如果客户端更新了公钥）
//
//  注意：
//    - 私钥泄露后所有 license 失守，请勿提交到 git
//    - 重新生成密钥对会使所有现有 v5 签名失效，但 v4 HMAC 签名仍可用（向后兼容）
// ============================================================================

const crypto = require('crypto');

async function main() {
    console.log('========================================================');
    console.log(' 生成 ECDSA P-256 密钥对（任务2 配套工具）');
    console.log('========================================================\n');

    // 生成 ECDSA P-256 密钥对
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【1】私钥（LICENSE_SIGN_PRIVATE_KEY，存 Cloudflare Secrets）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(privateKey);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【2】公钥（ECDSA_VERIFY_PUBLIC_KEY_PEM，嵌入 4 端 license-manager.js）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(publicKey);

    // 测试签名/验签
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【3】测试签名/验签...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const testMsg = 'test user|personal|2026-07-21|2027-07-21|0|';
    const sign = crypto.createSign('SHA256');
    sign.update(testMsg);
    sign.end();
    const signature = sign.sign(privateKey);
    console.log('签名 hex:', signature.toString('hex'));

    const verify = crypto.createVerify('SHA256');
    verify.update(testMsg);
    verify.end();
    const valid = verify.verify(publicKey, signature);
    console.log('验签结果:', valid ? '✅ 通过' : '❌ 失败');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【4】下一步操作：');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1) Cloudflare Pages → 你的项目 → Settings → Environment Variables');
    console.log('   - 名称: LICENSE_SIGN_PRIVATE_KEY');
    console.log('   - 类型: Plaintext');
    console.log('   - 内容: 上面【1】的完整私钥（含 BEGIN/END）');
    console.log('   - 勾选: Production 和 Preview 都加');
    console.log('2) 把上面【2】的公钥 PEM 内容填入 4 端 license-manager.js 的');
    console.log('   ECDSA_VERIFY_PUBLIC_KEY_PEM 常量（注意保持模板字符串格式）');
    console.log('3) 重新打包 4 端 exe 让客户端支持 v5 验签');
    console.log('');
}

main().catch(e => {
    console.error('生成密钥对失败:', e);
    process.exit(1);
});
