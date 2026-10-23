import assert from 'node:assert/strict';
import test from 'node:test';
import { setAppLanguage } from '../src/services/i18n';
import { localeDateFormatter } from '../src/services/localeDateFormatter';

test('cached formats follow language changes without mutating dates', async () => {
  const date = new Date('2026-10-22T10:00:00Z');
  const formatter = localeDateFormatter({ month: 'long', timeZone: 'UTC' });
  await setAppLanguage('en');
  assert.equal(formatter.format(date), 'October');
  await setAppLanguage('pt-PT');
  assert.equal(formatter.format(date), 'outubro');
  await setAppLanguage('en');
  assert.equal(formatter.format(date), 'October');
  assert.equal(date.toISOString(), '2026-10-22T10:00:00.000Z');
});
