import assert from 'node:assert/strict';
import test from 'node:test';
import { getLanguageRevision, getLocale, resolveAppLocale, setAppLanguage, subscribeLanguage, translate } from '../src/services/i18n';

test('resolves explicit and system language choices', () => {
  assert.equal(resolveAppLocale('en', ['pt-PT']), 'en-US');
  assert.equal(resolveAppLocale('pt-PT', ['en-US']), 'pt-PT');
  assert.equal(resolveAppLocale('system', ['pt-BR']), 'pt-PT');
  assert.equal(resolveAppLocale('system', ['cs-CZ']), 'en-US');
});

test('loads Portuguese on demand and preserves provider values', async () => {
  await setAppLanguage('en');
  const revision = getLanguageRevision();
  assert.equal(translate('Settings'), 'Settings');
  const announced: string[] = [];
  const unsubscribe = subscribeLanguage(() => { if (getLocale() === 'pt-PT') announced.push(translate('Sun')); });
  await setAppLanguage('pt-PT');
  unsubscribe();
  assert.deepEqual(announced, ['dom.']);
  assert.ok(getLanguageRevision() > revision);
  assert.equal(translate('Settings'), 'Definições');
  assert.equal(translate('Play {channel}', undefined, { channel: 'News One' }), 'Reproduzir News One');
  assert.equal(translate('News One'), 'News One');
  assert.equal(translate('Off'), 'Desligado');
  assert.equal(translate('Keep forever'), 'Guardar sempre');
  await setAppLanguage('en');
  assert.equal(translate('Settings'), 'Settings');
});

test('a newer language choice wins while the catalogue request settles', async () => {
  const loading = setAppLanguage('pt-PT');
  await setAppLanguage('en');
  await loading;
  assert.equal(getLocale(), 'en-US');
});

test('commits a system locale only when its translations are ready', async () => {
  await setAppLanguage('en');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['pt-PT'] } });
  try {
    const loading = setAppLanguage('system');
    assert.equal(getLocale(), 'en-US');
    await loading;
    assert.equal(getLocale(), 'pt-PT');
    assert.equal(translate('Sun'), 'dom.');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
    await setAppLanguage('en');
  }
});
