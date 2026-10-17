// "My notifications": personal delivery (inbox, Telegram), events, watched projects, schedule, pause.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi } from '../api';
import { PersonalTest, TelegramLinkFields } from '../components/notify/TelegramLink';
import '../components/notify/notify.css';
import { PERSONAL_EVENT_INFO, savePrefs, type MyNotify, type MyPrefs } from '../components/notify/shared';
import { ErrorBox, HealthBadge, Section } from '../components/ui';
import { fmtDay, todayVN } from '../format';
import { l, lang, type Lang } from '../i18n';
import { LANG_LABEL, LANGS } from '../labels';
import type { ProjectView } from '../types';
import { ScheduleFields, type Timing } from './channels/ScheduleFields';

/**
 * Personal settings have no `quietHours` flag: quiet hours are on unless the schedule sets
 * equal from / to hours ("equal values = no quiet hours").
 */
function toTiming(schedule: MyPrefs['schedule']): Timing {
  const off = schedule?.quietFrom !== undefined && schedule.quietFrom === schedule.quietTo;
  return { quietHours: !off, schedule };
}
function fromTiming(t: Timing): MyPrefs['schedule'] {
  const { quietFrom, quietTo, ...rest } = t.schedule ?? {};
  const s = t.quietHours
    ? { ...rest, ...(quietFrom !== quietTo || quietFrom === undefined ? { quietFrom, quietTo } : {}) }
    : { ...rest, quietFrom: 0, quietTo: 0 };
  const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
  return Object.keys(clean).length ? clean : undefined;
}

/** "Paused until the end of <date>" is stored as the next midnight in Vietnam time. */
const pauseEnd = (date: string) => new Date(Date.parse(`${date}T00:00:00+07:00`) + 24 * 3600_000).toISOString();
const pauseDate = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.parse(iso) - 1)) : '';

