import { describe, expect, it, vi } from 'vitest';

// Runs before the imports below, so i18n.ts starts in Japanese.
vi.hoisted(() => localStorage.setItem('lang', 'ja'));

import { fmtDateTime, fmtDay, fmtDaysLeft, fmtHours } from '../../src/format';
import { HEALTH_LABEL } from '../../src/labels';

describe('formatting (Japanese)', () => {
  it('month first, weekday in brackets', () => {
    expect(document.documentElement.lang).toBe('ja');
    expect(fmtDateTime('2026-10-09T02:45:00Z')).toBe('10/09 09:45');
    expect(fmtDay('2026-10-09')).toBe('10/09(金)');
    expect([-2, 0, 1, 5].map(fmtDaysLeft)).toEqual(['2日超過', '今日', '明日', '残り5日']);
    expect(fmtHours(91.2)).toBe('3日 19時間');
    expect(HEALTH_LABEL).toEqual({ green: '緑', yellow: '黄', red: '赤' });
  });
});
