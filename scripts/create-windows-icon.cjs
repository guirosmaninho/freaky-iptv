const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const pngPath = path.join(projectRoot, 'public', 'cat_icon.png');
const outputDirectory = path.join(projectRoot, 'build-resources');
const icoPath = path.join(outputDirectory, 'cat_icon.ico');
const png = fs.readFileSync(pngPath);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

if (!png.subarray(0, 8).equals(pngSignature)) {
  throw new Error(`Windows icon source is not a PNG: ${pngPath}`);
}

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== 256 || height !== 256) {
  throw new Error(`Windows icon source must be 256x256; received ${width}x${height}.`);
}

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6);
header.writeUInt8(0, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(icoPath, Buffer.concat([header, png]));
console.log(`Windows icon generated: ${icoPath}`);