export function MyNotifyPage() {
  const { data, error } = useApi<MyNotify>('/me/notify');
  const [saved, setSaved] = useState<MyPrefs>();
  const [draft, setDraft] = useState<MyPrefs>();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    if (data) {
      setSaved(data.prefs);
      setDraft(data.prefs);
    }
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !saved || !draft) return <p className="loading">{l('Đang tải…', '読み込み中…')}</p>;

  const set = (change: Partial<MyPrefs>) => {
    setNotice(undefined);
    setDraft({ ...draft, ...change });
  };
  /** Immediate actions (Telegram link, unwatch) update the saved settings and keep other draft edits. */
  const applied = (p: MyPrefs, keys: (keyof MyPrefs)[]) => {
    setSaved(p);
    setDraft((d) => (d ? { ...d, ...Object.fromEntries([...keys, 'updatedAt'].map((k) => [k, p[k as keyof MyPrefs]])) } : p));
  };
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const pausedDate = pauseDate(draft.pausedUntil);
  const pausedNow = !!saved.pausedUntil && Date.parse(saved.pausedUntil) > Date.now();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!saved || !draft) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const p = await savePrefs(saved, draft);
      setSaved(p);
      setDraft(p);
      setNotice(l('Đã lưu.', '保存しました。'));
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack narrow my-notify" onSubmit={submit}>
      <div className="page-head">
        <div>
          <h1>{l('Thông báo của tôi', '自分の通知')}</h1>
          <p className="muted">
            {l(
              'Tin gửi riêng cho bạn. Kênh cho cả nhóm nằm ở trang ',
              'あなた個人宛ての通知です。グループ向けのチャネルは',
            )}
            <Link to="/channels">{l('Kênh thông báo', '通知チャネル')}</Link>
            {l('.', 'ページで設定します。')}
          </p>
        </div>
        {pausedNow ? (
          <span className="badge tone-yellow">
            <span aria-hidden>▲</span> {l(`Tạm dừng đến hết ${fmtDay(pauseDate(saved.pausedUntil))}`, `${fmtDay(pauseDate(saved.pausedUntil))} まで一時停止中`)}
          </span>
        ) : (
          <span className="badge tone-green">
            <span aria-hidden>●</span> {l('Đang nhận', '受信中')}
          </span>
        )}
      </div>

      <Section title={l('Nơi nhận', '受信先')} extra={<PersonalTest />}>
        <div className="stack">
          <div className="notify-channel">
            <div className="notify-channel-head">
              <b>🔔 {l('Hộp thư web', 'Web の受信箱')}</b>
              <span className="badge tone-green">
                <span aria-hidden>●</span> {l('Luôn bật', '常にオン')}
              </span>
            </div>
            <p className="muted">
              {l('Mọi tin đều vào chuông 🔔 trên thanh trên cùng, giữ 60 ngày.', 'すべての通知は上部バーの 🔔 に届き、60 日間保存されます。')}
            </p>
          </div>
          <TelegramLinkFields
            prefs={saved}
            bot={data.telegramBot}
            telegram={draft.telegram}
            setTelegram={(telegram) => set({ telegram })}
            onLinked={(p) => applied(p, ['telegram', 'telegramLinked', 'telegramChatTitle', 'telegramBroken'])}
          />
        </div>
      </Section>

      <Section title={l('Loại tin', '通知の種類')}>
        <ul className="notify-events">
          {PERSONAL_EVENT_INFO.map(({ event, label, when }) => (
            <li key={event}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.events.includes(event)}
                  onChange={(e) =>
                    set({ events: e.target.checked ? [...draft.events, event] : draft.events.filter((x) => x !== event) })
                  }
                />
                <span>
                  <b>{label}</b>
                  <span className="notify-when muted">{when}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <WatchedProjects prefs={saved} onChange={(p) => applied(p, ['watch'])} />

      <Section title={l('Lịch', 'スケジュール')}>
        <div className="form">
          <ScheduleFields value={toTiming(draft.schedule)} onChange={(t) => set({ schedule: fromTiming(t) })} />
          <div className="notify-pause">
            <label>
              {l('Tạm dừng đến hết ngày', 'この日まで一時停止')}
              <input
                type="date"
                min={todayVN()}
                value={pausedDate}
                onChange={(e) => set({ pausedUntil: e.target.value ? pauseEnd(e.target.value) : undefined })}
              />
            </label>
            {draft.pausedUntil && (
              <button type="button" className="btn" onClick={() => set({ pausedUntil: undefined })}>
                {l('Bỏ tạm dừng', '一時停止を解除')}
              </button>
            )}
          </div>
          <p className="muted notify-when">
            {l(
              'Khi tạm dừng, không gửi Telegram và không thêm tin vào hộp thư cho đến hết ngày đã chọn (ví dụ khi nghỉ phép).',
              '一時停止中は、選んだ日の終わりまで Telegram にも受信箱にも通知しません（休暇中など）。',
            )}
          </p>
          <label>
            {l('Ngôn ngữ tin nhắn', 'メッセージの言語')}
            <select value={draft.lang ?? lang} onChange={(e) => set({ lang: e.target.value as Lang })}>
              {LANGS.map((k) => (
                <option key={k} value={k}>
                  {LANG_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      {notice && <div className="info-box">✓ {notice}</div>}
      <ErrorBox error={saveError} />
      <div className={`actions gap notify-save${dirty ? ' dirty' : ''}`}>
        <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
          {l('Huỷ thay đổi', '変更を取り消す')}
        </button>
        <button className="btn btn-primary" disabled={!dirty || busy}>
          {busy ? l('Đang lưu…', '保存中…') : l('Lưu', '保存')}
        </button>
      </div>
    </form>
  );
}

function WatchedProjects({ prefs, onChange }: { prefs: MyPrefs; onChange: (p: MyPrefs) => void }) {
  const { data } = useApi<{ projects: ProjectView[] }>('/projects');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const byId = new Map(data?.projects.map((p) => [p.id, p]));
  const options = data?.projects.filter((p) => !prefs.watch.includes(p.id)) ?? [];

  async function save(watch: string[]) {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await savePrefs(prefs, { watch }));
      setPick('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={l('⭐ Dự án theo dõi', '⭐ ウォッチ中のプロジェクト')}>
      <p className="muted notify-when">
        {l(
          'Nhận tin khi dự án theo dõi chuyển Đỏ, có vấn đề Cao mới hoặc đổi trạng thái (theo Loại tin ở trên). Bấm ☆ Theo dõi ở trang dự án để thêm.',
          'ウォッチ中のプロジェクトが「赤」になったとき、「高」の課題が追加されたとき、状態が変わったときに通知します（上の通知の種類に従う）。プロジェクト画面の ☆ ウォッチ でも追加できます。',
        )}
      </p>
      {prefs.watch.length ? (
        <ul className="rows notify-watch">
          {prefs.watch.map((id) => {
            const p = byId.get(id);
            return (
              <li key={id} className="row">
                <div className="row-main row-title">
                  <Link to={`/projects/${id}`}>
                    <b>{id}</b>
                    {p && ` · ${p.name}`}
                  </Link>
                  {p && <HealthBadge health={p.health} />}
                </div>
                <button type="button" className="btn" disabled={busy} onClick={() => save(prefs.watch.filter((x) => x !== id))}>
                  {l('Bỏ theo dõi', 'ウォッチ解除')}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">{l('Chưa theo dõi dự án nào.', 'ウォッチ中のプロジェクトはありません。')}</p>
      )}
      {options.length > 0 && (
        <div className="notify-pause">
          <label>
            {l('Thêm dự án', 'プロジェクトを追加')}
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">—</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" disabled={!pick || busy} onClick={() => save([...prefs.watch, pick])}>
            ☆ {l('Theo dõi', 'ウォッチ')}
          </button>
        </div>
      )}
      <ErrorBox error={error} />
    </Section>
  );
}

