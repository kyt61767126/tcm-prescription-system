const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');

const output = fs.createWriteStream('tcm-prescription.zip');
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`打包完成! ${archive.pointer()} bytes`);
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.log('警告:', err);
  } else {
    throw err;
  }
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory('out/', false);
archive.finalize();