// T251 (WLojek/DocCloak#2): "Clear offline data" asks first, clears only on the confirmation,
// and is disabled while the browser is offline.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { OfflineDataReset } from '../../src/ui/components/OfflineDataReset.tsx';

function mount(onClear: () => Promise<void>) {
  return render(createElement(LanguageProvider, null, createElement(OfflineDataReset, { onClear })));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
});
afterEach(() => cleanup());

describe('Clear offline data', () => {
  it('asks first; Cancel clears nothing; the confirmation clears once', async () => {
    const onClear = vi.fn(async () => {});
    mount(onClear);
    fireEvent.click(screen.getByRole('button', { name: 'Clear offline data' }));
    expect(screen.getByText(/anything you have not saved is lost/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear offline data' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear and reload' })); });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('offline: the button is disabled and says why; back online it works again', () => {
    mount(vi.fn(async () => {}));
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect((screen.getByRole('button', { name: 'Clear offline data' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Needs an internet connection.')).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect((screen.getByRole('button', { name: 'Clear offline data' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
