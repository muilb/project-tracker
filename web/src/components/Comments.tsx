// Comments under an update or an item, with @mentions: typing "@" lists people, picking one writes
// "@Name" in the box and `@{<user id>}` in the saved text (api/src/mentions.ts).
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { mentionIds } from '../../../api/src/mentions';
import type { Comment, CommentTarget, User } from '../../../api/src/types';
import { api } from '../api';
import { fmtDateTime } from '../format';
import { l } from '../i18n';
import { ROLE_LABEL } from '../labels';
import { useSession } from '../session';
import { ErrorBox } from './ui';

/** The author edits / deletes within this many hours (DELETE_UPDATE_HOURS in the API). */
const OWN_HOURS = 24;
/** Characters of one comment (COMMENT_MAX in the API). */
const MAX = 2000;
const SUGGESTIONS = 6;
const TOKEN = /@\{([^{}\s]{1,200})\}|(https?:\/\/[^\s<>"]+)/g;

/** Key of a thread, also the page anchor that notifications link to: `update-<id>`, `item-<id>`. */
export const threadKey = (target: CommentTarget, targetId: string) => `${target}-${targetId}`;

/** Comments grouped by thread, oldest first. */
export function groupComments(comments: Comment[]) {
  const out = new Map<string, Comment[]>();
  for (const c of comments) {
    const key = threadKey(c.target, c.targetId);
    out.set(key, [...(out.get(key) ?? []), c]);
  }
  return out;
}

/** The text as written: mentions as @Name, links clickable, line breaks kept (CSS). */
export function CommentText({ text }: { text: string }) {
  const { name } = useSession();
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    let [whole] = m;
    if (m[2]) whole = whole.replace(/[.,;:!?)\]]+$/, ''); // "(see https://x.y)." → the link without ")."
    parts.push(text.slice(at, m.index));
    parts.push(
      m[1] ? (
        <span key={m.index} className="mention">
          @{name(m[1])}
        </span>
      ) : (
        <a key={m.index} href={whole} target="_blank" rel="noopener noreferrer">
          {whole}
        </a>
      ),
    );
    at = m.index + whole.length;
  }
  parts.push(text.slice(at));
  return <p className="comment-text">{parts}</p>;
}

export function CommentToggle({ count, open, onClick, compact }: { count: number; open: boolean; onClick: () => void; compact?: boolean }) {
  const label = count ? l(`Bình luận (${count})`, `コメント（${count}）`) : l('Bình luận', 'コメント');
  return (
    <button type="button" className="btn-link comment-toggle" aria-expanded={open} aria-label={label} onClick={onClick}>
      💬 {compact ? count || '' : label}
    </button>
  );
}

