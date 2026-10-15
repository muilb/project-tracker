import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApi } from '../api';
import { Empty, ErrorBox, HealthBadge, TypeIcon, Warnings } from '../components/ui';
import { fmtDateTime, fmtDay } from '../format';
import { STATE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectView } from '../types';

export function Projects() {
  const { me, name } = useSession();
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? 'active';
  const scope = params.get('scope') ?? 'all';
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi<{ projects: ProjectView[] }>(`/projects?state=${state}&scope=${scope}`);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  const needle = q.trim().toLowerCase();
  const projects = (data?.projects ?? []).filter(
    (p) => !needle || `${p.id} ${p.name} ${p.customer ?? ''} ${name(p.gl)} ${name(p.pl)}`.toLowerCase().includes(needle),
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dự án</h1>
        <div className="filters">
          <input type="search" placeholder="Tìm mã, tên, khách hàng, người…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={state} onChange={(e) => set('state', e.target.value)} aria-label="Tình trạng">
            <option value="active">{STATE_LABEL.active}</option>
            <option value="paused">{STATE_LABEL.paused}</option>
            <option value="closed">{STATE_LABEL.closed}</option>
            <option value="all">Tất cả</option>
          </select>
          <div className="segmented" role="group" aria-label="Phạm vi">
            <button className={scope === 'mine' ? 'active' : ''} onClick={() => set('scope', 'mine')}>
              Của tôi
            </button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => set('scope', 'all')}>
              Tất cả
            </button>
          </div>
          {me.role !== 'OTHER' && (
            <Link className="btn btn-primary" to="/projects/new">
              ＋ Tạo dự án
            </Link>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <section className="card">
        {loading && !data ? (
          <p className="loading">Đang tải…</p>
        ) : projects.length === 0 ? (
          <Empty>Không có dự án nào</Empty>
        ) : (
          <div className="table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Dự án</th>
                  <th>Trạng thái</th>
                  <th>GL / PL</th>
                  <th>Tình hình mới nhất</th>
                  <th>Kế tiếp</th>
                  <th className="num">VĐ mở</th>
                  <th>Cập nhật cuối</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/projects/${p.id}`}>
                        <b>{p.id}</b> · {p.name}
                      </Link>
                      {p.customer && <div className="muted">{p.customer}</div>}
                      {p.state !== 'active' && <div className="muted">{STATE_LABEL[p.state]}</div>}
                    </td>
                    <td>
                      <HealthBadge health={p.health} />
                    </td>
                    <td className="nowrap">
                      {name(p.gl)}
                      <div className="muted">{name(p.pl)}</div>
                    </td>
                    <td className="summary-cell">
                      {p.latestUpdate?.summary ?? <span className="muted">Chưa có cập nhật</span>}
                      <Warnings lateHours={p.lateHours} overdueItems={p.overdueItems} highIssues={p.highIssues} />
                    </td>
                    <td className="nowrap">
                      {p.nextItem ? (
                        <>
                          <TypeIcon type={p.nextItem.type} /> {fmtDay(p.nextItem.date)}
                          <div className="muted ellipsis">{p.nextItem.title}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{p.openIssues}</td>
                    <td className="nowrap">
                      {fmtDateTime(p.lastOwnerUpdate?.at)}
                      <div className="muted">{p.lastOwnerUpdate ? name(p.lastOwnerUpdate.author) : ''}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
