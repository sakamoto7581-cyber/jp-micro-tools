// @ts-check
// 公開前テスト：ポータル＋1号機（EC画像一括リサイズ＆加工ツール）
//   cd tests && npm install && npx playwright install chromium && npx playwright test
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const JSZip = require('jszip');
const { files, registerHooks, enterKey, URLS } = require('./helpers');

const PORTAL = '/index.html';
const TOOL = '/tools/ec-image-batch/index.html';
const USAGE_KEY = 'sakutto-ec-daily-usage';

registerHooks({ allowCdn: true });

/** ブラウザ側のローカル日付で、当日の使用枚数を直接セットする */
async function setUsage(page, count, dayOffset = 0) {
  await page.evaluate(([k, c, off]) => {
    const d = new Date(); d.setDate(d.getDate() + off);
    const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem(k, JSON.stringify({ date: s, count: c }));
  }, [USAGE_KEY, count, dayOffset]);
}

/* ================= ポータル ================= */
test('ポータル：表示・2号機カード（NEW）・購入リンク・価格表記', async ({ page }) => {
  await page.goto(PORTAL);
  await expect(page).toHaveTitle(/サクッと業務ツール工房/);
  await expect(page.getByRole('heading', { name: 'あなたのデータは、どこにも送信されません' })).toBeVisible();
  await expect(page.getByTestId('tool-card-ec')).toBeVisible();
  const inv = page.getByTestId('tool-card-invoice');
  await expect(inv).toBeVisible();
  await expect(inv.locator('.tag')).toHaveText('NEW');
  await expect(inv.locator('a[href="tools/invoice-batch/"]')).toBeVisible();
  await expect(page.locator('.tool-card.soon')).toHaveCount(2);
  // 既存の note 実URLが残っていること・2号機はプレースホルダー
  await expect(page.locator(`a[href="${URLS.noteSingle}"]`).first()).toBeAttached();
  await expect(page.locator(`a[href="${URLS.noteMaster}"]`).first()).toBeAttached();
  await expect(page.locator('a[href="{{NOTE_INVOICE_URL}}"]').first()).toBeAttached();
  // マスターキー価格：初期応援価格1,480円＋値上げ予告
  await expect(page.getByTestId('master-price-note')).toHaveText('ツール5個公開まで初期応援価格 1,480円（以降2,980円に値上げ）');
  await expect(page.locator('.price-box .price')).toContainText('1,480');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
});

/* ================= 1号機：表示 ================= */
test('1号機：表示（無料版）・料金表・解説・2号機リンク', async ({ page }) => {
  await page.goto(TOOL);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('EC・フリマ・ブログ用 画像一括リサイズ＆白余白・透かし加工ツール');
  await expect(page.getByTestId('plan-chip')).toHaveText('無料版：1日3枚まで');
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 3 / 3 枚');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
  const pricing = page.getByTestId('pricing-table');
  await expect(pricing).toContainText('0円');
  await expect(pricing).toContainText('780');
  await expect(pricing).toContainText('今だけ1,480');
  await expect(pricing).toContainText('2,980円に値上げ');
  await expect(pricing.locator(`a[href="${URLS.noteSingle}"]`)).toBeVisible();
  await expect(pricing.locator(`a[href="${URLS.noteMaster}"]`)).toBeVisible();
  await expect(page.getByTestId('guide')).toContainText('使い方は3ステップ');
  await expect(page.getByTestId('guide').locator('details')).toHaveCount(4);
  await expect(page.getByTestId('crosslink-invoice')).toHaveAttribute('href', '../invoice-batch/');
});

/* ================= 1号機：無料版の1日3枚制限 ================= */
test('無料版：3枚処理でき、同日4枚目はブロックされる', async ({ page }) => {
  await page.goto(TOOL);
  await page.getByTestId('file-input').setInputFiles(files(3));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(0);
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(3);
  await expect(page.getByTestId('status')).toContainText('3枚の処理が完了');
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 0 / 3 枚');
  expect(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), USAGE_KEY)).count).toBe(3);

  // 同じ日に4枚目
  await page.locator('#clearBtn').click();
  await page.getByTestId('file-input').setInputFiles(files(1, 'extra'));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(1);
  await expect(page.getByTestId('limit-banner')).toBeVisible();
  await expect(page.getByTestId('limit-banner')).toContainText('使い切りました');
  await page.getByTestId('process-btn').click();
  await expect(page.getByTestId('status')).toContainText('処理できません');
  await expect(page.locator('[data-testid="result"]')).toHaveCount(0);
  expect(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), USAGE_KEY)).count).toBe(3);

  // リロードしても当日の消費は維持される
  await page.reload();
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 0 / 3 枚');
});

