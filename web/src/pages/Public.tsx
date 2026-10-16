import { useEffect } from 'react';
import { api, useApi } from '../api';
import { Empty, ErrorBox, Kpi, LangSwitch, Section, TypeIcon, UrgencyBadge } from '../components/ui';
import { fmtDateTime, fmtDay, fmtDaysLeft } from '../format';
import { PRIORITY_LABEL, TYPE_LABEL } from '../labels';
import type { PublicDashboard } from '../types';
import { l } from '../i18n';

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
          <h1>{l('Tình hình dự án', 'プロジェクト状況')}</h1>
          {data && (
            <p className="muted">
              {l('Cập nhật lúc', '更新時刻')} {fmtDateTime(data.generatedAt)} · {l('tự làm mới mỗi phút', '1 分ごとに自動更新')}
            </p>
          )}
        </div>
        <div className="filters">
          <LangSwitch />
          <a className="btn" href="/login">
            {l('Đăng nhập', 'ログイン')}
          </a>
        </div>
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="kpis">
            <Kpi label={l('Dự án đang chạy', '進行中のプロジェクト')} value={data.counts.total} />
            <Kpi label={l('Khẩn cấp', '緊急')} value={data.counts.critical} tone="red" />
            <Kpi label={l('Cần chú ý', '要注意')} value={data.counts.attention} tone="yellow" />
            <Kpi label={l('Bình thường', '通常')} value={data.counts.normal} tone="green" />
          </div>
          <div className="grid-2">
            <Section title={l('Dự án khẩn cấp / cần chú ý', '緊急 / 要注意のプロジェクト')}>
              {data.projects.length === 0 ? (
                <Empty>{l('Không có dự án khẩn cấp 🎉', '緊急のプロジェクトはありません 🎉')}</Empty>
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
                            {l('Kế tiếp', '次の予定')}: {TYPE_LABEL[p.nextItem.type]} {fmtDay(p.nextItem.date)} – {p.nextItem.title}
                          </small>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={l('Mốc & sự kiện sắp tới', '近日のマイルストーン・イベント')}>
              {data.upcoming.length === 0 ? (
                <Empty>{l('Không có sự kiện sắp tới', '近日のイベントはありません')}</Empty>
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
                          {i.priority === 'high' ? ` · ${l('ưu tiên', '優先度')} ${PRIORITY_LABEL.high.toLowerCase()}` : ''}
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
