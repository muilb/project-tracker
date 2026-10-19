import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HealthBadge, HealthBar, MoreLess, UrgencyBadge, useShowMore, Warnings } from '../../src/components/ui';
import { HEALTH_LABEL, URGENCY_LABEL } from '../../src/labels';
import type { Health, Urgency } from '../../../api/src/types';

describe('status badges', () => {
  // CLAUDE.md: status colours always come with an icon and a text label, never colour alone.
  it('each colour has its own symbol and its label', () => {
    const symbols = new Set<string>();
    for (const h of ['green', 'yellow', 'red'] as Health[]) {
      const { container } = render(<HealthBadge health={h} />);
      const badge = container.querySelector('.badge')!;
      expect(badge).toHaveClass(`tone-${h}`);
      expect(badge).toHaveTextContent(HEALTH_LABEL[h]);
      const symbol = badge.querySelector('[aria-hidden]')!.textContent!;
      expect(symbol.trim()).not.toBe('');
      symbols.add(symbol);
    }
    expect(symbols.size).toBe(3);
  });

  it('urgency too', () => {
    const symbols = new Set<string>();
    for (const u of ['critical', 'attention', 'normal'] as Urgency[]) {
      const { container } = render(<UrgencyBadge urgency={u} />);
      const badge = container.querySelector('.badge')!;
      expect(badge).toHaveTextContent(URGENCY_LABEL[u]);
      symbols.add(badge.querySelector('[aria-hidden]')!.textContent!);
    }
    expect(symbols.size).toBe(3);
  });

  it('the colour bar reads out its numbers', () => {
    render(<HealthBar red={1} yellow={0} green={4} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Đỏ 1, Vàng 0, Xanh 4');
  });

  it('warnings: only those that apply', () => {
    const { container, rerender } = render(<Warnings lateHours={0} overdueItems={0} highIssues={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Warnings lateHours={26} overdueItems={2} highIssues={0} />);
    expect(container).toHaveTextContent('⏰ Trễ cập nhật 1 ngày 2 giờ⚠ 2 mục quá hạn');
    expect(container).not.toHaveTextContent('ưu tiên cao');
  });
});

describe('long lists', () => {
  function List({ n }: { n: number }) {
    const { visible, more } = useShowMore(
      Array.from({ length: n }, (_, i) => i + 1),
      5,
    );
    return (
      <>
        <ul>
          {visible.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        {more}
      </>
    );
  }
  const shown = () => screen.queryAllByRole('listitem').map((li) => Number(li.textContent));

  it('"Xem thêm" adds a step at a time, "Thu gọn" goes back', async () => {
    const user = userEvent.setup();
    render(<List n={12} />);
    expect(shown()).toEqual([1, 2, 3, 4, 5]);
    expect(screen.queryByRole('button', { name: 'Thu gọn' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Xem thêm (còn 7)' }));
    expect(shown()).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Xem thêm (còn 2)' }));
    expect(shown()).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /Xem thêm/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Thu gọn' }));
    expect(shown()).toEqual([1, 2, 3, 4, 5]);
  });

  it('short lists have no buttons', () => {
    render(<List n={5} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('server paging: unknown count, busy while loading', async () => {
    const onMore = vi.fn();
    const { rerender } = render(<MoreLess onMore={onMore} />);
    await userEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    expect(onMore).toHaveBeenCalledOnce();
    rerender(<MoreLess onMore={onMore} busy />);
    expect(screen.getByRole('button', { name: 'Đang tải…' })).toBeDisabled();
    rerender(<MoreLess />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
