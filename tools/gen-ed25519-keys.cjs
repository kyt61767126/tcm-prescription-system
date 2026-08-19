// ============================================================================
//  gen-ed25519-keys.cjs — 生成 Ed25519 密钥对（P1-[5.1][5.3] 配套工具）
//
//  用途：
//    1. 生成 LICENSE_SIGN_ED25519_PRIVATE_KEY（私钥，PEM PKCS#8 格式，存 Cloudflare Secrets）
//    2. 生成 Node 端公钥（ED25519_VERIFY_PUBLIC_KEY_PEM，PEM SPKI，嵌入 license-manager.js）
//    3. 生成 Java 端公钥（ED25519_VERIFY_PUBLIC_KEY_HEX，原始 32 字节 hex，嵌入 LicenseManager.java）
//
//  使用方法：
//    cd d:\trae_projects\kyt-zy
//    node tools/gen-ed25519-keys.cjs
//
//  操作流程：
//    1. 运行此脚本生成密钥对
//    2. 复制私钥 PEM 内容到 Cloudflare Pages → Settings → Environment Variables
//       名称：LICENSE_SIGN_ED25519_PRIVATE_KEY
//       类型：Plaintext
//       内容：脚本输出的完整 -----BEGIN PRIVATE KEY----- 块
//    3. 复制 Node 公钥到 4 端 license-manager.js 的 ED25519_VERIFY_PUBLIC_KEY_PEM 常量
//    4. 复制 Java 公钥 hex 到 2 端 LicenseManager.java 的 ED25519_VERIFY_PUBLIC_KEY_HEX 常量
//    5. 重新打包 4 端 exe / 2 端 APK（如果客户端更新了公钥）
//
//  注意：
//    - 私钥泄露后所有 v7 license 失守，请勿提交到 git
//    - 重新生成密钥对会使所有现有 v7 签名失效，但 v6/v5 的 ECDSA 签名仍可用（向后兼容）
//    - 无需重新发激活码：客户端 v7 验不过会自动降级 v6/v5（fail-open 客户端无该公钥时）
// ============================================================================

const crypto = require('crypto');

// 取公钥 DER 的最后一个 32 字节（Ed25519 公钥即原始 32 字节，SPKI 前导为算法标识）
function extractRawPublicKeyHex(publicKeyPem) {
    const pk = crypto.createPublicKey(publicKeyPem);
    const der = pk.export({ type: 'spki', format: 'der' });
    // SPKI：30<len>30<len> 06<len>2b6570 03<len>00 04<len>20 <32 字节公钥>
    // 取最后 32 字节
    return der.subarray(der.length - 32).toString('hex');
}

async function main() {
    console.log('=========================================================');
    console.log(' 生成 Ed25519 密钥对（P1-[5.1][5.3] 配套工具）');
    console.log('=========================================================\n');

    // 生成 Ed25519 密钥对
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    const javaPubHex = extractRawPublicKeyHex(publicKey);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【1】私钥（LICENSE_SIGN_ED25519_PRIVATE_KEY，存 Cloudflare Secrets）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(privateKey);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【2】Node 公钥（ED25519_VERIFY_PUBLIC_KEY_PEM，嵌入 4 端 license-manager.js）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(publicKey);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【3】Java 公钥 hex（ED25519_VERIFY_PUBLIC_KEY_HEX，嵌入 2 端 LicenseManager.java）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(javaPubHex);

    // 测试签名/验签（用公钥对象）
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【4】测试签名/验签...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const testMsg = 'test user|personal|2026-07-21|2027-07-21|0|||clinic|machine|binding|1|nonce';
    const sign = crypto.sign(null, Buffer.from(testMsg, 'utf8'), privateKey);
    console.log('签名 hex(64字节):', sign.toString('hex'));
    const pubObj = crypto.createPublicKey(publicKey);
    const valid = crypto.verify(null, Buffer.from(testMsg, 'utf8'), pubObj, sign);
    console.log('验签结果:', valid ? '✅ 通过' : '❌ 失败');
    // Java hex = 原始 32 字节公钥，Node 不支持 raw 直接验签；由客户端（Java 纯实现）持有验证。
    // 这里用 SPKI DER（raw 包算法标识头）做等价佐证：hex 与 PEM 是同一公钥。
    const raw = Buffer.from(javaPubHex, 'hex');
    const spkiDer = Buffer.concat([
        Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
        raw
    ]);
    const pubRawObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    const validRaw = crypto.verify(null, Buffer.from(testMsg, 'utf8'), pubRawObj, sign);
    console.log('Java hex 公钥验签结果:', validRaw ? '✅ 通过' : '❌ 失败');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【5】下一步操作：');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1) Cloudflare Pages → 你的项目 → Settings → Environment Variables');
    console.log('   - 名称: LICENSE_SIGN_ED25519_PRIVATE_KEY');
    console.log('   - 类型: Plaintext');
    console.log('   - 内容: 上面【1】的完整私钥（含 BEGIN/END）');
    console.log('   - 勾选: Production 和 Preview 都加');
    console.log('2) 把上面【2】的公钥 PEM 填入 4 端 license-manager.js 的');
    console.log('   ED25519_VERIFY_PUBLIC_KEY_PEM 常量（注意保持模板字符串格式）');
    console.log('3) 把上面【3】的 hex 填入 2 端 LicenseManager.java 的');
    console.log('   ED25519_VERIFY_PUBLIC_KEY_HEX 常量');
    console.log('4) 重新打包 4 端 exe / 2 端 APK 让客户端支持 v7 验签');
    console.log('');
}

main().catch(e => {
    console.error('生成密钥对失败:', e);
    process.exit(1);
});