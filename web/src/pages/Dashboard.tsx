import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, useApi } from '../api';
import { Empty, ErrorBox, HealthBadge, HealthBar, Kpi, Section, TypeIcon, useShowMore, Warnings } from '../components/ui';
import { fmtDateTime, fmtDay, fmtDaysLeft, fmtHours } from '../format';
import { ONLY_MINE, PRIORITY_LABEL } from '../labels';
import { useSession } from '../session';
import type { Dashboard as DashboardData, DashboardItem } from '../types';
import { l } from '../i18n';

/** Rows per list before "Xem thêm". */
const DASHBOARD_ROWS = 5;

export function Dashboard() {
  const { me, users, name } = useSession();
  const [params, setParams] = useSearchParams();
  // OTHER only gets the projects they take part in, so "mine" / "all" would be the same choice.
  const limited = me.role === 'OTHER';
  // GL / PL / supporters start on "their" projects; PMO and managers on everything.
  const defaultScope = ['PL', 'GL'].includes(me.role) ? 'mine' : 'all';
  const scope = limited ? 'all' : (params.get('scope') ?? defaultScope);
  const gl = params.get('gl') ?? '';
  const qs = new URLSearchParams({ scope, ...(gl ? { gl } : {}) }).toString();
  const { data, error, loading } = useApi<DashboardData>(`/dashboard?${qs}`);
  const attention = useShowMore(data?.attention ?? [], DASHBOARD_ROWS);
  const late = useShowMore(data?.lateUpdates ?? [], DASHBOARD_ROWS);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const gls = users.filter((u) => u.role === 'GL');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const exportExcel = async () => {
    setExporting(true);
    setExportError(undefined);
    try {
      await api.download('/export', `project-tracker-${new Date().toLocaleDateString('sv')}.xlsx`);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{l('Tổng quan', 'ダッシュボード')}</h1>
        <div className="filters">
          {limited ? (
            <span className="muted">{ONLY_MINE}</span>
          ) : (
            <div className="segmented" role="group" aria-label={l('Phạm vi', '対象範囲')}>
              <button className={scope === 'mine' ? 'active' : ''} onClick={() => set('scope', 'mine')}>
                {l('Dự án của tôi', '自分のプロジェクト')}
              </button>
              <button className={scope === 'all' ? 'active' : ''} onClick={() => set('scope', 'all')}>
                {l('Tất cả', 'すべて')}
              </button>
            </div>
          )}
          <select value={gl} onChange={(e) => set('gl', e.target.value)} aria-label={l('Lọc theo GL', 'GLで絞り込み')}>
            <option value="">{l('Mọi GL', 'すべての GL')}</option>
            {gls.map((u) => (
              <option key={u.id} value={u.id}>
                GL {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={exporting}
            onClick={exportExcel}
            title={l(
              'Tải file Excel: dự án, vấn đề / sự kiện / mốc, cập nhật 60 ngày gần nhất (những gì bạn được xem)',
              'Excel をダウンロード：プロジェクト、課題 / イベント / マイルストーン、直近 60 日の報告（閲覧できる範囲）',
            )}
          >
            ⬇ {exporting ? l('Đang xuất…', '出力中…') : l('Xuất Excel', 'Excel 出力')}
          </button>
          {me.role !== 'OTHER' && (
            <Link className="btn btn-primary" to="/projects/new">
              ＋ {l('Tạo dự án', 'プロジェクト作成')}
            </Link>
          )}
        </div>
      </div>
      <ErrorBox error={error ?? exportError} />
      {!data ? (
        <p className="loading">{loading ? l('Đang tải…', '読み込み中…') : ''}</p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={l('Đang chạy', '進行中')} value={data.kpis.active} />
            <Kpi label={l('Đỏ', '赤')} value={data.kpis.red} tone="red" />
            <Kpi label={l('Vàng', '黄')} value={data.kpis.yellow} tone="yellow" />
            <Kpi label={l('Xanh', '緑')} value={data.kpis.green} tone="green" />
            <Kpi label={l('⏰ Trễ cập nhật', '⏰ 報告遅れ')} value={data.kpis.lateUpdates} />
            <Kpi label={l('▲ Vấn đề ưu tiên cao', '▲ 優先度「高」の課題')} value={data.kpis.highIssues} />
            <Kpi label={l('⚠ Mục quá hạn', '⚠ 期限超過')} value={data.kpis.overdueItems} />
          </div>

          <Section
            title={l('Cần chú ý', '要注意')}
            extra={
              <span className="muted">
                {l('Cập nhật lúc', '更新時刻')} {fmtDateTime(data.generatedAt)}
              </span>
            }
          >
            {data.attention.length === 0 ? (
              <Empty>
                {l('Không có dự án cần chú ý 🎉', '要注意のプロジェクトはありません 🎉')}
                {limited && data.kpis.active === 0 && <> — {ONLY_MINE}</>}
              </Empty>
            ) : (
              <ul className="rows">
                {attention.visible.map((p) => (
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
            {attention.more}
          </Section>

          <div className="grid-2">
            <Section title={l(`Mốc & sự kiện ${data.upcomingDays} ngày tới`, `今後 ${data.upcomingDays} 日のマイルストーン・イベント`)}>
              <ItemList items={data.upcoming} empty={l('Không có mốc / sự kiện sắp tới', '近日のマイルストーン・イベントはありません')} />
            </Section>
            <Section title={l('Vấn đề cần xử lý', '対応が必要な課題')}>
              <ItemList
                items={data.priorityItems}
                empty={l('Không có vấn đề quá hạn, ưu tiên cao hay sắp tới hạn', '期限超過・優先度「高」・期限間近の課題はありません')}
              />
            </Section>
          </div>

          <Section title={l('Chưa cập nhật kịp thời – cần nhắc', '報告遅れ – 要リマインド')}>
            {data.lateUpdates.length === 0 ? (
              <Empty>{l('Tất cả dự án đều cập nhật đúng hạn', 'すべてのプロジェクトが期限内に報告しています')}</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{l('Dự án', 'プロジェクト')}</th>
                      <th>{l('Trễ', '遅れ')}</th>
                      <th>{l('Cập nhật cuối', '最終報告')}</th>
                      <th>PL</th>
                      <th>GL</th>
                      <th>{l('Hỗ trợ', 'サポーター')}</th>
                      <th>{l('Tần suất', '頻度')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {late.visible.map((p) => (
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
                {late.more}
              </div>
            )}
          </Section>

          {data.byGl.length > 1 && (
            <Section title={l('Tình hình theo GL', 'GL別状況')}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>GL</th>
                      <th className="bar-col">{l('Trạng thái', '状態')}</th>
                      <th className="num">{l('Đỏ', '赤')}</th>
                      <th className="num">{l('Vàng', '黄')}</th>
                      <th className="num">{l('Xanh', '緑')}</th>
                      <th className="num">{l('Trễ CN', '報告遅れ')}</th>
                      <th className="num">{l('Tổng', '合計')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byGl.map((r) => (
                      <tr key={r.gl}>
                        <td>
                          <button className="btn-link" onClick={() => set('gl', r.gl)} disabled={!r.gl}>
                            {r.gl ? name(r.gl) : l('(chưa có GL)', '（GL 未設定）')}
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
                  <span className="dot tone-red" /> {l('Đỏ', '赤')}
                </span>
                <span>
                  <span className="dot tone-yellow" /> {l('Vàng', '黄')}
                </span>
                <span>
                  <span className="dot tone-green" /> {l('Xanh', '緑')}
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
  const { visible, more } = useShowMore(items, DASHBOARD_ROWS);
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
      <ul className="items">
        {visible.map((i) => (
          <li key={i.id} className={i.overdue ? 'overdue' : ''}>
            <span className="item-date nowrap">
              {fmtDay(i.date)}
              <small className={i.overdue ? 'warn-text' : 'muted'}>{fmtDaysLeft(i.daysLeft)}</small>
            </span>
            <TypeIcon type={i.type} />
            <span className="item-main">
              <Link to={`/projects/${i.projectId}`}>{i.title}</Link>
              <small className="muted">
                {i.projectId} · {i.projectName} · {l('ưu tiên', '優先度')} {PRIORITY_LABEL[i.priority].toLowerCase()}
              </small>
            </span>
          </li>
        ))}
      </ul>
      {more}
    </>
  );
}
