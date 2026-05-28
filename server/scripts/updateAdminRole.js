require('dotenv').config();
const kv = require('../utils/cloudflareKV');

async function updateAdminRole() {
    try {
        const user = await kv.get('user_admin');
        if (!user) {
            console.log('admin 用户不存在');
            process.exit(1);
        }
        
        console.log('当前 admin 用户:', { username: user.username, role: user.role });
        
        user.role = 'admin';
        await kv.put('user_admin', user);
        
        console.log('✅ admin 用户角色已更新为 admin');
        process.exit(0);
    } catch (error) {
        console.error('更新失败:', error);
        process.exit(1);
    }
}

updateAdminRole();