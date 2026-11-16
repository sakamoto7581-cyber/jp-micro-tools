// @ts-check
// テスト共通ヘルパー：コンソールエラー収集・外部通信監視・キー入力・テスト用PNG生成
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const zlib = require('zlib');

const JSZIP_LOCAL = require.resolve('jszip/dist/jszip.min.js');
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/';
const LOCAL = 'http://127.0.0.1:4173';

const URLS = {
  noteSingle: 'https://note.com/iroiro_chisiki/n/nc0372617bcbc',
  noteMaster: 'https://note.com/iroiro_chisiki/n/n6d936e1ebc3b',
};

/* ---------- テスト用PNGを依存なしで生成 ---------- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const files = (n, prefix = 'item') => Array.from({ length: n }, (_, i) => ({
  name: `${prefix}${i + 1}.png`, mimeType: 'image/png', buffer: makePng(120 + i * 10, 80, [200, (40 + i * 30) % 256, 60]),
}));

/**
 * 共通フックを登録する。
 *  - コンソールエラー・例外ゼロ
 *  - 外部通信：allowCdn=true なら JSZip CDN のみ許可（ローカル同一ファイルで代替）、false なら CDN も含めてゼロ
 */
function registerHooks({ allowCdn }) {
  const ctx = { consoleErrors: [], externalRequests: [] };
  test.beforeEach(async ({ page }) => {
    ctx.consoleErrors = []; ctx.externalRequests = [];
    page.on('console', (m) => { if (m.type() === 'error') ctx.consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => ctx.consoleErrors.push(String(e)));
    // 外部への通信はすべて記録し、実際には外へ出さない
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) => {
      const u = route.request().url();
      if (allowCdn && u.startsWith(JSZIP_CDN)) {
        return route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(JSZIP_LOCAL, 'utf8') });
      }
      return route.abort();
    });
    page.on('request', (req) => {
      const u = req.url();
      if (!/^https?:/.test(u) || u.startsWith(LOCAL)) return;
      if (allowCdn && u.startsWith(JSZIP_CDN)) return;
      ctx.externalRequests.push(`${req.method()} ${u}`);
    });
  });
  test.afterEach(async () => {
    expect(ctx.consoleErrors, 'コンソールエラー・例外がゼロであること').toEqual([]);
    expect(ctx.externalRequests, allowCdn ? 'CDNライブラリ以外への外部通信がないこと' : 'CDNを含め外部通信がゼロであること').toEqual([]);
  });
  return ctx;
}

async function enterKey(page, key) {
  await page.getByTestId('open-license').click();
  await page.getByTestId('license-input').fill(key);
  await page.getByTestId('license-submit').click();
}

module.exports = { files, makePng, registerHooks, enterKey, URLS };
