// @ts-check
// 公開前テスト（CLAUDE.md「公開前テスト（必須）」準拠）
//   cd tests && npm install && npx playwright install chromium && npx playwright test
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');

const PORTAL = '/index.html';
const TOOL = '/tools/ec-image-batch/index.html';
const JSZIP_LOCAL = require.resolve('jszip/dist/jszip.min.js');

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
const files = (n) => Array.from({ length: n }, (_, i) => ({
  name: `item${i + 1}.png`, mimeType: 'image/png', buffer: makePng(120 + i * 10, 80, [200, 40 + i * 30, 60]),
}));

/* ---------- 共通フック：コンソールエラー収集・外部送信監視 ---------- */
let consoleErrors, externalRequests;
test.beforeEach(async ({ page }) => {
  consoleErrors = []; externalRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  // JSZip（CDN）はローカルの同一ファイルで代替（オフラインでもテスト可能に）
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/jszip/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(JSZIP_LOCAL, 'utf8') }));
  page.on('request', (req) => {
    const u = req.url();
    if (/^https?:/.test(u) && !u.startsWith('http://127.0.0.1:4173') && !u.startsWith('https://cdnjs.cloudflare.com/ajax/libs/jszip/')) {
      externalRequests.push(`${req.method()} ${u}`);
    }
  });
});
test.afterEach(async () => {
  expect(consoleErrors, 'コンソールエラー・例外がゼロであること').toEqual([]);
  expect(externalRequests, 'CDNライブラリ以外への外部通信がないこと').toEqual([]);
});

async function enterKey(page, key) {
  await page.getByTestId('open-license').click();
  await page.getByTestId('license-input').fill(key);
  await page.getByTestId('license-submit').click();
}

/* ---------- 1. 表示・コンソールエラーゼロ ---------- */
test('ポータル：表示・必須要素・プレースホルダー', async ({ page }) => {
  await page.goto(PORTAL);
  await expect(page).toHaveTitle(/サクッと業務ツール工房/);
  await expect(page.getByRole('heading', { name: 'あなたのデータは、どこにも送信されません' })).toBeVisible();
  await expect(page.getByTestId('tool-card-ec')).toBeVisible();
  await expect(page.locator('.tool-card.soon')).toHaveCount(3);
  await expect(page.locator('a[href="{{NOTE_SINGLE_URL}}"]').first()).toBeAttached();
  await expect(page.locator('a[href="{{NOTE_MASTER_URL}}"]').first()).toBeAttached();
  await expect(page.locator('a[href="./tools/ec-image-batch/index.html"]').first()).toBeAttached();
  await expect(page.getByTestId('pro-badge')).toBeHidden();
});

test('ツール：表示（無料版状態）', async ({ page }) => {
  await page.goto(TOOL);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('EC・フリマ・ブログ用 画像一括リサイズ＆白余白・透かし加工ツール');
  await expect(page.getByTestId('plan-chip')).toHaveText('無料版：1回3枚まで');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
  await expect(page.locator('a[href="{{NOTE_SINGLE_URL}}"]').first()).toBeAttached();
  await expect(page.locator('a[href="{{NOTE_MASTER_URL}}"]').first()).toBeAttached();
});

/* ---------- 2. 無料版の制限 ---------- */
test('無料版：4枚目以降はロックされ処理がブロックされる', async ({ page }) => {
  await page.goto(TOOL);
  await page.getByTestId('file-input').setInputFiles(files(4));
  const thumbs = page.locator('[data-testid="thumb"]');
  await expect(thumbs).toHaveCount(4);
  await expect(thumbs.nth(3)).toHaveClass(/locked/);
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(1);
  await expect(page.getByTestId('limit-banner')).toBeVisible();

  await page.getByTestId('process-btn').click();
  await expect(page.getByTestId('status')).toContainText('3枚の処理が完了');
  await expect(page.locator('[data-testid="result"]')).toHaveCount(3);
  await expect(page.getByTestId('status')).toContainText('1枚は処理されていません');

  // 透かし位置カスタムはロック（右下以外は無効）
  await expect(page.locator('#posGrid button[data-pos="tl"]')).toBeDisabled();
  await expect(page.locator('#wmTile')).toBeDisabled();

  // ZIP一括DLはブロックされ、キー入力モーダルが開く
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.getByTestId('zip-btn').click();
  await expect(page.locator('#licenseModal')).toHaveClass(/open/);
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test('無効なキーでは解除されない', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'WRONG-KEY-0000');
  await expect(page.locator('#licenseMsg')).toContainText('正しくありません');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
});

/* ---------- 3. 単体キー ---------- */
test('単体キー PRO-EC-2026 でロック解除・再訪時に自動復元', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'PRO-EC-2026');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(page.getByTestId('plan-chip')).toContainText('プロ版');

  await page.getByTestId('file-input').setInputFiles(files(5));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(0);
  await expect(page.getByTestId('limit-banner')).toBeHidden();
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(5);
  await expect(page.locator('#posGrid button[data-pos="tl"]')).toBeEnabled();

  await page.reload();
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sakutto-kobo-license-keys'))).toContain('PRO-EC-2026');

  // ポータル側でも認証状態が反映される
  await page.goto(PORTAL);
  await expect(page.getByTestId('pro-badge')).toBeVisible();
});

/* ---------- 4. マスターキー ---------- */
test('マスターキー MASTER-2026-VIP：ポータルで入力 → ツールも解除', async ({ page }) => {
  await page.goto(PORTAL);
  await enterKey(page, 'MASTER-2026-VIP');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(page.getByTestId('pro-badge')).toContainText('マスター');

  await page.goto(TOOL);
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(files(4));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(0);
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(4);
});

test('マスターキー MASTER-2026-VIP：ツール画面で直接入力（小文字・空白も許容）', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, '  master-2026-vip ');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(page.locator('#wmTile')).toBeEnabled();
});

/* ---------- 5. ダウンロード ---------- */
test('単体ダウンロードが発火する（無料版）', async ({ page }) => {
  await page.goto(TOOL);
  await page.getByTestId('file-input').setInputFiles(files(1));
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(1);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('dl-btn').first().click()]);
  expect(dl.suggestedFilename()).toBe('item1_mercari.jpg');
  const buf = fs.readFileSync(await dl.path());
  expect(buf.subarray(0, 3).toString('hex')).toBe('ffd8ff'); // JPEG
});

test('ZIP一括ダウンロードが発火し、全画像が含まれる（プロ版）', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'PRO-EC-2026');
  await page.locator('#presets [data-preset="webp"]').click();
  await page.locator('#wmOn').check();
  await page.locator('#posGrid button[data-pos="tl"]').click();
  await page.getByTestId('file-input').setInputFiles(files(4));
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(4);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('zip-btn').click()]);
  expect(dl.suggestedFilename()).toMatch(/^images_\d{8}_\d{4}\.zip$/);
  const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['item1.webp', 'item2.webp', 'item3.webp', 'item4.webp']);
});

test('プリセット：Amazonは2000×2000で出力される', async ({ page }) => {
  await page.goto(TOOL);
  await page.locator('#presets [data-preset="amazon"]').click();
  await page.getByTestId('file-input').setInputFiles(files(1));
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"] .meta')).toContainText('2000×2000');
});
