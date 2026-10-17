import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApi } from '../api';
import { Empty, ErrorBox, HealthBadge, TypeIcon, useShowMore, Warnings } from '../components/ui';
import { fmtDateTime, fmtDay } from '../format';
import { STATE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectView } from '../types';
import { l } from '../i18n';

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
  const { visible, more } = useShowMore(projects, 20);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{l('Dự án', 'プロジェクト')}</h1>
        <div className="filters">
          <input
            type="search"
            placeholder={l('Tìm mã, tên, khách hàng, người…', 'コード・名前・顧客・担当者で検索…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={state} onChange={(e) => set('state', e.target.value)} aria-label={l('Tình trạng', '状況')}>
            <option value="active">{STATE_LABEL.active}</option>
            <option value="paused">{STATE_LABEL.paused}</option>
            <option value="closed">{STATE_LABEL.closed}</option>
            <option value="all">{l('Tất cả', 'すべて')}</option>
          </select>
          <div className="segmented" role="group" aria-label={l('Phạm vi', '対象範囲')}>
            <button className={scope === 'mine' ? 'active' : ''} onClick={() => set('scope', 'mine')}>
              {l('Của tôi', '自分の')}
            </button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => set('scope', 'all')}>
              {l('Tất cả', 'すべて')}
            </button>
          </div>
          {me.role !== 'OTHER' && (
            <Link className="btn btn-primary" to="/projects/new">
              ＋ {l('Tạo dự án', 'プロジェクト作成')}
            </Link>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <section className="card">
        {loading && !data ? (
          <p className="loading">{l('Đang tải…', '読み込み中…')}</p>
        ) : projects.length === 0 ? (
          <Empty>{l('Không có dự án nào', 'プロジェクトはありません')}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>{l('Dự án', 'プロジェクト')}</th>
                  <th>{l('Trạng thái', '状態')}</th>
                  <th>GL / PL</th>
                  <th>{l('Tình hình mới nhất', '最新の状況')}</th>
                  <th>{l('Kế tiếp', '次の予定')}</th>
                  <th className="num">{l('VĐ mở', '未完了の課題')}</th>
                  <th>{l('Cập nhật cuối', '最終報告')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
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
                      {p.latestUpdate?.summary ?? <span className="muted">{l('Chưa có cập nhật', '報告なし')}</span>}
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
            {more}
          </div>
        )}
      </section>
    </div>
  );
}
