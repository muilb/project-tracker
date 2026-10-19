// Health trend (B1): a project's colour per day as a calendar (weeks × weekdays), and the dashboard's
// weekly counts. The colours are recorded once a day by the hourly job, from its first run on.
import { useState } from 'react';
import { Link } from 'react-router';
import type { Health } from '../../../api/src/types';
import { useApi } from '../api';
import { addDays, daysBetween, fmtDay, fmtHours, todayVN, weekStart } from '../format';
import { l, lang } from '../i18n';
import { HEALTH_LABEL, STATE_LABEL } from '../labels';
import type { DashboardTrend, ProjectTrend, ProjectView, TrendChange, TrendDay } from '../types';
import { Empty, ErrorBox, HEALTH_ICON, HealthBadge, HealthBar, Section, useShowMore } from './ui';

/** The end date is drawn on the calendar when it is at most this many days ahead. */
const END_AHEAD_DAYS = 28;
const PAUSED_ICON = '‖';
const WEEKDAYS = { vi: ['T2', '', 'T4', '', 'T6', '', 'CN'], ja: ['月', '', '水', '', '金', '', '日'] };
const monthLabel = (date: string) => (lang === 'ja' ? `${Number(date.slice(5, 7))}月` : `Thg ${Number(date.slice(5, 7))}`);

const NO_DATA = l(
  'Chưa có dữ liệu. Màu của dự án được ghi lại mỗi giờ, mỗi ngày giữ lần ghi cuối; xu hướng có từ ngày hệ thống bắt đầu ghi.',
  'まだデータがありません。色は毎時記録され、1日の最後の記録が残ります。記録を始めた日からの推移を表示します。',
);

/** "■ Đỏ" / "‖ Tạm dừng": the state of a recorded day, icon first. */
function dayLabel(d: TrendDay) {
  return d.state === 'paused' ? `${PAUSED_ICON} ${STATE_LABEL.paused}` : `${HEALTH_ICON[d.health]} ${HEALTH_LABEL[d.health]}`;
}

function DayBadge({ day }: { day: TrendDay }) {
  if (day.state === 'active') return <HealthBadge health={day.health} />;
  return (
    <span className="badge">
      <span aria-hidden>{PAUSED_ICON}</span> {STATE_LABEL.paused}
    </span>
  );
}

/** What made the colour of a recorded day. */
function dayDetail(d: TrendDay): string {
  if (d.state === 'paused') return STATE_LABEL.paused;
  const parts = [
    `PL/GL: ${d.declaredHealth ? HEALTH_LABEL[d.declaredHealth] : '—'}`,
    `PMO: ${d.pmoHealth ? HEALTH_LABEL[d.pmoHealth] : '—'}`,
  ];
  if (d.overdueItems) parts.push(l(`${d.overdueItems} mục quá hạn`, `期限超過 ${d.overdueItems}件`));
  if (d.lateHours) parts.push(l(`trễ cập nhật ${fmtHours(d.lateHours)}`, `報告遅れ ${fmtHours(d.lateHours)}`));
  return parts.join(' · ');
}

/** Consecutive recorded days in the same state and colour, newest first (the calendar as text). */
function runs(days: TrendDay[]) {
  const out: { from: string; to: string; day: TrendDay; count: number }[] = [];
  for (const d of days) {
    const last = out.at(-1);
    if (last && last.day.state === d.state && last.day.health === d.health && daysBetween(last.to, d.date) === 1) {
      last.to = d.date;
      last.count++;
    } else out.push({ from: d.date, to: d.date, day: d, count: 1 });
  }
  return out.reverse();
}

