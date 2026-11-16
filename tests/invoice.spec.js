// @ts-check
// 公開前テスト：2号機（インボイス対応 請求書・納品書・領収書PDF一括ジェネレーター）
const { test, expect } = require('@playwright/test');
const { makePng, registerHooks, enterKey, URLS } = require('./helpers');

const TOOL = '/tools/invoice-batch/index.html';

// 2号機は外部ライブラリ依存ゼロ：CDNを含めて外部通信ゼロを検証
registerHooks({ allowCdn: false });

// window.print() は印刷領域の中身を記録するだけのスタブに置き換える
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-ignore
    window.__printed = [];
    window.print = () => {
      // @ts-ignore
      window.__printed.push(document.getElementById('printArea').innerHTML);
    };
  });
});

const preview = (page) => page.getByTestId('preview');
const printed = (page) => page.evaluate(() => /** @type {any} */ (window).__printed);

async function fillRow(page, i, { name, qty, price, rate }) {
  const row = page.getByTestId('item-row').nth(i);
  await row.locator('.it-name').fill(name);
  await row.locator('.it-qty').fill(String(qty));
  await row.locator('.it-price').fill(String(price));
  await row.locator('.it-rate').selectOption(String(rate));
}

test('2号機：表示エラーゼロ・初期状態・料金表・1号機リンク', async ({ page }) => {
  await page.goto(TOOL);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('インボイス対応 請求書・納品書・領収書PDF一括ジェネレーター');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
  await expect(preview(page).getByTestId('sheet-title')).toHaveText('請求書');
  await expect(page.getByTestId('rounding')).toHaveValue('floor');
  // 購入リンク：単体はプレースホルダー、マスターは note 実URL
  await expect(page.locator('a[href="{{NOTE_INVOICE_URL}}"]').first()).toBeAttached();
  await expect(page.locator(`a[href="${URLS.noteMaster}"]`).first()).toBeAttached();
  const pricing = page.getByTestId('pricing-table');
  await expect(pricing).toContainText('780');
  await expect(pricing).toContainText('今だけ1,480');
  await expect(page.getByTestId('guide').locator('details')).toHaveCount(4);
  await expect(page.getByTestId('crosslink-ec')).toHaveAttribute('href', '../ec-image-batch/');
  // プロ版機能はロック表示 → クリックでキー入力モーダル
  await expect(page.getByTestId('lock-csv')).toBeVisible();
  await page.getByTestId('lock-csv').click();
  await expect(page.locator('#licenseModal')).toHaveClass(/open/);
});

test('2号機：タブ切替でタイトル・文言が変わる', async ({ page }) => {
  await page.goto(TOOL);
  await page.getByTestId('tab-delivery').click();
  await expect(preview(page).getByTestId('sheet-title')).toHaveText('納品書');
  await expect(preview(page)).toContainText('下記のとおり納品いたします');
  await expect(page.getByTestId('withholding')).toBeHidden();
  await page.getByTestId('tab-receipt').click();
  await expect(preview(page).getByTestId('sheet-title')).toHaveText('領収書');
  await expect(preview(page)).toContainText('上記正に領収いたしました');
  await page.getByTestId('tab-invoice').click();
  await expect(preview(page).getByTestId('sheet-title')).toHaveText('請求書');
  await expect(preview(page)).toContainText('ご請求申し上げます');
});

test('2号機：10%と8%の明細 → 税率別小計・消費税・合計（端数処理は税率ごとに1回）', async ({ page }) => {
  await page.goto(TOOL);
  await page.getByTestId('add-row').click();
  await page.getByTestId('add-row').click();
  await page.getByTestId('add-row').click();
  await fillRow(page, 0, { name: '制作費', qty: 2, price: 1234, rate: 10 });   // 2,468
  await fillRow(page, 1, { name: '保守費', qty: 1, price: 999, rate: 10 });    //   999
  await fillRow(page, 2, { name: '菓子', qty: 3, price: 333, rate: 8 });       //   999
  await fillRow(page, 3, { name: '飲料', qty: 1, price: 105, rate: 8 });       //   105
  const p = preview(page);
  // 10%: 3,467 → 税 346.7 → 切り捨て 346（行ごとに丸めると 246+99=345 になる）
  await expect(p.getByTestId('sum-sub-10')).toHaveText('¥3,467');
  await expect(p.getByTestId('sum-tax-10')).toHaveText('¥346');
  // 8%: 1,104 → 税 88.32 → 88
  await expect(p.getByTestId('sum-sub-8')).toHaveText('¥1,104');
  await expect(p.getByTestId('sum-tax-8')).toHaveText('¥88');
  await expect(p.getByTestId('sum-total')).toHaveText('¥5,005');
  await expect(p.getByTestId('sheet-amount')).toContainText('¥5,005');
  await expect(p).toContainText('軽減税率（8%）対象');

  await page.getByTestId('rounding').selectOption('round');
  await expect(p.getByTestId('sum-tax-10')).toHaveText('¥347');
  await expect(p.getByTestId('sum-tax-8')).toHaveText('¥88');
  await expect(p.getByTestId('sum-total')).toHaveText('¥5,006');

  await page.getByTestId('rounding').selectOption('ceil');
  await expect(p.getByTestId('sum-tax-10')).toHaveText('¥347');
  await expect(p.getByTestId('sum-tax-8')).toHaveText('¥89');
  await expect(p.getByTestId('sum-total')).toHaveText('¥5,007');

  // 源泉徴収（請求書のみ）：税込 5,007 × 10.21% = 511.21 → 511
  await page.getByTestId('withholding').check();
  await expect(p.getByTestId('sum-withholding')).toHaveText('-¥511');
  await expect(p.getByTestId('sum-pay')).toHaveText('¥4,496');
  await expect(p.getByTestId('sheet-amount')).toContainText('¥4,496');
  // 納品書では源泉徴収は適用されない
  await page.getByTestId('tab-delivery').click();
  await expect(p.getByTestId('sum-withholding')).toHaveCount(0);
  await expect(p.getByTestId('sum-total')).toHaveText('¥5,007');

  // 行の削除で再計算される
  await page.getByTestId('tab-invoice').click();
  await page.getByTestId('item-row').nth(3).locator('.del-btn').click();
  await expect(page.getByTestId('item-row')).toHaveCount(3);
  await expect(p.getByTestId('sum-sub-8')).toHaveText('¥999');
});

