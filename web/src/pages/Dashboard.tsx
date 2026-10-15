import { Link, useSearchParams } from 'react-router';
import { useApi } from '../api';
import { Empty, ErrorBox, HealthBadge, HealthBar, Kpi, Section, TypeIcon, Warnings } from '../components/ui';
import { fmtDateTime, fmtDay, fmtDaysLeft, fmtHours } from '../format';
import { PRIORITY_LABEL } from '../labels';
import { useSession } from '../session';
import type { Dashboard as DashboardData, DashboardItem } from '../types';

export function Dashboard() {
  const { me, users, name } = useSession();
  const [params, setParams] = useSearchParams();
  // GL / PL / supporters start on "their" projects; PMO and managers on everything.
  const defaultScope = ['PL', 'GL', 'OTHER'].includes(me.role) ? 'mine' : 'all';
  const scope = params.get('scope') ?? defaultScope;
  const gl = params.get('gl') ?? '';
  const qs = new URLSearchParams({ scope, ...(gl ? { gl } : {}) }).toString();
  const { data, error, loading } = useApi<DashboardData>(`/dashboard?${qs}`);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const gls = users.filter((u) => u.role === 'GL');

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Tổng quan</h1>
        <div className="filters">
          <div className="segmented" role="group" aria-label="Phạm vi">
            <button className={scope === 'mine' ? 'active' : ''} onClick={() => set('scope', 'mine')}>
              Dự án của tôi
            </button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => set('scope', 'all')}>
              Tất cả
            </button>
          </div>
          <select value={gl} onChange={(e) => set('gl', e.target.value)} aria-label="Lọc theo GL">
            <option value="">Mọi GL</option>
            {gls.map((u) => (
              <option key={u.id} value={u.id}>
                GL {u.name}
              </option>
            ))}
          </select>
          {me.role !== 'OTHER' && (
            <Link className="btn btn-primary" to="/projects/new">
              ＋ Tạo dự án
            </Link>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <p className="loading">{loading ? 'Đang tải…' : ''}</p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Đang chạy" value={data.kpis.active} />
            <Kpi label="Đỏ" value={data.kpis.red} tone="red" />
            <Kpi label="Vàng" value={data.kpis.yellow} tone="yellow" />
            <Kpi label="Xanh" value={data.kpis.green} tone="green" />
            <Kpi label="⏰ Trễ cập nhật" value={data.kpis.lateUpdates} />
            <Kpi label="▲ Vấn đề ưu tiên cao" value={data.kpis.highIssues} />
            <Kpi label="⚠ Mục quá hạn" value={data.kpis.overdueItems} />
          </div>

          <Section title="Cần chú ý" extra={<span className="muted">Cập nhật lúc {fmtDateTime(data.generatedAt)}</span>}>
            {data.attention.length === 0 ? (
              <Empty>Không có dự án cần chú ý 🎉</Empty>
            ) : (
              <ul className="rows">
                {data.attention.map((p) => (
                  <li key={p.id} className="row">
                    <div className="row-main">
                      <div className="row-title">
                        <HealthBadge health={p.health} />
                        <Link to={`/projects/${p.id}`}>
                          <b>{p.id}</b> · {p.name}
                        </Link>
                        <span className="muted">
                          GL {name(p.gl)} · PL {name(p.pl)}
                        </span>
                      </div>
                      {p.latestSummary && <p className="row-text">{p.latestSummary}</p>}
                      {p.needHelp && <p className="row-text help">🙋 {p.needHelp}</p>}
                      <Warnings lateHours={p.lateHours} overdueItems={p.overdueItems} highIssues={p.highIssues} />
                    </div>
                    {p.nextItem && (
                      <div className="row-side">
                        <TypeIcon type={p.nextItem.type} /> {fmtDay(p.nextItem.date)}
                        <div className="muted">{p.nextItem.title}</div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid-2">
            <Section title={`Mốc & sự kiện ${data.upcomingDays} ngày tới`}>
              <ItemList items={data.upcoming} empty="Không có mốc / sự kiện sắp tới" />
            </Section>
            <Section title="Vấn đề cần xử lý">
              <ItemList items={data.priorityItems} empty="Không có vấn đề quá hạn, ưu tiên cao hay sắp tới hạn" />
            </Section>
          </div>

          <Section title="Chưa cập nhật kịp thời – cần nhắc">
            {data.lateUpdates.length === 0 ? (
              <Empty>Tất cả dự án đều cập nhật đúng hạn</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Dự án</th>
                      <th>Trễ</th>
                      <th>Cập nhật cuối</th>
                      <th>PL</th>
                      <th>GL</th>
                      <th>Hỗ trợ</th>
                      <th>Tần suất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lateUpdates.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link to={`/projects/${p.id}`}>
                            {p.id} · {p.name}
                          </Link>
                        </td>
                        <td className="warn-text nowrap">{fmtHours(p.lateHours)}</td>
                        <td className="nowrap">
                          {fmtDateTime(p.lastUpdateAt)} {p.lastUpdateBy && `· ${name(p.lastUpdateBy)}`}
                        </td>
                        <td>{name(p.pl)}</td>
                        <td>{name(p.gl)}</td>
                        <td>{p.supporters.map(name).join(', ') || '—'}</td>
                        <td className="num">{p.frequencyHours}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {data.byGl.length > 1 && (
            <Section title="Tình hình theo GL">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>GL</th>
                      <th className="bar-col">Trạng thái</th>
                      <th className="num">Đỏ</th>
                      <th className="num">Vàng</th>
                      <th className="num">Xanh</th>
                      <th className="num">Trễ CN</th>
                      <th className="num">Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byGl.map((r) => (
                      <tr key={r.gl}>
                        <td>
                          <button className="btn-link" onClick={() => set('gl', r.gl)} disabled={!r.gl}>
                            {r.gl ? name(r.gl) : '(chưa có GL)'}
                          </button>
                        </td>
                        <td className="bar-col">
                          <HealthBar red={r.red} yellow={r.yellow} green={r.green} />
                        </td>
                        <td className="num">{r.red}</td>
                        <td className="num">{r.yellow}</td>
                        <td className="num">{r.green}</td>
                        <td className="num">{r.late}</td>
                        <td className="num">{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="legend">
                <span>
                  <span className="dot tone-red" /> Đỏ
                </span>
                <span>
                  <span className="dot tone-yellow" /> Vàng
                </span>
                <span>
                  <span className="dot tone-green" /> Xanh
                </span>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function ItemList({ items, empty }: { items: DashboardItem[]; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="items">
      {items.map((i) => (
        <li key={i.id} className={i.overdue ? 'overdue' : ''}>
          <span className="item-date nowrap">
            {fmtDay(i.date)}
            <small className={i.overdue ? 'warn-text' : 'muted'}>{fmtDaysLeft(i.daysLeft)}</small>
          </span>
          <TypeIcon type={i.type} />
          <span className="item-main">
            <Link to={`/projects/${i.projectId}`}>{i.title}</Link>
            <small className="muted">
              {i.projectId} · {i.projectName} · ưu tiên {PRIORITY_LABEL[i.priority].toLowerCase()}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}
