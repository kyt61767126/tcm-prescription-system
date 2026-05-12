const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '../../中药库_2026-5-6.csv');
const outputPath = path.join(__dirname, '../中药库数据.json');

const content = fs.readFileSync(csvPath, 'utf8');
const lines = content.split('\n').filter(line => line.trim());

const headers = lines[0].split(',');
const medicines = [];

for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const medicine = {};
    
    headers.forEach((header, index) => {
        medicine[header.trim()] = values[index] ? values[index].trim() : '';
    });
    
    medicines.push({
        name: medicine['药品名称'] || '',
        code: (medicine['简码'] || '').toUpperCase(),
        price: parseFloat(medicine['单价']) || 0,
        unit: medicine['单位'] || 'g',
        dosage: !isNaN(parseFloat(medicine['常用用量'])) ? parseFloat(medicine['常用用量']) : 10,
        category: '',
        costPrice: parseFloat(medicine['进价']) || 0,
        stock: parseInt(medicine['库存']) || 0
    });
}

const outputData = {
    medicines: medicines,
    exportDate: new Date().toISOString().split('T')[0],
    description: `${medicines.length}味中药库数据`
};

fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');

console.log(`成功转换 ${medicines.length} 种药品`);
console.log(`输出文件: ${outputPath}`);