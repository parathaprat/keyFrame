const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const r = size * 0.18; // corner radius

  // Rounded dark background
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.arcTo(size, 0, size, r, r);
  ctx.lineTo(size, size - r);
  ctx.arcTo(size, size, size - r, size, r);
  ctx.lineTo(r, size);
  ctx.arcTo(0, size, 0, size - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#0f0f0f';
  ctx.fill();

  // Bold white "K" centered
  const fontSize = size * 0.58;
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('K', size * 0.5, size * 0.51);

  // Blue dot accent — bottom-right corner
  const dotR = size * 0.1;
  const dotX = size * 0.76;
  const dotY = size * 0.76;
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = '#065fd4';
  ctx.fill();

  return canvas.toBuffer('image/png');
}

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'icons');

for (const size of sizes) {
  const buf = drawIcon(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`Written ${file}`);
}
