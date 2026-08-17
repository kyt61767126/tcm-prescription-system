// 验证 tools（P0-NDK）：将 src/main/cpp/securityguard.cpp 的 SHA-256 实现
// 逐行等价翻译为 JS，与 node:crypto 对比，覆盖各边界长度。
// 运行：node verify-sha256.mjs   （无需引入任何 @烹调 依赖）
import crypto from 'node:crypto';

// ---- 与 C++ 逐行等价的 SHA-256 ----
const K = Uint32Array.from([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,
  0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
  0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,
  0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,
  0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
  0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,
  0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,
  0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
  0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotr32 = (x, n) => (x >>> n) | (x << (32 - n));

function sha256_bytes(data) {
  const state = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
  ]);
  let totalBits = BigInt(0);
  let buffer = new Uint8Array(64);
  let bufferLen = 0;

  const transform = (block) => {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; ++i) {
      w[i] = (block[i*4]<<24) | (block[i*4+1]<<16) | (block[i*4+2]<<8) | block[i*4+3];
    }
    for (let i = 16; i < 64; ++i) {
      const s0 = rotr32(w[i-15],7) ^ rotr32(w[i-15],18) ^ (w[i-15]>>>3);
      const s1 = rotr32(w[i-2],17) ^ rotr32(w[i-2],19) ^ (w[i-2]>>>10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let a=state[0],b=state[1],c=state[2],d=state[3];
    let e=state[4],f=state[5],g=state[6],h=state[7];
    for (let i = 0; i < 64; ++i) {
      const S1 = rotr32(e,6)^rotr32(e,11)^rotr32(e,25);
      const ch = (e&f)^(~e&g);
      let t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr32(a,2)^rotr32(a,13)^rotr32(a,22);
      const maj = (a&b)^(a&c)^(b&c);
      const t2 = (S0+maj)>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    state[0]=(state[0]+a)>>>0;state[1]=(state[1]+b)>>>0;
    state[2]=(state[2]+c)>>>0;state[3]=(state[3]+d)>>>0;
    state[4]=(state[4]+e)>>>0;state[5]=(state[5]+f)>>>0;
    state[6]=(state[6]+g)>>>0;state[7]=(state[7]+h)>>>0;
  };

  const update = (chunk) => {
    totalBits += BigInt(chunk.length) * 8n;
    let p = 0;
    while (p < chunk.length) {
      let copy = 64 - bufferLen;
      if (copy > chunk.length - p) copy = chunk.length - p;
      buffer.set(chunk.subarray(p, p+copy), bufferLen);
      bufferLen += copy;
      p += copy;
      if (bufferLen === 64) { transform(buffer); bufferLen = 0; }
    }
  };

  update(data);

  // finish
  const bitLen = totalBits;
  buffer.fill(0, bufferLen);
  buffer[bufferLen] = 0x80;
  if (bufferLen >= 56) { transform(buffer); buffer.fill(0); }
  for (let i = 0; i < 8; ++i) buffer[56+i] = Number((bitLen >> BigInt(56 - i*8)) & 0xffn);
  transform(buffer);

  const out = new Uint8Array(32);
  for (let i = 0; i < 32; ++i) out[i] = (state[i>>2] >> (24-(i&3)*8)) & 0xff;
  return out;
}

// ---- ground truth ----
function refHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function mineHex(bytes) { return Buffer.from(sha256_bytes(Uint8Array.from(bytes))).toString('hex'); }

// ---- 测试向量 ----
const cases = [];
const known = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['a'.repeat(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
  ['a'.repeat(64), 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
];
for (const [input, expect] of known) {
  cases.push({ name: `known:${input.length}`, input: Buffer.from(input), expect });
}
// 边界长度 0,1,2,55,56,57,63,64,65,111,112,113,127,128,129,1000
for (const n of [0,1,2,55,56,57,63,64,65,111,112,113,127,128,129,255,1000]) {
  const input = Buffer.from(Array.from({length:n}, (_,i)=> (i*7+13)&0xff));
  cases.push({ name: `len:${n}`, input, expect: refHex(input) });
}

let pass = 0, fail = 0;
for (const c of cases) {
  const mine = mineHex(c.input);
  const ok = mine === c.expect;
  if (ok) pass++; else { fail++; console.log(`FAIL ${c.name}\n  mine=${mine}\n  ref =${c.expect}`); }
}
console.log(`SHA-256 等价验证: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
console.log('ALL OK');