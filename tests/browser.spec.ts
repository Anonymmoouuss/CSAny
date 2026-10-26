import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

const url = process.env.BROWSERSTRIKE_URL || 'http://127.0.0.1:5173';
declare global { interface Window { pauseTestFrames: (paused: boolean) => void } }
test.use({ viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: process.env.BROWSERSTRIKE_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
test.setTimeout(240000);

async function boot(page: Page) {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE\.|WebGL/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    if (!localStorage.getItem('bs-quality')) localStorage.setItem('bs-quality', 'low');
    const schedule = window.requestAnimationFrame.bind(window); let paused = false; let deferred: FrameRequestCallback[] = [];
    window.requestAnimationFrame = callback => schedule(time => { if (paused) deferred.push(callback); else callback(time); });
    window.pauseTestFrames = value => { paused = value; if (!paused) { const callbacks = deferred; deferred = []; callbacks.forEach(callback => schedule(callback)); } };
  });
  await page.goto(url); await expect(page.locator('#practice-button')).toBeVisible();
  await expect(page.locator('#lobby-loadout')).not.toBeEmpty();
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => document.getElementById('game-canvas')?.dataset.mapReady === 'true' && document.getElementById('game-canvas')?.dataset.loadedAssets?.includes('sas'));
  return errors;
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.pauseTestFrames(true));
  try { await page.screenshot({ path, animations: 'disabled' }); }
  finally { await page.evaluate(() => window.pauseTestFrames(false)); }
}

async function canvasSample(page: Page) {
  return page.evaluate(() => new Promise<{ colors: number; lit: number; hash: number }>(resolve => requestAnimationFrame(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const context = canvas.getContext('webgl2')!; const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    const colors = new Set<string>(); let lit = 0; let hash = 0;
    for (let row = 1; row < 48; row++) for (let column = 1; column < 80; column++) {
      const offset = (Math.floor(row / 48 * canvas.height) * canvas.width + Math.floor(column / 80 * canvas.width)) * 4;
      const red = pixels[offset]; const green = pixels[offset + 1]; const blue = pixels[offset + 2];
      if (red + green + blue > 35) lit++;
      colors.add(`${red},${green},${blue}`); hash = (Math.imul(hash, 31) + red * 3 + green * 5 + blue * 7) >>> 0;
    }
    resolve({ colors: colors.size, lit, hash });
  })));
}

async function inventory(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem('bs-profile-v2')!)); }
async function noHorizontalOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function finishReel(page: Page) {
  await expect(page.locator('#reel-skip')).toBeVisible(); await page.locator('#reel-skip').click();
  await expect(page.locator('#reel-overlay')).toHaveClass(/complete/);
  if (await page.locator('#rare-vault-open').isVisible()) { await page.locator('#rare-vault-open').click(); await expect(page.locator('#reel-skip')).toBeVisible(); await page.locator('#reel-skip').click(); }
  await expect(page.locator('#reel-inspect')).toBeVisible();
}

test('deployment separates online, solo game modes and aim training', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#online-options')).toBeVisible();
  await expect(page.locator('#room-code')).toBeHidden();
  await expect(page.locator('#deploy-label')).toHaveText('FIND MATCH');
  await page.locator('#match-private').click(); await expect(page.locator('#room-code')).toBeVisible();
  await expect(page.locator('#deploy-label')).toHaveText('CREATE PRIVATE ROOM');
  await page.locator('#match-public').click(); await expect(page.locator('#room-code')).toBeHidden();
  await expect(page.locator('#local-options')).toBeHidden();
  await page.locator('#practice-button').click();
  await expect(page.locator('#solo-options')).toBeVisible();
  await expect(page.locator('#online-options')).toBeHidden();
  await expect(page.locator('#solo-mode option')).toHaveCount(4);
  await page.locator('#solo-mode').selectOption('defusal');
  await expect(page.locator('#deploy-label')).toHaveText('DEPLOY SOLO');
  await page.locator('#training-button').click();
  await expect(page.locator('#training-options')).toBeVisible();
  await expect(page.locator('#solo-options')).toBeHidden();
  await expect(page.locator('#deploy-label')).toHaveText('START TRAINING');
  await page.locator('#online-button').click();
  await expect(page.locator('#online-options')).toBeVisible();
  await expect(page.locator('#training-options')).toBeHidden();
  await noHorizontalOverflow(page);
});