test('2号機：登録番号の形式チェック（T＋13桁）', async ({ page }) => {
  await page.goto(TOOL);
  const reg = page.getByTestId('reg-no');
  const warn = page.getByTestId('reg-warn');
  await expect(warn).toBeHidden();
  await reg.fill('T123456789012');       // 12桁
  await expect(warn).toBeVisible();
  await reg.fill('1234567890123');       // T なし
  await expect(warn).toBeVisible();
  await reg.fill('T12345678901234');     // 14桁
  await expect(warn).toBeVisible();
  await reg.fill('T1234567890123');
  await expect(warn).toBeHidden();
  await expect(preview(page).getByTestId('sheet-reg')).toHaveText('登録番号：T1234567890123');
  await reg.fill('Ｔ１２３４５６７８９０１２３'); // 全角でも正規化してOK
  await expect(warn).toBeHidden();
  await reg.fill('');
  await expect(warn).toBeHidden();
});

test('2号機：発行元情報が保存され、次回自動入力される', async ({ page }) => {
  await page.goto(TOOL);
  await page.locator('#isName').fill('サクッと商店');
  await page.locator('#isTel').fill('03-1234-5678');
  await page.getByTestId('reg-no').fill('T9876543210987');
  await page.getByTestId('save-issuer').click();
  await expect(page.locator('#issuerMsg')).toContainText('保存しました');
  await page.reload();
  await expect(page.locator('#isName')).toHaveValue('サクッと商店');
  await expect(page.locator('#isTel')).toHaveValue('03-1234-5678');
  await expect(preview(page).getByTestId('sheet-issuer')).toContainText('サクッと商店');
});

test('2号機：無料版はクレジット表示 → PRO-INV-2026 で消える（印刷にも反映）', async ({ page }) => {
  await page.goto(TOOL);
  await expect(preview(page).getByTestId('credit')).toHaveText('Created by サクッと業務ツール工房');
  await page.getByTestId('print-btn').click();
  expect((await printed(page))[0]).toContain('Created by サクッと業務ツール工房');

  await enterKey(page, 'PRO-INV-2026');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(preview(page).getByTestId('credit')).toHaveCount(0);
  await expect(page.getByTestId('lock-csv')).toBeHidden();
  await page.getByTestId('print-btn').click();
  const p = await printed(page);
  expect(p[1]).toContain('class="sheet"');
  expect(p[1]).not.toContain('Created by');

  await page.reload();
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await expect(preview(page).getByTestId('credit')).toHaveCount(0);
});

test('2号機：MASTER-2026-VIP でも解除できる', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'MASTER-2026-VIP');
  await expect(page.getByTestId('pro-badge')).toContainText('マスター');
  await expect(preview(page).getByTestId('credit')).toHaveCount(0);
  await expect(page.getByTestId('lock-assets')).toBeHidden();
});

test('2号機：1号機の単体キーでは解除されない', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'PRO-EC-2026');
  await expect(page.locator('#licenseMsg')).toContainText('別のツール用');
  await expect(page.getByTestId('pro-badge')).toBeHidden();
  await expect(preview(page).getByTestId('credit')).toBeVisible();
});

const CSV = [
  '宛先,発行日,品目,数量,単価,税率,備考',
  '株式会社サンプル,2026/11/30,Webサイト保守,1,30000,10%,11月分',
  '株式会社サンプル,2026/11/30,お菓子詰め合わせ,2,1500,8,',
  '"合同会社テスト, 東京",2026-11-30,デザイン制作,1,50000,10,振込手数料はご負担ください',
  '株式会社サンプル,2026/12/15,追加作業,3,5000,10,',
  '個人 太郎,2026/11/30,原稿料,1,10000,10,',
].join('\r\n') + '\r\n';

