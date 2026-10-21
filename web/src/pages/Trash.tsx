import { useState } from 'react';
import { Link } from 'react-router';
import type { CommentTarget, ItemType } from '../../../api/src/types';
import { CommentText } from '../components/Comments';
import { api, useApi } from '../api';
import { Empty, ErrorBox, Section, TypeIcon, useShowMore } from '../components/ui';
import { fmtDateTime, fmtDay } from '../format';
import { l } from '../i18n';
import { TYPE_LABEL } from '../labels';
import { useSession } from '../session';

interface Deleted {
  deletedAt: string;
  deletedBy: string;
}
interface TrashData {
  projects: (Deleted & { id: string; name: string; customer?: string })[];
  items: (Deleted & { id: string; projectId: string; projectName?: string; type: ItemType; title: string; date: string })[];
  updates: (Deleted & { id: string; projectId: string; projectName?: string; at: string; author: string; summary: string })[];
  comments: (Deleted & {
    id: string;
    projectId: string;
    projectName?: string;
    target: CommentTarget;
    targetId: string;
    at: string;
    author: string;
    text: string;
  })[];
}

/** Soft-deleted projects, items, updates and comments (PMO / managers): look and restore. */
const TRASH_ROWS = 20;

export function TrashPage() {
  const { isAdmin, name } = useSession();
  const { data, error, reload } = useApi<TrashData>(isAdmin ? '/trash' : null);
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const projects = useShowMore(data?.projects ?? [], TRASH_ROWS);
  const items = useShowMore(data?.items ?? [], TRASH_ROWS);
  const updates = useShowMore(data?.updates ?? [], TRASH_ROWS);
  const comments = useShowMore(data?.comments ?? [], TRASH_ROWS);

  if (!isAdmin) return <ErrorBox error={l('Chỉ PMO / quản lý mới xem được thùng rác', 'ごみ箱は PMO / 管理者のみ利用できます')} />;

  async function restore(kind: 'project' | 'item' | 'update' | 'comment', projectId: string, id = '') {
    setNotice(undefined);
    setActionError(undefined);
    try {
      await api.post('/trash/restore', { kind, projectId, id });
      setNotice(l('Đã khôi phục.', '復元しました。'));
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  const by = (d: Deleted) => (
    <small className="muted">
      {l('Xoá bởi', '削除者')} {name(d.deletedBy)} · {fmtDateTime(d.deletedAt)}
    </small>
  );
  const restoreButton = (onClick: () => void) => (
    <button type="button" className="btn" onClick={onClick}>
      {l('Khôi phục', '復元')}
    </button>
  );

  return (
    <div className="stack narrow">
      <div className="page-head">
        <div>
          <Link to="/settings" className="muted">
            ← {l('Cài đặt', '設定')}
          </Link>
          <h1>🗑 {l('Thùng rác', 'ごみ箱')}</h1>
        </div>
      </div>
      <p className="muted">
        {l(
          'Những gì đã xoá được giữ lại ở đây và có thể khôi phục. Khôi phục dự án sẽ mang lại cả cập nhật, vấn đề / sự kiện / mốc và bình luận của nó.',
          '削除したものはここに残り、復元できます。プロジェクトを復元すると、その報告・課題 / イベント / マイルストーン・コメントも戻ります。',
        )}
      </p>
      {notice && <div className="info-box">{notice}</div>}
      <ErrorBox error={error ?? actionError} />
      {!data ? (
        <p className="loading">{l('Đang tải…', '読み込み中…')}</p>
      ) : (
        <>
          <Section title={`${l('Dự án', 'プロジェクト')} (${data.projects.length})`}>
            {data.projects.length === 0 ? (
              <Empty>{l('Không có dự án nào bị xoá', '削除されたプロジェクトはありません')}</Empty>
            ) : (
              <ul className="rows">
                {projects.visible.map((p) => (
                  <li key={p.id} className="row">
                    <div className="row-main">
                      <b>
                        {p.id} · {p.name}
                      </b>
                      {p.customer && <span className="muted"> · {p.customer}</span>}
                      <div>{by(p)}</div>
                    </div>
                    <div className="row-side">{restoreButton(() => restore('project', p.id))}</div>
                  </li>
                ))}
              </ul>
            )}
            {projects.more}
          </Section>

          <Section title={`${l('Vấn đề · Sự kiện · Mốc', '課題・イベント・マイルストーン')} (${data.items.length})`}>
            {data.items.length === 0 ? (
              <Empty>{l('Không có mục nào bị xoá', '削除された項目はありません')}</Empty>
            ) : (
              <ul className="rows">
                {items.visible.map((i) => (
                  <li key={i.id} className="row">
                    <div className="row-main">
                      <div className="row-title">
                        <TypeIcon type={i.type} /> {TYPE_LABEL[i.type]} · {fmtDay(i.date)}
                        <Link to={`/projects/${i.projectId}`}>
                          {i.projectId}
                          {i.projectName ? ` · ${i.projectName}` : ''}
                        </Link>
                      </div>
                      <p className="row-text">{i.title}</p>
                      {by(i)}
                    </div>
                    <div className="row-side">{restoreButton(() => restore('item', i.projectId, i.id))}</div>
                  </li>
                ))}
              </ul>
            )}
            {items.more}
          </Section>

          <Section title={`${l('Cập nhật tình hình', '状況報告')} (${data.updates.length})`}>
            {data.updates.length === 0 ? (
              <Empty>{l('Không có cập nhật nào bị xoá', '削除された報告はありません')}</Empty>
            ) : (
              <ul className="rows">
                {updates.visible.map((u) => (
                  <li key={u.id} className="row">
                    <div className="row-main">
                      <div className="row-title">
                        <span className="nowrap">{fmtDateTime(u.at)}</span>
                        <b>{name(u.author)}</b>
                        <Link to={`/projects/${u.projectId}`}>
                          {u.projectId}
                          {u.projectName ? ` · ${u.projectName}` : ''}
                        </Link>
                      </div>
                      <p className="row-text">{u.summary}</p>
                      {by(u)}
                    </div>
                    <div className="row-side">{restoreButton(() => restore('update', u.projectId, u.id))}</div>
                  </li>
                ))}
              </ul>
            )}
            {updates.more}
          </Section>

          <Section title={`${l('Bình luận', 'コメント')} (${data.comments.length})`}>
            {data.comments.length === 0 ? (
              <Empty>{l('Không có bình luận nào bị xoá', '削除されたコメントはありません')}</Empty>
            ) : (
              <ul className="rows">
                {comments.visible.map((c) => (
                  <li key={c.id} className="row">
                    <div className="row-main">
                      <div className="row-title">
                        <span className="nowrap">{fmtDateTime(c.at)}</span>
                        <b>{name(c.author)}</b>
                        <Link to={`/projects/${c.projectId}#${c.target}-${c.targetId}`}>
                          {c.projectId}
                          {c.projectName ? ` · ${c.projectName}` : ''}
                        </Link>
                      </div>
                      <CommentText text={c.text} />
                      {by(c)}
                    </div>
                    <div className="row-side">{restoreButton(() => restore('comment', c.projectId, c.id))}</div>
                  </li>
                ))}
              </ul>
            )}
            {comments.more}
          </Section>
        </>
      )}
    </div>
  );
}
