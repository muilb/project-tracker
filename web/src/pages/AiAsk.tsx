import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AskMessage } from '../../../api/src/ai/ask';
import type { AskAnswer } from '../../../api/src/ai/assistant';
import { api, useApi } from '../api';
import { ErrorBox } from '../components/ui';
import { l } from '../i18n';
import type { ProjectView } from '../types';

type Turn = AskMessage & { truncated?: boolean };

const SUGGESTIONS = [
  l('Dự án nào đang Đỏ, vì sao?', '「赤」のプロジェクトはどれ？理由は？'),
  l('Tuần này và tuần sau có mốc, sự kiện gì?', '今週と来週のマイルストーン・イベントは？'),
  l('Dự án nào đang trễ cập nhật, cần nhắc ai?', '報告が遅れているプロジェクトは？誰にリマインドすべき？'),
  l('Viết báo cáo tình hình tuần này để gửi quản lý.', '今週の状況を上長向けの報告としてまとめて。'),
];
/** The API takes at most 20 messages; older turns are dropped first. */
const MAX_MESSAGES = 19;

/** Read-only questions about the data; the conversation lives only in this page. */
export function AskPanel() {
  const projects = useApi<{ projects: ProjectView[] }>('/projects?state=all&scope=all');
  const ids = new Set((projects.data?.projects ?? []).map((p) => p.id));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setText('');
    setBusy(true);
    setError(undefined);
    try {
      const messages = next.slice(-MAX_MESSAGES).map(({ role, content }) => ({ role, content }));
      const r = await api.post<AskAnswer>('/ai/ask', { messages });
      setTurns([...next, { role: 'assistant', content: r.answer, truncated: r.truncated }]);
    } catch (e) {
      // Take the question back so it can be re-sent.
      setTurns(turns);
      setText(q);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  // Enter sends on desktop; IME composition (Japanese) and phones keep Enter for the text.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    e.preventDefault();
    void send(text);
  }

  return (
    <div className="stack">
      <p className="muted">
        {l(
          'Hỏi bằng câu bình thường. AI đọc dữ liệu trong hệ thống (60 ngày gần nhất) để trả lời và không sửa gì. Số liệu chính thức xem ở trang Tổng quan.',
          '普段の言葉で質問できます。AI はシステムのデータ（直近 60 日）を読んで回答し、何も変更しません。正式な数値はダッシュボードで確認してください。',
        )}
      </p>

      {turns.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="btn" disabled={busy} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="chat" aria-live="polite">
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="chat-q">
                {t.content}
              </div>
            ) : (
              <div key={i} className="card chat-a">
                <Answer text={t.content} ids={ids} />
                {t.truncated && (
                  <small className="muted">{l('(Câu trả lời dài, đã bị cắt bớt)', '（回答が長いため途中で切れています）')}</small>
                )}
                <div className="chat-actions">
                  <button type="button" className="btn-link" onClick={() => navigator.clipboard?.writeText(t.content)}>
                    {l('Copy', 'コピー')}
                  </button>
                </div>
              </div>
            ),
          )}
          {busy && <p className="loading">{l('AI đang đọc dữ liệu…', 'AI がデータを確認中…')}</p>}
        </div>
      )}

      <ErrorBox error={error} />
      <form className="card form" onSubmit={submit}>
        <textarea
          ref={input}
          rows={2}
          required
          maxLength={4000}
          value={text}
          placeholder={turns.length ? l('Hỏi tiếp…', '続けて質問…') : SUGGESTIONS[0]}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="actions gap">
          {turns.length > 0 && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setTurns([]);
                setError(undefined);
              }}
            >
              {l('Cuộc hỏi mới', '新しい質問')}
            </button>
          )}
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? l('Đang hỏi…', '質問中…') : l('Hỏi', '質問')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Paragraphs and "- " lists, **bold**, and project codes linked to their page. */
function Answer({ text, ids }: { text: string; ids: Set<string> }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length}>
        {list.map((li, i) => (
          <li key={i}>
            <Inline text={li} ids={ids} />
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line)
      blocks.push(
        <p key={blocks.length}>
          <Inline text={line.replace(/^#+\s*/, '')} ids={ids} />
        </p>,
      );
  }
  flush();
  return <div className="answer">{blocks}</div>;
}

function Inline({ text, ids }: { text: string; ids: Set<string> }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <b key={i}>
            <Codes text={part.slice(2, -2)} ids={ids} />
          </b>
        ) : (
          <Codes key={i} text={part} ids={ids} />
        ),
      )}
    </>
  );
}

function Codes({ text, ids }: { text: string; ids: Set<string> }) {
  if (!ids.size) return <>{text}</>;
  const pattern = new RegExp(`\\b(${[...ids].map((id) => id.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`, 'g');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    out.push(text.slice(last, m.index));
    out.push(
      <Link key={m.index} to={`/projects/${m[1]}`}>
        {m[1]}
      </Link>,
    );
    last = m.index + m[1].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