test('occluded ally rendering draws edges without filling the silhouette', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 }); await boot(page); await page.evaluate(() => window.pauseTestFrames(true));
  const sample = await page.evaluate(async () => {
    const base = '/@fs/workspaces/CSAny/node_modules/three/';
    const THREE = await import(`${base}build/three.module.js`);
    const { EffectComposer } = await import(`${base}examples/jsm/postprocessing/EffectComposer.js`);
    const { RenderPass } = await import(`${base}examples/jsm/postprocessing/RenderPass.js`);
    const { OutlinePass } = await import(`${base}examples/jsm/postprocessing/OutlinePass.js`);
    const { OutputPass } = await import(`${base}examples/jsm/postprocessing/OutputPass.js`);
    const resource = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/assets\.ts(?:\?|$)/.test(name)) || '/assets.ts';
    const { configureAllyOutline } = await import(resource);
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(192, 192); renderer.setPixelRatio(1);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#202020');
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20); camera.position.z = 6;
    const ally = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 4, 8), new THREE.MeshBasicMaterial({ color: '#777777' })); scene.add(ally);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.2), new THREE.MeshBasicMaterial({ color: '#444444' })); wall.position.z = 1; scene.add(wall);
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(192, 192, { type: THREE.UnsignedByteType })); composer.renderToScreen = false;
    composer.addPass(new RenderPass(scene, camera)); const outline = new OutlinePass(new THREE.Vector2(192, 192), scene, camera, [ally]); configureAllyOutline(outline, 'CT'); composer.addPass(outline); composer.addPass(new OutputPass());
    const pixels = new Uint8Array(192 * 192 * 4);
    const count = () => { composer.render(); renderer.readRenderTargetPixels(composer.readBuffer, 0, 0, 192, 192, pixels); let edges = 0; let center = 0; for (let row = 0; row < 192; row++) for (let column = 0; column < 192; column++) { const offset = (row * 192 + column) * 4; if (pixels[offset + 2] > pixels[offset] + 15 && pixels[offset + 1] > pixels[offset] + 8) { edges++; if (Math.abs(row - 96) < 10 && Math.abs(column - 96) < 10) center++; } } return { edges, center }; };
    const hidden = count(); wall.visible = false; const visible = count();
    outline.dispose(); composer.dispose(); renderer.dispose(); ally.geometry.dispose(); ally.material.dispose(); wall.geometry.dispose(); wall.material.dispose();
    return { hidden, visible };
  });
  expect(sample.hidden.edges).toBeGreaterThan(20); expect(sample.hidden.edges).toBeLessThan(1000); expect(sample.hidden.center).toBe(0); expect(sample.visible.edges).toBe(0);
});