/** The comments of one thread and a box to add one. */
export function CommentThread({
  projectId,
  target,
  targetId,
  updateAt,
  comments,
  onChanged,
}: {
  projectId: string;
  target: CommentTarget;
  targetId: string;
  updateAt?: string;
  comments: Comment[];
  onChanged: () => void;
}) {
  const { me, isAdmin, name } = useSession();
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const now = Date.now();
  const own = (c: Comment) => c.author === me.id && now - Date.parse(c.at) < OWN_HOURS * 3600_000;

  /** Saves, then says who was mentioned but cannot see the project (they are not told). */
  async function save(call: () => Promise<{ notVisible: string[] }>) {
    setError(undefined);
    setNotice(undefined);
    try {
      const { notVisible } = await call();
      if (notVisible.length)
        setNotice(
          l(
            `${notVisible.map(name).join(', ')} không xem được dự án này nên không nhận được thông báo.`,
            `${notVisible.map(name).join('、')} さんはこのプロジェクトを閲覧できないため、通知は届きません。`,
          ),
        );
      setEditing(undefined);
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function remove(c: Comment) {
    if (!confirm(l('Xoá bình luận này?', 'このコメントを削除しますか？'))) return;
    setError(undefined);
    try {
      await api.del(`/projects/${projectId}/comments/${c.id}`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="comments">
      {comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="comment-head">
                <b>{name(c.author)}</b>
                <span className="muted">{ROLE_LABEL[c.authorRole]}</span>
                <span className="muted nowrap">{fmtDateTime(c.at)}</span>
                {c.editedAt && (
                  <span className="muted" title={fmtDateTime(c.editedAt)}>
                    {l('(đã sửa)', '（編集済み）')}
                  </span>
                )}
                {own(c) && editing !== c.id && (
                  <button type="button" className="btn-link" aria-label={l('Sửa bình luận', 'コメントを編集')} onClick={() => setEditing(c.id)}>
                    {l('Sửa', '編集')}
                  </button>
                )}
                {(own(c) || isAdmin) && (
                  <button type="button" className="btn-link danger-link" aria-label={l('Xoá bình luận', 'コメントを削除')} onClick={() => remove(c)}>
                    {l('Xoá', '削除')}
                  </button>
                )}
              </div>
              {editing === c.id ? (
                <CommentBox
                  initial={c.text}
                  submitLabel={l('Lưu', '保存')}
                  onCancel={() => setEditing(undefined)}
                  onSubmit={(text) => save(() => api.patch(`/projects/${projectId}/comments/${c.id}`, { text }))}
                />
              ) : (
                <CommentText text={c.text} />
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="info-box">{notice}</p>}
      <ErrorBox error={error} />
      {!editing && (
        <CommentBox
          submitLabel={l('Gửi', '送信')}
          onSubmit={(text) => save(() => api.post(`/projects/${projectId}/comments`, { target, targetId, updateAt, text }))}
        />
      )}
    </div>
  );
}

/** Names shown after "@": the name, plus the start of the email when two people share it. */
function labels(users: User[]) {
  const count = new Map<string, number>();
  for (const u of users) count.set(u.name, (count.get(u.name) ?? 0) + 1);
  return new Map(users.map((u) => [u.id, count.get(u.name)! > 1 ? `${u.name} (${u.id.split('@')[0]})` : u.name]));
}

/** Lower case without accents: "Bình" is found by "binh". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** A text box where "@" suggests people. Saved text has `@{id}` for every mention picked. */
function CommentBox({
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { users } = useSession();
  const names = labels(users);
  // Shown with @Name; `picked` remembers which name stands for whom.
  const [text, setText] = useState(() => initial.replace(/@\{([^{}\s]{1,200})\}/g, (_, id: string) => `@${names.get(id) ?? id}`));
  const [picked, setPicked] = useState<{ label: string; id: string }[]>(() =>
    mentionIds(initial).map((id) => ({ id, label: names.get(id) ?? id })),
  );
  const [query, setQuery] = useState<{ start: number; text: string }>();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  // A word of the name or the email starts with what was typed: "@hu" finds Hùng, not Phúc.
  const matches = query
    ? users
        .filter((u) => fold(`${names.get(u.id)} ${u.id}`).split(/[\s@.()_-]+/).some((w) => w.startsWith(fold(query.text))))
        .slice(0, SUGGESTIONS)
    : [];

  /** The "@…" being typed right before the caret, if any. */
  function findQuery(value: string, caret: number) {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setQuery(m ? { start: caret - m[2].length - 1, text: m[2] } : undefined);
    setActive(0);
  }
  function pick(u: User) {
    if (!query) return;
    const label = names.get(u.id)!;
    const end = query.start + 1 + query.text.length;
    const next = `${text.slice(0, query.start)}@${label} ${text.slice(end)}`;
    setText(next);
    setPicked((p) => [...p.filter((x) => x.id !== u.id), { label, id: u.id }]);
    setQuery(undefined);
    const caret = query.start + label.length + 2;
    setTimeout(() => box.current?.setSelectionRange(caret, caret));
    box.current?.focus();
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(undefined);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  }
  async function submit() {
    if (!text.trim() || busy) return;
    // Longest names first, so "@An Bình" is not taken for "@An".
    let saved = text;
    for (const p of [...picked].sort((a, b) => b.label.length - a.label.length)) saved = saved.split(`@${p.label}`).join(`@{${p.id}}`);
    setBusy(true);
    const ok = await onSubmit(saved.trim());
    setBusy(false);
    if (ok && !onCancel) {
      setText('');
      setPicked([]);
    }
  }

  return (
    <div className="comment-box">
      <textarea
        ref={box}
        rows={2}
        maxLength={MAX}
        value={text}
        placeholder={l('Viết bình luận… gõ @ để gọi tên', 'コメントを入力… @ で名前を呼べます')}
        aria-label={l('Bình luận', 'コメント')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          findQuery(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(undefined), 150)}
      />
      {matches.length > 0 && (
        <ul className="mention-list" role="listbox" id={listId} aria-label={l('Gọi tên', 'メンション')}>
          {matches.map((u, i) => (
            <li
              key={u.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep the focus in the box
                pick(u);
              }}
            >
              <b>{names.get(u.id)}</b> <span className="muted">{ROLE_LABEL[u.role]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="comment-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
          {busy ? l('Đang gửi…', '送信中…') : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {l('Huỷ', 'キャンセル')}
          </button>
        )}
        <small className="muted">{l('Ctrl + Enter để gửi', 'Ctrl + Enter で送信')}</small>
      </div>
    </div>
  );
}
