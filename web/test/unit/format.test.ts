import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtDateTime, fmtDay, fmtDaysLeft, fmtHours, todayVN } from '../../src/format';
import { HEALTH_LABEL } from '../../src/labels';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatting (Vietnamese)', () => {
  it('shows times in Vietnam time, day first', () => {
    expect(fmtDateTime('2026-10-09T02:45:00Z')).toBe('09/10 09:45');
    expect(fmtDateTime('2026-10-09T17:30:00Z')).toBe('10/10 00:30');
    expect(fmtDateTime(undefined)).toBe('—');
  });

  it('shows dates with the weekday', () => {
    expect(fmtDay('2026-10-09')).toBe('T6 09/10');
    expect(fmtDay('2026-10-11')).toBe('CN 11/10');
    expect(fmtDay('2026-10-09', false)).toBe('09/10');
    expect(fmtDay(undefined)).toBe('—');
  });

  it('days left and hours', () => {
    expect([-2, 0, 1, 5].map(fmtDaysLeft)).toEqual(['Quá hạn 2 ngày', 'Hôm nay', 'Ngày mai', 'Còn 5 ngày']);
    expect([5, 48, 91.2].map(fmtHours)).toEqual(['5 giờ', '2 ngày', '3 ngày 19 giờ']);
  });

  it('"today" is the Vietnam date, not the browser\'s', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T18:30:00Z')); // 01:30 on the 10th in Vietnam
    expect(todayVN()).toBe('2026-10-10');
  });

  it('defaults to Vietnamese', () => {
    expect(document.documentElement.lang).toBe('vi');
    expect(HEALTH_LABEL).toEqual({ green: 'Xanh', yellow: 'Vàng', red: 'Đỏ' });
  });
});
