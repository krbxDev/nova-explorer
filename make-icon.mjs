/**
 * Generates a 1024×1024 KRB Explorer icon then uses `cargo tauri icon` to
 * produce all required sizes (ico, icns, pngs).
 *
 * Design: dark rounded-rect background (#0d0d0f) with a folder shape in
 * indigo (#6366f1) and bold white "KRB" text centred on it.
 */
import sharp from "sharp";
import { writeFileSync } from "fs";

const SIZE = 1024;

// Build an SVG at SIZE × SIZE
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0d0d0f"/>
    </linearGradient>
    <linearGradient id="folder" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" rx="180" ry="180" fill="url(#bg)"/>

  <!-- Folder body -->
  <rect x="160" y="340" width="704" height="460" rx="60" ry="60" fill="url(#folder)" opacity="0.95"/>

  <!-- Folder tab -->
  <path d="M160 340 Q160 280 220 280 L420 280 Q460 280 480 320 L520 340 Z" fill="#6366f1"/>

  <!-- "KRB" text -->
  <text
    x="512" y="610"
    font-family="'Segoe UI', 'Arial Black', Arial, sans-serif"
    font-size="220"
    font-weight="900"
    fill="#ffffff"
    text-anchor="middle"
    dominant-baseline="middle"
    letter-spacing="-8"
  >KRB</text>
</svg>`;

const pngBuf = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync("icon-source.png", pngBuf);
console.log("icon-source.png written");