test('2号機：CSV取込で複数帳票が生成され、一括印刷でページ区切りされる（プロ版）', async ({ page }) => {
  await page.goto(TOOL);
  // 無料版では CSV 取込はブロック（モーダルが開く）
  await expect(page.getByTestId('csv-input')).toBeDisabled();
  await expect(page.getByTestId('batch-item')).toHaveCount(0);

  await enterKey(page, 'PRO-INV-2026');
  await expect(page.getByTestId('pro-badge')).toBeVisible();
  await page.locator('#licenseModal').evaluate((m) => m.classList.remove('open'));
  await page.getByTestId('csv-input').setInputFiles({ name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + CSV) });
  // 同じ「宛先＋発行日」はまとめる：サンプル(11/30)・テスト・サンプル(12/15)・個人 = 4枚
  await expect(page.getByTestId('batch-item')).toHaveCount(4);
  await expect(page.getByTestId('batch-count')).toHaveText('（4件）');
  await expect(page.getByTestId('status')).toContainText('4件の帳票を作成しました');
  const first = page.getByTestId('batch-item').nth(0);
  await expect(first.getByTestId('sheet-row')).toHaveCount(2);
  await expect(first.getByTestId('sheet-client')).toContainText('株式会社サンプル');
  // 30,000(10%) → 税3,000 ／ 3,000(8%) → 税240 → 合計36,240
  await expect(first.getByTestId('sum-total')).toHaveText('¥36,240');
  await expect(page.getByTestId('batch-item').nth(1).getByTestId('sheet-client')).toContainText('合同会社テスト, 東京');

  await page.getByTestId('batch-print').click();
  const html = (await printed(page)).pop();
  expect((html.match(/class="sheet"/g) || []).length).toBe(4);
  expect(html).not.toContain('Created by');
});

test('2号機：CSVはShift_JISでも読み込め、50件を超える分は取り込まない', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'MASTER-2026-VIP');
  await page.locator('#licenseModal').evaluate((m) => m.classList.remove('open'));
  const lines = ['宛先,発行日,品目,数量,単価,税率,備考'];
  for (let i = 1; i <= 55; i++) lines.push(`取引先${i},2026/11/30,作業費,1,1000,10,`);
  // まずUTF-8で50件上限
  await page.getByTestId('csv-input').setInputFiles({ name: 'many.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) });
  await expect(page.getByTestId('batch-item')).toHaveCount(50);
  await expect(page.getByTestId('status')).toContainText('上限50件');

  // Shift_JIS（「宛先」「株式会社」などをSJISバイト列で）
  // Shift_JIS：「テスト,2026/11/30,作業,1,1000,10,」を SJIS で：テ=8365 ス=8358 ト=8367 作=8DEC 業=8BC6
  const sj = Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, ...Buffer.from(',2026/11/30,'), 0x8d, 0xec, 0x8b, 0xc6, ...Buffer.from(',1,1000,10,\r\n')]);
  await page.getByTestId('csv-input').setInputFiles({ name: 'sjis.csv', mimeType: 'text/csv', buffer: sj });
  await expect(page.getByTestId('batch-item')).toHaveCount(1);
  await expect(page.getByTestId('batch-item').first().getByTestId('sheet-client')).toContainText('テスト');
  await expect(page.getByTestId('batch-item').first().getByTestId('sheet-row')).toContainText('作業');
});

test('2号機：ロゴ・角印の合成とテンプレート保存／読込（プロ版）', async ({ page }) => {
  await page.goto(TOOL);
  await enterKey(page, 'PRO-INV-2026');
  await page.locator('#licenseModal').evaluate((m) => m.classList.remove('open'));
  await page.getByTestId('logo-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: makePng(80, 40, [30, 90, 200]) });
  await page.getByTestId('stamp-input').setInputFiles({ name: 'stamp.png', mimeType: 'image/png', buffer: makePng(60, 60, [220, 30, 30]) });
  await expect(preview(page).getByTestId('sheet-logo')).toBeVisible();
  await expect(preview(page).getByTestId('sheet-stamp')).toBeVisible();
  await page.getByTestId('print-btn').click();
  const html = (await printed(page)).pop();
  expect(html).toContain('sheet-logo');
  expect(html).toContain('sheet-stamp');

  // テンプレート
  await page.getByTestId('client-name').fill('株式会社テンプレ');
  await fillRow(page, 0, { name: '月額保守', qty: 1, price: 20000, rate: 10 });
  await page.getByTestId('tpl-name').fill('テンプレA');
  await page.getByTestId('tpl-save').click();
  await expect(page.locator('#tplMsg')).toContainText('保存しました');
  await page.reload();
  await expect(page.getByTestId('client-name')).toHaveValue('');
  // ロゴは再訪時も復元される
  await expect(preview(page).getByTestId('sheet-logo')).toBeVisible();
  await page.getByTestId('tpl-select').selectOption({ label: 'テンプレA' });
  await page.getByTestId('tpl-load').click();
  await expect(page.getByTestId('client-name')).toHaveValue('株式会社テンプレ');
  await expect(preview(page).getByTestId('sum-total')).toHaveText('¥22,000');
});
