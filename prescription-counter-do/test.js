/**
 * 处方号计数器测试脚本
 * 使用方法: node test.js
 */

const API_URL = 'https://prescription-counter-do.your-account.workers.dev';

async function testGetNextPrescriptionNo() {
  console.log('\n=== 测试获取下一个处方号 ===');

  try {
    const response = await fetch(`${API_URL}/next-prescription-no`);
    const data = await response.json();

    console.log('状态:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('✅ 成功获取处方号:', data.prescriptionNo);
    } else {
      console.log('❌ 获取失败:', data.error);
    }

    return data;
  } catch (error) {
    console.error('❌ 请求失败:', error.message);
    throw error;
  }
}

async function testGetCurrentPrescriptionNo() {
  console.log('\n=== 测试获取当前处方号（不递增） ===');

  try {
    const response = await fetch(`${API_URL}/current-prescription-no`);
    const data = await response.json();

    console.log('状态:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('✅ 成功获取当前处方号:', data.prescriptionNo);
    } else {
      console.log('❌ 获取失败:', data.error);
    }

    return data;
  } catch (error) {
    console.error('❌ 请求失败:', error.message);
    throw error;
  }
}

async function testResetCounter() {
  console.log('\n=== 测试重置计数器 ===');

  try {
    const response = await fetch(`${API_URL}/reset`);
    const data = await response.json();

    console.log('状态:', response.status);
    console.log('响应:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('✅ 计数器已重置');
    } else {
      console.log('❌ 重置失败:', data.error);
    }

    return data;
  } catch (error) {
    console.error('❌ 请求失败:', error.message);
    throw error;
  }
}

async function testContinuousCalls() {
  console.log('\n=== 测试连续调用 ===');

  const results = [];
  const count = 5;

  for (let i = 0; i < count; i++) {
    try {
      const response = await fetch(`${API_URL}/next-prescription-no`);
      const data = await response.json();
      results.push(data.prescriptionNo);
      console.log(`第 ${i + 1} 次调用: ${data.prescriptionNo}`);
    } catch (error) {
      console.error(`第 ${i + 1} 次调用失败:`, error.message);
    }
  }

  // 检查是否连续
  if (results.length === count) {
    let isContinuous = true;
    for (let i = 1; i < results.length; i++) {
      const prev = parseInt(results[i - 1].slice(-4));
      const curr = parseInt(results[i].slice(-4));
      if (curr !== prev + 1) {
        isContinuous = false;
        break;
      }
    }

    if (isContinuous) {
      console.log('✅ 连续性测试通过！');
    } else {
      console.log('❌ 连续性测试失败！');
    }
  }

  return results;
}

async function runTests() {
  console.log('🧪 开始测试处方号计数器...');
  console.log('API 地址:', API_URL);

  try {
    await testGetCurrentPrescriptionNo();
    await testGetNextPrescriptionNo();
    await testGetNextPrescriptionNo();
    await testGetNextPrescriptionNo();
    await testContinuousCalls();

    console.log('\n=== 所有测试完成 ===');
  } catch (error) {
    console.error('\n❌ 测试过程中出现错误:', error);
    console.log('\n请检查：');
    console.log('1. 是否已部署到 Cloudflare');
    console.log('2. API 地址是否正确');
    console.log('3. 网络连接是否正常');
  }
}

// 运行测试
runTests();