export function ProjectTrendCard({ project }: { project: ProjectView }) {
  const [all, setAll] = useState(false);
  const { data, error } = useApi<ProjectTrend>(`/projects/${project.id}/trend${all ? '?all=1' : ''}`);
  const [picked, setPicked] = useState<string>();
  const history = useShowMore(data ? runs(data.days) : [], 5);

  const title = all ? l('Xu hướng màu (toàn bộ)', '色の推移（全期間）') : l('Xu hướng màu 12 tuần', '色の推移（12週間）');
  if (!data || error)
    return (
      <Section title={title}>
        {error ? <ErrorBox error={error} /> : <p className="loading">{l('Đang tải…', '読み込み中…')}</p>}
      </Section>
    );

  const end = project.endDate;
  // A running project's calendar goes on to its end date when that is close, so the days left show.
  const last =
    project.state !== 'closed' && end && end > data.to && daysBetween(data.to, end) <= END_AHEAD_DAYS ? end : data.to;
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  // Nothing was recorded before the first day (the history started later): the calendar starts there.
  const first = data.days[0]?.date ?? data.from;
  const weeks: string[] = [];
  for (let w = weekStart(first); w <= last; w = addDays(w, 7)) weeks.push(w);
  const selected = picked ?? data.days.at(-1)?.date;
  const sel = selected ? byDate.get(selected) : undefined;

  return (
    <Section
      title={title}
      extra={
        (data.more || all) && (
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setAll(!all);
              setPicked(undefined);
            }}
          >
            {all ? l('12 tuần gần nhất', '直近12週間') : l('Xem toàn bộ', '全期間を表示')}
          </button>
        )
      }
    >
      {data.days.length === 0 ? (
        <Empty>{NO_DATA}</Empty>
      ) : (
        <>
          <div className="trend-cal-wrap">
            <div
              className="trend-cal"
              role="img"
              aria-label={l(
                `Màu theo ngày từ ${fmtDay(data.from, false)} đến ${fmtDay(data.to, false)}; danh sách bên dưới ghi lại đầy đủ`,
                `${fmtDay(data.from, false)}〜${fmtDay(data.to, false)}の日別の色。詳細は下の一覧にあります`,
              )}
              onClick={(e) => {
                const date = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
                if (date && byDate.has(date)) setPicked(date);
              }}
            >
              <div className="trend-col trend-weekdays" aria-hidden>
                <span className="trend-month" />
                {WEEKDAYS[lang].map((w, i) => (
                  <span key={i} className="tc-label">
                    {w}
                  </span>
                ))}
              </div>
              {weeks.map((w, i) => (
                <div key={w} className="trend-col">
                  <span className="trend-month">
                    {/* The month of each week's Sunday, written where it changes. */}
                    {i === 0 || addDays(w, 6).slice(5, 7) !== addDays(weeks[i - 1], 6).slice(5, 7) ? monthLabel(addDays(w, 6)) : ''}
                  </span>
                  {Array.from({ length: 7 }, (_, k) => addDays(w, k)).map((date) => {
                    if (date < first || date > last) return <span key={date} className="tc tc-out" />;
                    const d = byDate.get(date);
                    const isEnd = date === end;
                    const tip = `${fmtDay(date)}: ${
                      d ? `${dayLabel(d)} — ${dayDetail(d)}` : date > data.to ? l('chưa tới', '未来') : l('chưa có dữ liệu', 'データなし')
                    }${isEnd ? ` · 🏁 ${l('ngày kết thúc dự kiến', '終了予定日')}` : ''}`;
                    const cls = d ? (d.state === 'paused' ? 'tc-paused' : `tc-${d.health}`) : date > data.to ? 'tc-future' : 'tc-none';
                    return (
                      <span key={date} data-date={date} className={`tc ${cls}${date === selected ? ' tc-picked' : ''}`} title={tip}>
                        {isEnd ? '🏁' : d ? (d.state === 'paused' ? PAUSED_ICON : HEALTH_ICON[d.health]) : ''}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <TrendLegend withEnd={!!end && end >= first && end <= last} />
          {first > data.from && (
            <p className="muted trend-note">{l(`Có dữ liệu từ ${fmtDay(first, false)}.`, `${fmtDay(first, false)}からのデータです。`)}</p>
          )}
          {sel && (
            <p className="trend-pick">
              <b>{fmtDay(sel.date)}</b>: <DayBadge day={sel} /> {sel.state === 'active' && <span className="muted">{dayDetail(sel)}</span>}
            </p>
          )}
          <EndNote project={project} />
          <h3 className="trend-sub">{l('Diễn biến', '推移')}</h3>
          <ul className="trend-runs">
            {history.visible.map((r) => (
              <li key={r.from}>
                <span className="nowrap">
                  {r.from === r.to ? fmtDay(r.from, false) : `${fmtDay(r.from, false)} → ${fmtDay(r.to, false)}`}
                </span>
                <DayBadge day={r.day} />
                <span className="muted">{l(`${r.count} ngày`, `${r.count}日`)}</span>
              </li>
            ))}
          </ul>
          {history.more}
        </>
      )}
    </Section>
  );
}

function TrendLegend({ withEnd }: { withEnd: boolean }) {
  const swatch = (cls: string, icon: string, label: string) => (
    <span key={cls}>
      <span className={`tc ${cls}`} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  );
  return (
    <div className="legend trend-legend">
      {(['green', 'yellow', 'red'] as Health[]).map((h) => swatch(`tc-${h}`, HEALTH_ICON[h], HEALTH_LABEL[h]))}
      {swatch('tc-paused', PAUSED_ICON, STATE_LABEL.paused)}
      {swatch('tc-none', '', l('Chưa có dữ liệu', 'データなし'))}
      {withEnd && swatch('tc-future', '🏁', l('Ngày kết thúc dự kiến', '終了予定日'))}
    </div>
  );
}

/** Planned end: days left, or how far past it a running project is. */
function EndNote({ project }: { project: ProjectView }) {
  if (!project.endDate || project.state === 'closed') return null;
  if (project.daysPastEnd > 0)
    return (
      <p className="warn-text">
        🏁{' '}
        {l(
          `Quá ngày kết thúc ${project.daysPastEnd} ngày (kết thúc dự kiến ${fmtDay(project.endDate)})`,
          `終了予定日（${fmtDay(project.endDate)}）を${project.daysPastEnd}日超過`,
        )}
      </p>
    );
  const left = daysBetween(todayVN(), project.endDate);
  if (left < 0) return null; // paused projects past the end: no warning
  return (
    <p className="muted">
      🏁 {l(`Kết thúc dự kiến ${fmtDay(project.endDate)} · còn ${left} ngày`, `終了予定 ${fmtDay(project.endDate)}・残り${left}日`)}
    </p>
  );
}

/** Weekly counts of the dashboard's projects, newest week first, and who changed since last week. */
export function DashboardTrendCard({ query }: { query: string }) {
  const { data, error, loading } = useApi<DashboardTrend>(`/dashboard/trend?${query}`);
  const title = l('Xu hướng 12 tuần', '12週間の推移');
  if (!data || error || data.weeks.length === 0)
    return (
      <Section title={title}>
        {error ? (
          <ErrorBox error={error} />
        ) : data ? (
          <Empty>{NO_DATA}</Empty>
        ) : (
          <p className="loading">{loading ? l('Đang tải…', '読み込み中…') : ''}</p>
        )}
      </Section>
    );
  const weeks = [...data.weeks].reverse();
  return (
    <Section title={title}>
      <div className="grid-2 trend-changes">
        <Changes title={l('Xấu đi so với tuần trước', '先週より悪化')} changes={data.worse} empty={l('Không có', 'なし')} />
        <Changes title={l('Tốt lên so với tuần trước', '先週より改善')} changes={data.better} empty={l('Không có', 'なし')} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{l('Tuần', '週')}</th>
              <th className="bar-col">{l('Trạng thái', '状態')}</th>
              <th className="num">{l('Đỏ', '赤')}</th>
              <th className="num">{l('Vàng', '黄')}</th>
              <th className="num">{l('Xanh', '緑')}</th>
              <th className="num">{l('Tạm dừng', '一時停止')}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={w.start}>
                <td className="nowrap">
                  {i === 0 ? l('Tuần này', '今週') : `${fmtDay(w.start, false)} – ${fmtDay(w.end, false)}`}
                </td>
                <td className="bar-col">
                  <HealthBar red={w.red} yellow={w.yellow} green={w.green} />
                </td>
                <td className="num">{w.red}</td>
                <td className="num">{w.yellow}</td>
                <td className="num">{w.green}</td>
                <td className="num">{w.paused}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted trend-note">
        {l(
          'Mỗi tuần tính theo màu ngày cuối của tuần (tuần này: đến hôm nay); chỉ các dự án đang chạy hoặc tạm dừng trong tuần đó.',
          '各週はその週の最終日の色で集計します（今週は今日まで）。その週に進行中または一時停止中だったプロジェクトのみです。',
        )}
      </p>
    </Section>
  );
}

function Changes({ title, changes, empty }: { title: string; changes: TrendChange[]; empty: string }) {
  return (
    <div>
      <h3 className="trend-sub">{title}</h3>
      {changes.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="trend-runs">
          {changes.map((c) => (
            <li key={c.id}>
              <Link to={`/projects/${c.id}`}>
                <b>{c.id}</b> · {c.name}
              </Link>
              <span className="nowrap">
                <HealthBadge health={c.from} /> → <HealthBadge health={c.to} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
