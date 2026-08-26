import { expect, test } from '@playwright/test';
import { settle } from '../../src/browser/settle.js';
import { looksLikeLogin } from '../../src/browser/guard.js';
import { bindCandidate } from '../../src/locator/bind.js';
import { withDefaults } from '../../src/config.js';

test('settle returns once mutations stop', async ({ page }) => {
  await page.setContent(`<div id="a"></div><script>
    let n = 0;
    const t = setInterval(() => {
      document.getElementById('a').textContent = String(n++);
      if (n > 3) clearInterval(t);
    }, 50);
  </script>`);
  const start = Date.now();
  await settle(page, 300, 5000);
  expect(Date.now() - start).toBeGreaterThan(300);
  // textContent = String(n++) writes the PRE-increment value, so the last write before
  // `if (n > 3)` trips the clearInterval is '3', not '4' (ruling R6).
  await expect(page.locator('#a')).toHaveText('3');
});

test('settle honours the hard cap on a never-quiet page', async ({ page }) => {
  await page.setContent(`<div id="a"></div><script>
    setInterval(() => { document.getElementById('a').textContent = String(Math.random()); }, 20);
  </script>`);
  const start = Date.now();
  await settle(page, 500, 1500);
  expect(Date.now() - start).toBeLessThan(3000);
});

test('looksLikeLogin matches a configured url pattern', async ({ page }) => {
  const config = withDefaults({ seed: 'https://s.test', loginUrlPattern: '/login' });
  await page.setContent('<h1>Hi</h1>');
  await page.route('**/login', (r) => r.fulfill({ body: '<h1>Sign in</h1>' }));
  await page.goto('https://s.test/login');
  expect(await looksLikeLogin(page, config)).toBe(true);
});

test('looksLikeLogin falls back to a password field heuristic', async ({ page }) => {
  const config = withDefaults({ seed: 'https://s.test' });
  await page.setContent('<form><input type="password" /><button>Sign in</button></form>');
  expect(await looksLikeLogin(page, config)).toBe(true);
});

test('looksLikeLogin is false on an ordinary page', async ({ page }) => {
  const config = withDefaults({ seed: 'https://s.test' });
  await page.setContent('<h1>Products</h1><button>Add to cart</button>');
  expect(await looksLikeLogin(page, config)).toBe(false);
});

test('bindCandidate resolves the same node renderCandidate describes', async ({ page }) => {
  await page.setContent(`<nav><a data-testid="cart-link">Cart</a></nav>`);
  const loc = bindCandidate(page, {
    scope: 'navigation', fragile: false,
    candidate: { strategy: 'testId', value: 'cart-link' },
  });
  await expect(loc).toHaveCount(1);
});
