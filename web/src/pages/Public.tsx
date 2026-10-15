import { useEffect } from 'react';
import { api, useApi } from '../api';
import { Empty, ErrorBox, Kpi, Section, TypeIcon, UrgencyBadge } from '../components/ui';
import { fmtDateTime, fmtDay, fmtDaysLeft } from '../format';
import { PRIORITY_LABEL, TYPE_LABEL } from '../labels';
import type { PublicDashboard } from '../types';

/** Public, read-only status page. Refreshes every minute. */
export function PublicPage() {
  const { data, error, reload } = useApi<PublicDashboard>('/public', api.getPublic);
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <main className="container stack public">
      <div className="page-head">
        <div>
          <h1>Tình hình dự án</h1>
          {data && <p className="muted">Cập nhật lúc {fmtDateTime(data.generatedAt)} · tự làm mới mỗi phút</p>}
        </div>
        <a className="btn" href="/login">
          Đăng nhập
        </a>
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="kpis">
            <Kpi label="Dự án đang chạy" value={data.counts.total} />
            <Kpi label="Khẩn cấp" value={data.counts.critical} tone="red" />
            <Kpi label="Cần chú ý" value={data.counts.attention} tone="yellow" />
            <Kpi label="Bình thường" value={data.counts.normal} tone="green" />
          </div>
          <div className="grid-2">
            <Section title="Dự án khẩn cấp / cần chú ý">
              {data.projects.length === 0 ? (
                <Empty>Không có dự án khẩn cấp 🎉</Empty>
              ) : (
                <ul className="items">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <UrgencyBadge urgency={p.urgency} />
                      <span className="item-main">
                        <b>
                          {p.id} · {p.name}
                        </b>
                        {p.nextItem && (
                          <small className="muted">
                            Kế tiếp: {TYPE_LABEL[p.nextItem.type]} {fmtDay(p.nextItem.date)} – {p.nextItem.title}
                          </small>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Mốc & sự kiện sắp tới">
              {data.upcoming.length === 0 ? (
                <Empty>Không có sự kiện sắp tới</Empty>
              ) : (
                <ul className="items">
                  {data.upcoming.map((i, n) => (
                    <li key={n}>
                      <span className="item-date nowrap">
                        {fmtDay(i.date)}
                        <small className="muted">{fmtDaysLeft(i.daysLeft)}</small>
                      </span>
                      <TypeIcon type={i.type} />
                      <span className="item-main">
                        {i.title}
                        <small className="muted">
                          {i.projectId} · {i.projectName}
                          {i.priority === 'high' ? ` · ưu tiên ${PRIORITY_LABEL.high.toLowerCase()}` : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </main>
  );
}
