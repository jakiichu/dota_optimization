import { deflateSync } from 'node:zlib';

/** Маленькая локальная иконка: линия времени кадра и красная отметка записи. */
export function desktopIcon(recording = false) {
  const size = 32;
  const pixels = Buffer.alloc(size * (1 + size * 4));
  const plot = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set([...rgb, 255], at);
  };
  for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) plot(x, y, [26, 47, 39]);
  const points = [
    [5, 16],
    [10, 16],
    [13, 8],
    [17, 24],
    [21, 16],
    [27, 16],
  ];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1],
      [x1, y1] = points[i];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(x0 + ((x1 - x0) * t) / steps),
        y = Math.round(y0 + ((y1 - y0) * t) / steps);
      plot(x, y, [176, 232, 208]);
      plot(x + 1, y, [176, 232, 208]);
    }
  }
  if (recording)
    for (let y = 1; y < 12; y++)
      for (let x = 21; x < 32; x++)
        if ((x - 26) ** 2 + (y - 6) ** 2 < 25) plot(x, y, [255, 95, 86]);
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const head = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, body, tail]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
