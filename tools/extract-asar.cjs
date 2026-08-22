// 临时脚本：手工解析 asar 提取指定文件（无 asar 模块依赖）
const fs = require('fs');
const path = require('path');

function parseAsar(asarPath, targetPath) {
    const buf = fs.readFileSync(asarPath);
    const jsonSize = buf.readUInt32LE(4);     // header json size (pickle payload first u32)
    const headerJson = buf.slice(8, 8 + jsonSize).toString('utf8');
    const header = JSON.parse(headerJson);
    const base = 8 + jsonSize;                // file data base offset

    function find(node, parts) {
        if (!parts.length) return node;
        const [head, ...rest] = parts;
        const child = node.files && node.files[head];
        if (!child) return null;
        return find(child, rest);
    }

    const parts = targetPath.split('/').filter(Boolean);
    const node = find(header, parts);
    if (!node || typeof node.size === 'undefined') return null;
    const offset = parseInt(node.offset, 10);
    const size = node.size;
    return buf.slice(base + offset, base + offset + size).toString('utf8');
}

const [asarPath, targetPath, outPath] = process.argv.slice(2);
const content = parseAsar(asarPath, targetPath);
if (content === null) {
    console.error('NOT FOUND: ' + targetPath + ' in ' + asarPath);
    process.exit(1);
}
if (outPath) {
    fs.writeFileSync(outPath, content, 'utf8');
    console.log('EXTRACTED ' + content.length + ' bytes -> ' + outPath);
} else {
    console.log(content);
}
