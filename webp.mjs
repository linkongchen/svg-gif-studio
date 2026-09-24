// Assemble browser-encoded still WebP frames into an animated WebP RIFF file.
const ascii = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const write16 = (bytes, offset, value) => { bytes[offset] = value & 255; bytes[offset + 1] = (value >>> 8) & 255; };
const write24 = (bytes, offset, value) => { bytes[offset] = value & 255; bytes[offset + 1] = (value >>> 8) & 255; bytes[offset + 2] = (value >>> 16) & 255; };
const write32 = (bytes, offset, value) => { bytes[offset] = value & 255; bytes[offset + 1] = (value >>> 8) & 255; bytes[offset + 2] = (value >>> 16) & 255; bytes[offset + 3] = (value >>> 24) & 255; };
const read32 = (bytes, offset) => (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;

function join(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function chunk(name, payload) {
  const output = new Uint8Array(8 + payload.length + (payload.length & 1));
  for (let i = 0; i < 4; i++) output[i] = name.charCodeAt(i);
  write32(output, 4, payload.length);
  output.set(payload, 8);
  return output;
}

function imageChunks(bytes) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') throw new Error('浏览器未返回有效的 WebP 图片');
  const chunks = [];
  let imageFound = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = ascii(bytes, offset, 4);
    const size = read32(bytes, offset + 4);
    const end = offset + 8 + size + (size & 1);
    if (end > bytes.length) throw new Error('WebP 图片数据不完整');
    if (name === 'ALPH' || name === 'VP8 ' || name === 'VP8L') {
      chunks.push(bytes.subarray(offset, end));
      if (name === 'VP8 ' || name === 'VP8L') imageFound = true;
    }
    offset = end;
  }
  if (!imageFound) throw new Error('WebP 图片缺少图像帧');
  return join(chunks);
}

export async function encodeAnimatedWebp(frames, delays, width, height, transparent, background) {
  if (frames.length !== delays.length || !frames.length) throw new Error('WebP 帧数据不完整');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const frameChunks = [];
  for (let i = 0; i < frames.length; i++) {
    image.data.set(frames[i]);
    context.putImageData(image, 0, 0);
    const still = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!still || still.type !== 'image/webp') throw new Error('当前浏览器不支持 WebP 编码');
    const header = new Uint8Array(16);
    write24(header, 6, width - 1);
    write24(header, 9, height - 1);
    write24(header, 12, delays[i]);
    header[15] = 2; // Replace the entire canvas; do not dispose the frame.
    frameChunks.push(chunk('ANMF', join([header, imageChunks(new Uint8Array(await still.arrayBuffer()))])));
  }

  const vp8x = new Uint8Array(10);
  vp8x[0] = 2 | (transparent ? 16 : 0);
  write24(vp8x, 4, width - 1);
  write24(vp8x, 7, height - 1);
  const anim = new Uint8Array(6);
  if (!transparent) {
    anim[0] = parseInt(background.slice(5, 7), 16);
    anim[1] = parseInt(background.slice(3, 5), 16);
    anim[2] = parseInt(background.slice(1, 3), 16);
    anim[3] = 255;
  }
  write16(anim, 4, 0); // Loop forever.
  const output = join([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), chunk('VP8X', vp8x), chunk('ANIM', anim), ...frameChunks]);
  write32(output, 4, output.length - 8);
  return new Blob([output], { type: 'image/webp' });
}