test('profiles upload pictures and two browsers exchange friend and trade requests', async ({ page, browser }, info) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await page.addInitScript(() => localStorage.setItem('bs-quality', 'low'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('#player-name').fill('Social Alpha'); await page.locator('#profile-open').click();
  await expect(page.locator('#social-profile-name')).toHaveValue('Social Alpha', { timeout: 20000 });
  const alpha = (await page.locator('.social-profile-code > b').innerText()).trim(); expect(alpha).toMatch(/^[A-F0-9]{12}$/);
  const picture = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#56b0a7' } }).png().toBuffer();
  await page.locator('#social-avatar-input').setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer: picture });
  await expect(page.locator('.profile-picture img')).toBeVisible(); await page.locator('#social-profile-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(page.locator('#profile-open img')).toBeVisible();
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const second = await other.newPage(); second.on('pageerror', error => errors.push(error.message)); await second.addInitScript(() => localStorage.setItem('bs-quality', 'low'));
    await second.goto(url); await second.locator('#player-name').fill('Social Bravo'); await second.locator('#profile-open').click();
    await expect(second.locator('#social-profile-name')).toHaveValue('Social Bravo', { timeout: 20000 });
    const bravo = (await second.locator('.social-profile-code > b').innerText()).trim(); expect(bravo).not.toBe(alpha);
    await page.locator('[data-social-tab="friends"]').click(); await page.locator('#social-friend-code').fill(bravo); await page.locator('#social-friend-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
    await expect(second.locator('[data-notice="friend"]')).toBeVisible(); await second.locator('[data-notice="friend"] [data-notice-action="accept"]').click();
    await expect(page.locator(`[data-trade-friend="${bravo}"]`)).toBeVisible(); await page.locator(`[data-trade-friend="${bravo}"]`).click();
    await page.locator('[data-trade-item="give"]').first().check(); await page.locator('[data-trade-item="receive"]').first().check(); await page.locator('#social-trade-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
    await expect(second.locator('[data-notice="trade"]')).toBeVisible(); await second.locator('[data-notice="trade"] [data-notice-action="view"]').click(); await expect(second.locator('[data-trade-action="accept"]')).toBeVisible(); await second.locator('[data-trade-action="accept"]').click();
    await expect(second.locator('.social-trade-history')).toContainText('ACCEPTED'); await expect(page.locator('.social-trade-history')).toContainText('ACCEPTED');
    await page.locator('[data-social-tab="friends"]').click(); await page.locator(`[data-view-profile="${bravo}"]`).click();
    await expect(page.locator('.profile-inventory article')).toHaveCount(21); await expect(page.locator('.social-cloud-heading')).toContainText('CR INVENTORY VALUE');
    await page.locator(`[data-message-friend="${bravo}"]`).click(); await page.locator('#social-message-content').fill('Ready for a duel?'); await page.locator('#social-message-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
    await expect(second.locator('[data-notice="message"]')).toContainText('Ready for a duel?'); await second.locator('[data-notice="message"] [data-notice-action="view"]').click(); await expect(second.locator('.direct-messages')).toContainText('Ready for a duel?');
    await second.locator('[data-social-close]').click(); await second.locator('#settings-open').click(); await expect(second.locator('#settings-overlay')).toBeVisible();
    await page.locator('[data-social-tab="friends"]').click(); await page.locator(`[data-view-profile="${bravo}"]`).click(); await page.locator(`[data-duel-friend="${bravo}"]`).click();
    await expect(second.locator('[data-notice="duel"]')).toContainText('Social Alpha'); await expect(second.locator('[data-notice="duel"] [data-notice-action="decline"]')).toBeVisible();
    await second.locator('[data-notice="duel"] [data-notice-action="accept"]').click();
    await expect(second.locator('#game-ui')).toBeVisible({ timeout: 30000 }); await expect(page.locator('#game-ui')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#mini-count')).toHaveText('02 / 10'); expect(await page.locator('#room-display').innerText()).toBe(await second.locator('#room-display').innerText());
    await noHorizontalOverflow(page); await noHorizontalOverflow(second);
    await second.screenshot({ path: info.outputPath('mobile-friends-trades.png'), animations: 'disabled' });
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});

test('dedicated recoil range supports weapon switching, live shots and trackpad scoping', async ({ page }, info) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 640, height: 480 });
  const errors = await boot(page);
  await page.locator('#training-button').click(); await page.locator('#training-kind').selectOption('range');
  await page.locator('#training-weapon').selectOption('sniper'); await page.locator('#deploy-button').click();
  await expect(page.locator('#training-panel')).toBeVisible(); await expect(page.locator('#training-level')).toHaveText('RECOIL RANGE');
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-map', 'training'); await expect(page.locator('#timer')).toHaveText('--:--');
  await expect(page.locator('#buy-menu')).toBeHidden();
  await page.locator('#center-hint').click(); await page.waitForFunction(() => document.pointerLockElement?.id === 'game-canvas');
  await expect(page.locator('#game-canvas')).toBeFocused(); await page.keyboard.press('q');
  await expect(page.locator('#scope-overlay')).toHaveClass(/active/);
  await page.evaluate(() => window.pauseTestFrames(true));
  try {
    await page.mouse.click(320, 240);
    await expect.poll(async () => Number((await page.locator('#training-hits').innerText()).split('/')[1]), { timeout: 15000 }).toBeGreaterThan(0);
  } finally { await page.evaluate(() => window.pauseTestFrames(false)); }
  await expect(page.locator('#scope-overlay')).toHaveClass(/active/); await expect(page.locator('#ammo-value')).toHaveText('5');
  await expect(page.locator('#scope-overlay')).toHaveAttribute('data-zoom', '5x');
  await page.keyboard.press('Escape'); await page.locator('#range-weapon').selectOption('bullpup'); await page.waitForFunction(() => document.pointerLockElement?.id === 'game-canvas'); await page.keyboard.press('q');
  await expect(page.locator('#scope-overlay')).toHaveAttribute('data-reticle', 'chevron'); await expect(page.locator('#scope-overlay')).toHaveAttribute('data-zoom', '1.5x'); await expect(page.locator('#scope-overlay')).toHaveClass(/active/);
  await page.keyboard.press('Escape'); await page.locator('#range-weapon').selectOption('pistol'); await expect(page.locator('#weapon-name')).toHaveText('P-9 Service');
  await expect(page.locator('#scope-overlay')).not.toHaveClass(/active/);
  const scene = await canvasSample(page); expect(scene.colors).toBeGreaterThan(30); expect(scene.lit).toBeGreaterThan(500);
  await capture(page, info.outputPath('range-pistol-and-hands.png'));
  await page.keyboard.press('Escape'); await page.locator('#training-reset').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#training-score')).toHaveText('0'); await expect(page.locator('#training-hits')).toHaveText('0 / 0');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => document.pointerLockElement === null);
  await page.locator('#chat-hint').click(); await expect(page.locator('#chat-input')).toBeFocused();
  await page.keyboard.press('Escape'); await page.locator('#leave-button').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#lobby')).toBeVisible(); await noHorizontalOverflow(page); expect(errors).toEqual([]);
});

test('HC45 hands and rare paint, knife inspection, chat popups and separate charm cases work', async ({ page }, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const errors = await boot(page); const profile = await inventory(page);
  const painted = { ...profile.items.find((item: { skinId: string }) => item.skinId === 'handCannon-0'), uid: 'browser-hc45-paint', skinId: 'handCannon-signature-circuit-2', float: 0.06, statTrak: false }; profile.items.push(painted); profile.equipped.handCannon = painted.uid;
  await page.evaluate(value => localStorage.setItem('bs-profile-v2', JSON.stringify(value)), profile); await page.reload(); await expect(page.locator('#practice-button')).toBeVisible();
  await page.locator('#training-button').click(); await page.locator('#training-kind').selectOption('range'); await page.locator('#training-weapon').selectOption('handCannon'); await page.locator('#deploy-button').click();
  await expect(page.locator('#weapon-name')).toHaveText('HC-45');
  await page.waitForFunction(() => document.getElementById('game-canvas')?.dataset.weaponAsset === 'handcannon-classic');
  const model = await page.evaluate(async () => {
    const path = (file: string) => performance.getEntriesByType('resource').map(entry => entry.name).find(name => new RegExp(`/${file}\\.ts(?:\\?|$)`).test(name)) || `/${file}.ts`;
    const { assets, modelBounds } = await import(path('assets')); const { buildWeapon, disposeWeapon } = await import(path('weapons'));
    const saved = JSON.parse(localStorage.getItem('bs-profile-v2')!); const item = saved.items.find((item: { uid: string }) => item.uid === saved.equipped.handCannon);
    const weapon = buildWeapon('handCannon', item, 0, undefined, 'view'); let hands = 0; let painted = 0;
    weapon.traverse((object: any) => { if (!object.isMesh || !object.visible) return; if (object.userData.hands && !modelBounds(object).isEmpty()) hands++; for (const material of [object.material].flat()) if (material.userData.appliedSkin === item.skinId) painted++; });
    const result = { hands, painted, hasHands: weapon.userData.hasHands, asset: weapon.userData.assetId, drawDuration: weapon.userData.drawDuration, authoredDraw: weapon.userData.animation.has('draw') }; disposeWeapon(weapon); return result;
  });
  expect(model.asset).toBe('handcannon-classic'); expect(model.hasHands).toBe(true); expect(model.hands).toBeGreaterThan(0); expect(model.painted).toBeGreaterThan(0);
  expect(model.authoredDraw).toBe(true); expect(model.drawDuration).toBe(2.75);
  const scene = await canvasSample(page); expect(scene.colors).toBeGreaterThan(30); await capture(page, info.outputPath('hc45-authored-hands-and-rare-paint.png'));
  await page.keyboard.press('Escape'); await page.locator('#range-weapon').selectOption('knife'); await expect(page.locator('#weapon-name')).toHaveText('Field Knife');
  await page.waitForFunction(() => document.getElementById('game-canvas')?.dataset.loadedAssets?.includes('knife-flip'));
  if (!await page.evaluate(() => !!document.pointerLockElement)) await page.locator('#center-hint').click();
  const started = await page.evaluate(() => performance.now()); await page.keyboard.press('f'); await page.waitForFunction(start => performance.now() - start > 1200, started);
  await capture(page, info.outputPath('knife-one-hand-inspect.png'));
  await page.keyboard.press('y'); await page.locator('#chat-input').fill('Visible range chat'); await page.locator('#chat-input').press('Enter'); await expect(page.locator('.chat-popup')).toContainText('Visible range chat');
  const popup = await page.locator('#chat-popups').boundingBox(); expect(popup && popup.x < 100 && Math.abs(popup.y + popup.height / 2 - 300) < 50).toBeTruthy();
  await page.keyboard.press('Escape'); await page.locator('#leave-button').evaluate(button => (button as HTMLButtonElement).click());
  await page.locator('#shop-open').click(); const before = await inventory(page); await page.locator('[data-open-charm-case="signal-charms"]').click();
  await page.locator('#case-open-confirm').click(); await finishReel(page); await page.locator('#reel-done').click();
  const after = await inventory(page); expect(after.items.length).toBe(before.items.length); expect(after.keys).toBe(before.keys); expect(after.unlockedCharms.length).toBe(1);
  await page.locator('[data-tab="locker"]').click(); await page.locator('.inventory-item').first().click(); await page.locator('#inspect-charm').selectOption(after.unlockedCharms[0]);
  await expect(page.locator('#inspect-charm')).toHaveValue(after.unlockedCharms[0]); await noHorizontalOverflow(page); expect(errors).toEqual([]);
});

test('desktop locker, turntable, case transaction and crosshair persistence', async ({ page }, info) => {
  const errors = await boot(page);
  const first = await canvasSample(page); expect(first.colors).toBeGreaterThan(30); expect(first.lit).toBeGreaterThan(500);
  await capture(page, info.outputPath('desktop-lobby.png'));
  await page.locator('#locker-open').click();
  await expect(page.locator('.inventory-item')).toHaveCount(18);
  expect(await page.locator('.inventory-item img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 256))).toBe(true);
  await page.locator('.inventory-item').first().click();
  await expect(page.locator('#inspect-screen')).toBeVisible();
  await expect(page.locator('#armory-screen')).toBeHidden();
  await capture(page, info.outputPath('desktop-knife-inspect.png'));
  const studio = await canvasSample(page); expect(studio.colors).toBeGreaterThan(20);
  const stage = page.locator('#inspect-stage'); const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 160, bounds.y + bounds.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-studio-action="rotate"]')).toHaveAttribute('aria-pressed', 'false');
  const rotated = await canvasSample(page); expect(rotated.hash).not.toBe(studio.hash);
  await page.locator('[data-studio-action="reset"]').click(); await expect(page.locator('[data-studio-action="rotate"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#inspect-close').click();
  await page.locator('[data-tab="cases"]').click();
  const before = await inventory(page);
  await page.locator('[data-open-case="dust"]').click();
  await expect(page.locator('#case-preview-screen')).toBeVisible(); await page.locator('#case-open-confirm').click(); await finishReel(page);
  const after = await inventory(page);
  expect(after.items.length).toBe(before.items.length + 1); expect(after.keys).toBe(before.keys - 1); expect(after.cases.dust).toBe(before.cases.dust - 1);
  await capture(page, info.outputPath('desktop-case-reveal.png'));
  await page.locator('#reel-inspect').click();
  await page.locator('[data-equip-inspected]').click();
  await page.locator('#inspect-close').click(); await page.locator('[data-armory-close]').click();
  await page.locator('#settings-open').click();
  await page.locator('#crosshair-custom').fill('#ffcc33');
  await page.locator('#gap-setting').fill('9'); await page.locator('#crosshair-dot').check();
  await page.locator('input[name="crosshair-style"][value="dynamic"]').check();
  await page.locator('#settings-close').click(); await page.reload();
  await expect(page.locator('#practice-button')).toBeVisible();
  await page.locator('#settings-open').click();
  await expect(page.locator('#crosshair-custom')).toHaveValue('#ffcc33'); await expect(page.locator('#gap-setting')).toHaveValue('9'); await expect(page.locator('#crosshair-dot')).toBeChecked();
  expect((await inventory(page)).items.length).toBe(after.items.length);
  await noHorizontalOverflow(page); expect(errors).toEqual([]);
});

for (const width of [900, 390]) test(`3D cases, gold vaults and charm weapon previews at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); const errors = await boot(page); await page.locator('#shop-open').click();
  await page.locator('[data-open-case="dust"]').click(); await expect(page.locator('#case-preview-screen')).toBeVisible();
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-supply-model', 'case');
  const first = await canvasSample(page); expect(first.colors).toBeGreaterThan(20); expect(first.lit).toBeGreaterThan(500);
  await page.locator('#case-preview-stage').focus(); await page.keyboard.press('ArrowRight'); const turned = await canvasSample(page); expect(turned.hash).not.toBe(first.hash);
  await capture(page, info.outputPath('3d-case.png')); const before = await inventory(page);
  await page.locator('#case-open-confirm').evaluate(button => { const original = Math.random; Math.random = () => 0.9999; try { (button as HTMLButtonElement).click(); } finally { Math.random = original; } });
  await expect(page.locator('#reel-skip')).toBeVisible(); await page.locator('#reel-skip').click(); await expect(page.locator('#rare-vault-open')).toBeVisible();
  await expect(page.locator('[data-reel-winner] .rare-question')).toHaveText('?'); const paid = await inventory(page); expect(paid.items.length).toBe(before.items.length + 1);
  await page.locator('#rare-vault-open').click(); await page.locator('#reel-skip').click(); await expect(page.locator('#reel-inspect')).toBeVisible(); expect(await inventory(page)).toEqual(paid);
  await capture(page, info.outputPath('rare-vault-reveal.png')); await page.locator('#reel-done').click();
  await page.locator('[data-open-charm-case="operator-charms"]').click();
  await page.locator('#case-open-confirm').evaluate(button => { const original = Math.random; Math.random = () => 4.5 / 80; try { (button as HTMLButtonElement).click(); } finally { Math.random = original; } });
  await finishReel(page); await page.locator('#reel-done').click(); await page.locator('[data-tab="charms"]').click(); await page.locator('[data-select-charm]').first().click();
  await expect(page.locator('#charm-picker')).toBeVisible(); const saved = await inventory(page); await page.locator('#charm-weapon').selectOption(saved.equipped.pistol);
  expect(await page.locator('#charm-weapon-preview').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(256);
  await capture(page, info.outputPath('charm-weapon-preview.png')); await page.locator('#charm-apply').click();
  const applied = await inventory(page); expect(applied.items.find((item: { uid: string }) => item.uid === saved.equipped.pistol).charm).toBe(applied.unlockedCharms[0]);
  await noHorizontalOverflow(page); expect(errors).toEqual([]);
});

test('supplied maps render and solo supports five-player teams, purchases and locked scoping', async ({ page }, info) => {
  const errors = await boot(page);
  await page.locator('#practice-button').click();
  expect(await page.locator('#map-select option').count()).toBe(6);
  for (const map of ['arena', 'breeze', 'dune', 'rust', 'zona7', 'resoforge']) {
    await page.locator('#map-select').selectOption(map);
    await page.waitForFunction(id => { const canvas = document.getElementById('game-canvas'); return canvas?.dataset.map === id && canvas.dataset.mapReady === 'true'; }, map);
    const sample = await canvasSample(page); expect(sample.colors, map).toBeGreaterThan(30);
    await capture(page, info.outputPath(`map-${map}.png`));
  }
  await page.locator('#map-select').selectOption('dune'); await page.locator('#deploy-button').click();
  await expect(page.locator('#mini-count')).toHaveText('10 / 10'); await expect(page.locator('#buy-menu')).toBeVisible();
  await expect(page.locator('#supply-timer')).toContainText('SPAWN SUPPLY');
  await page.locator('[data-buy="sniper"]').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#weapon-name')).toHaveText('Longbow 99');
  await page.locator('#buy-close').evaluate(button => (button as HTMLButtonElement).click());
  await page.waitForFunction(() => document.getElementById('game-canvas')?.dataset.weaponAsset === 'awp');
  if (!await page.evaluate(() => !!document.pointerLockElement)) await page.locator('#center-hint').click();
  await page.keyboard.press('q'); await expect(page.locator('#scope-overlay')).toHaveClass(/active/);
  await page.mouse.down(); await expect(page.locator('#ammo-value')).not.toHaveText('5', { timeout: 25000 }); await page.mouse.up();
  await expect(page.locator('#scope-overlay')).toHaveClass(/active/);
  await page.keyboard.press('q'); await expect(page.locator('#scope-overlay')).not.toHaveClass(/active/);
  const first = await canvasSample(page); await capture(page, info.outputPath('desktop-practice.png'));
  const second = await canvasSample(page); expect(first.colors).toBeGreaterThan(20); expect(second.lit).toBeGreaterThan(500);
  await page.locator('#leave-button').evaluate(button => (button as HTMLButtonElement).click()); expect(errors).toEqual([]);
});

test('Freight Yard renders and objective modes expose live control and tier HUDs', async ({ page }, info) => {
  await page.setViewportSize({ width: 800, height: 600 }); const errors = await boot(page);
  await page.locator('#character-select').selectOption('10'); await page.locator('#practice-button').click(); await page.locator('#map-select').selectOption('resoforge');
  await page.waitForFunction(() => document.getElementById('game-canvas')?.dataset.map === 'resoforge' && document.getElementById('game-canvas')?.dataset.mapReady === 'true');
  const scene = await canvasSample(page); expect(scene.colors).toBeGreaterThan(30); expect(scene.lit).toBeGreaterThan(500); await capture(page, info.outputPath('freight-yard.png'));
  await page.locator('#solo-mode').selectOption('hill'); await page.locator('#deploy-button').click(); await expect(page.locator('#hill-hud')).toBeVisible(); await expect(page.locator('#hill-hud')).toContainText('250s');
  await page.keyboard.press('Escape'); await expect(page.locator('#buy-menu')).toBeHidden(); await expect(page.locator('#game-canvas')).toHaveAttribute('data-view-mode', 'match');
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-alive', 'true'); const liveHill = await canvasSample(page); expect(liveHill.colors).toBeGreaterThan(30);
  await capture(page, info.outputPath('hill-hud.png')); await page.keyboard.press('Escape'); await page.locator('#leave-button').evaluate(button => (button as HTMLButtonElement).click());
  await page.locator('#solo-mode').selectOption('gungame'); await page.locator('#deploy-button').click(); await expect(page.locator('#gungame-hud')).toBeVisible(); await expect(page.locator('#gun-tier')).toContainText('1 / 20'); await expect(page.locator('#buy-menu')).toBeHidden();
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-view-mode', 'match'); await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-alive', 'true');
  await capture(page, info.outputPath('gungame-hud.png')); await noHorizontalOverflow(page); expect(errors).toEqual([]);
});

test('aim training exposes difficulty, accuracy, target scoring and restart', async ({ page }, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const errors = await boot(page); await page.locator('#training-button').click(); await page.locator('#difficulty-select').selectOption('easy'); await page.locator('#training-weapon').selectOption('pistol');
  await page.locator('#deploy-button').click(); await expect(page.locator('#training-panel')).toBeVisible();
  await expect(page.locator('#training-level')).toContainText('EASY'); await expect(page.locator('#phase-label')).toHaveText('AIM TRAINING');
  await expect(page.locator('#buy-menu')).toBeHidden();
  if (!await page.evaluate(() => !!document.pointerLockElement)) await page.locator('#center-hint').click();
  await page.locator('#training-reset').evaluate(button => (button as HTMLButtonElement).click());
  await page.waitForFunction(() => document.getElementById('timer')?.textContent === '01:00');
  await page.mouse.down(); await page.waitForFunction(() => Number(document.getElementById('training-hits')?.textContent?.split('/')[1]) > 0); await page.mouse.up();
  await expect(page.locator('#training-score')).not.toHaveText('0');
  const sample = await canvasSample(page); expect(sample.colors).toBeGreaterThan(30); await capture(page, info.outputPath('aim-training.png'));
  await page.locator('#training-reset').evaluate(button => (button as HTMLButtonElement).click()); await expect(page.locator('#training-score')).toHaveText('0');
  await page.locator('#leave-button').evaluate(button => (button as HTMLButtonElement).click()); expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) test(`responsive locker and inspector at ${viewport.width}`, async ({ page }, info) => {
  await page.setViewportSize(viewport); const errors = await boot(page);
  await noHorizontalOverflow(page); const scene = await canvasSample(page); expect(scene.colors).toBeGreaterThan(20);
  await capture(page, info.outputPath('lobby.png'));
  await page.locator('#locker-open').click(); await capture(page, info.outputPath('locker.png'));
  await noHorizontalOverflow(page); await page.locator('.inventory-item').first().click();
  const sample = await canvasSample(page); expect(sample.colors).toBeGreaterThan(20);
  await capture(page, info.outputPath('inspector.png'));
  const facts = await page.locator('.inspect-facts').boundingBox(); const action = await page.locator('[data-equip-inspected]').boundingBox();
  expect(facts && action && facts.y + facts.height < action.y + 1).toBeTruthy();
  await page.locator('#inspect-close').click(); await page.locator('[data-tab="cases"]').click();
  await capture(page, info.outputPath('cases.png')); await noHorizontalOverflow(page); expect(errors).toEqual([]);
});

test('two browser clients join a bot-filled online room', async ({ page, context }, info) => {
  const errors = await boot(page); await page.locator('#match-private').click(); await page.locator('#player-name').fill('Alpha'); await page.locator('#mode-select').selectOption('defusal'); await page.locator('#join-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(page.locator('#game-ui')).toBeVisible({ timeout: 15000 });
  const code = await page.locator('#room-display').innerText(); expect(code).toMatch(/^[A-F0-9]{6}$/);
  const second = await context.newPage(); const secondErrors = await boot(second);
  await second.locator('#match-private').click(); await second.locator('#player-name').fill('Bravo'); await second.locator('#room-code').fill(code);
  await second.locator('#join-form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(second.locator('#game-ui')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#score-rows')).toContainText('Bravo'); await expect(second.locator('#score-rows')).toContainText('Alpha');
  await expect(page.locator('#mini-count')).toHaveText('10 / 10');
  await expect(page.locator('#score-map')).toContainText('DEFUSAL');
  await capture(page, info.outputPath('online-room.png'));
  await second.locator('#leave-button').click(); await page.locator('#leave-button').click();
  expect(errors.concat(secondErrors)).toEqual([]);
});