test('無料版：残り2枚で5枚を処理しようとするとまるごとブロック', async ({ page }) => {
  await page.goto(TOOL);
  await setUsage(page, 1);
  await page.reload();
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 2 / 3 枚');
  await page.getByTestId('file-input').setInputFiles(files(5));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(3);
  await page.getByTestId('process-btn').click();
  await expect(page.getByTestId('status')).toContainText('本日の無料枠は残り2枚です');
  await expect(page.locator('[data-testid="result"]')).toHaveCount(0);
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 2 / 3 枚');

  // 2枚に減らせば処理できる
  for (let i = 0; i < 3; i++) await page.locator('[data-testid="thumb"] .rm').last().click();
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(2);
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 0 / 3 枚');
});

test('無料版：保存日付が前日なら残り枠がリセットされる', async ({ page }) => {
  await page.goto(TOOL);
  await setUsage(page, 3, -1);
  await page.reload();
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 3 / 3 枚');
  await page.getByTestId('file-input').setInputFiles(files(3));
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(3);
  const u = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), USAGE_KEY));
  expect(u.count).toBe(3);
  expect(u.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('無料版：透かし位置カスタムとZIP一括DLはロック', async ({ page }) => {
  await page.goto(TOOL);
  await expect(page.locator('#posGrid button[data-pos="tl"]')).toBeDisabled();
  await expect(page.locator('#wmTile')).toBeDisabled();
  await page.getByTestId('file-input').setInputFiles(files(1));
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(1);
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.getByTestId('zip-btn').click();
  await expect(page.locator('#licenseModal')).toHaveClass(/open/);
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test('無効なキー・他ツールのキーでは解除されない', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'WRONG-KEY-0000');
  await expect(page.locator('#licenseMsg')).toContainText('正しくありません');
  await page.getByTestId('license-input').fill('PRO-INV-2026');
  await page.getByTestId('license-submit').click();
  await expect(page.locator('#licenseMsg')).toContainText('別のツール用');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
});

/* ================= 1号機：プロ版 ================= */
test('単体キー PRO-EC-2026：無料枠を使い切っていても制限解除・再訪時に自動復元', async ({ page }) => {
  await page.goto(TOOL);
  await setUsage(page, 3);
  await page.reload();
  await expect(page.getByTestId('quota')).toHaveText('本日の無料枠：残り 0 / 3 枚');
  await enterKey(page, 'PRO-EC-2026');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(page.getByTestId('plan-chip')).toContainText('プロ版');
  await expect(page.getByTestId('quota')).toHaveText('プロ版：1回最大100枚・1日の上限なし');

  await page.getByTestId('file-input').setInputFiles(files(6));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(0);
  await expect(page.getByTestId('limit-banner')).toBeHidden();
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(6);
  await expect(page.locator('#posGrid button[data-pos="tl"]')).toBeEnabled();
  // もう一度処理しても制限なし
  await page.getByTestId('process-btn').click();
  await expect(page.getByTestId('status')).toContainText('6枚の処理が完了');

  await page.reload();
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sakutto-kobo-license-keys'))).toContain('PRO-EC-2026');
  await page.goto(PORTAL);
  await expect(page.getByTestId('pro-badge')).toBeVisible();
});

test('マスターキー MASTER-2026-VIP：ポータルで入力 → 1号機も制限解除', async ({ page }) => {
  await page.goto(PORTAL);
  await enterKey(page, 'MASTER-2026-VIP');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(page.getByTestId('pro-badge')).toContainText('マスター');

  await page.goto(TOOL);
  await setUsage(page, 3);
  await page.reload();
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(files(5));
  await expect(page.locator('[data-testid="thumb"].locked')).toHaveCount(0);
  await page.getByTestId('process-btn').click();
  await expect(page.locator('[data-testid="result"]')).toHaveCount(5);
});

test('マスターキー MASTER-2026-VIP：1号機で直接入力（小文字・空白も許容）', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, '  master-2026-vip ');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(page.locator('#wmTile')).toBeEnabled();
  await expect(page.getByTestId('quota')).toContainText('1日の上限なし');
});

/* ================= 1号機：ダウンロード ================= */
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

test('ZIP一括ダウンロードが発火し、全画像が含まれる（プロ版・順次キュー処理）', async ({ page }) => {
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
