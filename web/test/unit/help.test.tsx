import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { HelpPage } from '../../src/pages/Help';
import { HelpPageJa } from '../../src/pages/HelpJa';

function outline(page: React.ReactElement) {
  const { container, unmount } = render(page);
  const sections = [...container.querySelectorAll('section[id]')].map((s) => ({
    id: s.id,
    title: s.querySelector('h2')?.textContent ?? '',
  }));
  const anchors = [...container.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')!.slice(1));
  const ids = new Set([...container.querySelectorAll('[id]')].map((e) => e.id));
  unmount();
  return { sections, anchors, ids };
}

it('the Vietnamese and Japanese manuals have the same sections, in the same order', () => {
  const vi = outline(<HelpPage />);
  const ja = outline(<HelpPageJa />);
  expect(vi.sections.length).toBeGreaterThan(10);
  expect(ja.sections.map((s) => s.id)).toEqual(vi.sections.map((s) => s.id));
  for (const s of [...vi.sections, ...ja.sections]) expect(s.title).toMatch(/^\d+\. \S/);
});

it('every link inside a manual points at a section that exists', () => {
  for (const page of [<HelpPage />, <HelpPageJa />]) {
    const { anchors, ids } = outline(page);
    expect(anchors.length).toBeGreaterThan(10);
    expect(anchors.filter((a) => !ids.has(a))).toEqual([]);
  }
});
