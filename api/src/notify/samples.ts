// Previews of real alerts ("Gửi thử" on the channels page), built from current data.
import { l, withLang } from '../i18n.js';
import type { ItemView, ProjectView } from '../rules.js';
import type { Channel, Update } from '../types.js';
import { activeProjectViews } from '../views.js';
import type { NotifyDeps } from './deps.js';
import { collectAlerts } from './events.js';
import type { Message, MessageLine } from './message.js';
import { inScope } from './routeChannels.js';
import { becameRedMessage, digestMessage, highIssueMessage, hourlyMessage, message, testMessage } from './render.js';

export const TEST_SAMPLES = ['connect', 'became_red', 'high_issue', 'hourly', 'daily_digest'] as const;
export type TestSample = (typeof TEST_SAMPLES)[number];

/**
 * A preview of a real alert built from the channel's current data, so people can see
 * what they will receive. Nothing is de-duplicated or marked as sent.
 */
export function sampleMessage(deps: NotifyDeps, ch: Channel, sample: TestSample, now: Date): Promise<Message> {
  return withLang(ch.lang, () => buildSample(deps, ch, sample, now));
}

async function buildSample(deps: NotifyDeps, ch: Channel, sample: TestSample, now: Date): Promise<Message> {
  if (sample === 'connect') return testMessage(ch, deps.webUrl);
  const snap = await deps.store.snapshot();
  const views = activeProjectViews(snap, now).filter((v) => inScope(ch, v)); // worst first
  const byId = new Map(snap.users.map((u) => [u.id, u.name]));
  const name = (id?: string) => (id ? (byId.get(id) ?? id.split('@')[0]) : '—');
  const note: MessageLine = {
    text: l(
      '🧪 Tin mẫu từ dữ liệu hiện tại — không phải cảnh báo thật.',
      '🧪 現在のデータから作成したサンプルです — 実際のアラートではありません。',
    ),
    subtle: true,
  };
  const tag = l('[Mẫu]', '[サンプル]');
  const mark = (m: Message): Message => ({ ...m, title: `${tag} ${m.title}`, lines: [...m.lines, note] });
  const empty = (what: string) =>
    message({
      title: `${tag} ${what}`,
      lines: [
        {
          text: l(
            'Phạm vi của kênh hiện chưa có dữ liệu phù hợp để làm mẫu.',
            'このチャネルの対象範囲には、サンプルに使えるデータがまだありません。',
          ),
        },
        note,
      ],
    });

  if (sample === 'became_red') {
    const v = views[0];
    if (!v) return empty(l('Dự án chuyển sang ĐỎ', 'プロジェクトが「赤」に'));
    const update: Update = v.latestUpdate ?? {
      id: 'sample',
      projectId: v.id,
      at: now.toISOString(),
      author: v.pl ?? '',
      authorRole: 'PL',
      summary: l('Chưa có cập nhật', '報告なし'),
    };
    return mark(becameRedMessage(deps, v, update, name));
  }
  if (sample === 'high_issue') {
    const issues = views.flatMap((v) => v.openItems.filter((i) => i.type === 'issue').map((i) => [v, i] as const));
    const pick = issues.find(([, i]) => i.priority === 'high') ?? issues[0];
    if (!pick) return empty(l('Vấn đề ưu tiên cao mới', '優先度「高」の新しい課題'));
    return mark(highIssueMessage(deps, pick[0], pick[1], name));
  }
  if (sample === 'hourly') {
    const all: Channel = { ...ch, events: [...ch.events, 'late_update', 'overdue', 'milestone_soon'] };
    const pending = collectAlerts(all, views, now, name);
    if (!pending.length) return empty(l('Cần chú ý', '要注意'));
    return mark(hourlyMessage(deps, pending));
  }
  if (!views.length) return empty(l('Tóm tắt dự án', 'プロジェクトサマリー'));
  return mark(digestMessage(deps, ch, views, now, name));
}
