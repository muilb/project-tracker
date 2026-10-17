// When a channel (or, on "My notifications", a person) receives messages: quiet hours, weekends,
// digest, milestone reminders and a pause. Defaults mirror api/src/notify/policy.ts (resolveSchedule).
import type { ChannelSchedule } from '../../../../api/src/types';
import { l } from '../../i18n';

export interface Timing {
  /** Legacy switch (22:00–07:00); kept in sync with the schedule's quiet hours. */
  quietHours?: boolean;
  schedule?: ChannelSchedule;
  /** ISO time; null clears the pause when saved. */
  pausedUntil?: string | null;
}

const VN_OFFSET_MS = 7 * 3600_000;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const LEAD_CHOICES = [1, 2, 3, 7, 14];

/** The schedule with defaults; without `schedule` this is the legacy behaviour. */
export function resolveSchedule(t: Timing): Required<ChannelSchedule> {
  const s = t.schedule ?? {};
  const quiet = s.quietFrom !== undefined && s.quietTo !== undefined;
  return {
    quietFrom: quiet ? s.quietFrom! : t.quietHours ? 22 : 0,
    quietTo: quiet ? s.quietTo! : t.quietHours ? 7 : 0,
    skipWeekends: s.skipWeekends ?? false,
    digestHour: s.digestHour ?? 8,
    digestDays: s.digestDays ?? 'daily',
    milestoneLeadDays: s.milestoneLeadDays?.length ? s.milestoneLeadDays : [1],
  };
}

const hourLabel = (h: number) => l(`${h}h`, `${h}:00`);
/** YYYY-MM-DD in Vietnam time. */
const vnDate = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
/** "Paused through this day" = until 00:00 Vietnam time of the next day. */
const endOfVnDay = (date: string) => new Date(Date.parse(date) + 86_400_000 - VN_OFFSET_MS).toISOString();
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export function ScheduleFields({
  value,
  onChange,
  digest = true,
  milestones = true,
  pause = true,
  personal = false,
}: {
  value: Timing;
  onChange: (t: Timing) => void;
  /** Show the digest hour / days (group channels). */
  digest?: boolean;
  /** Show the milestone lead days (group channels). */
  milestones?: boolean;
  /** Show the pause date (off where the page has its own, as on "My notifications"). */
  pause?: boolean;
  /** Personal messages: during quiet hours immediate alerts reach 🔔 only, not Telegram / the browser. */
  personal?: boolean;
}) {
  const s = resolveSchedule(value);
  const quiet = s.quietFrom !== s.quietTo;
  const set = (patch: ChannelSchedule) => {
    const schedule = { ...s, ...patch };
    onChange({ ...value, schedule, quietHours: schedule.quietFrom !== schedule.quietTo });
  };
  const paused = value.pausedUntil && Date.parse(value.pausedUntil) > Date.now() ? vnDate(Date.parse(value.pausedUntil) - 1) : '';
  const toggleLead = (d: number, on: boolean) =>
    set({ milestoneLeadDays: (on ? [...s.milestoneLeadDays, d] : s.milestoneLeadDays.filter((x) => x !== d)).sort((a, b) => a - b) });

  return (
    <fieldset>
      <legend>{l('Lịch gửi', '送信スケジュール')}</legend>
      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={quiet}
            onChange={(e) => set(e.target.checked ? { quietFrom: 22, quietTo: 7 } : { quietFrom: 0, quietTo: 0 })}
          />{' '}
          {personal
            ? l(
                'Giờ yên lặng: nhắc việc chờ đến hết giờ yên lặng; tin ngay (Đỏ, vấn đề Cao…) vẫn vào 🔔 nhưng không gửi Telegram / trình duyệt',
                '夜間停止: リマインドは夜間停止の終了まで待ちます。即時の通知（「赤」、優先度「高」など）は 🔔 にのみ届き、Telegram・ブラウザには送りません',
              )
            : l(
                'Giờ yên lặng: không gửi nhắc nhở mỗi giờ (cảnh báo Đỏ và vấn đề Cao vẫn gửi ngay)',
                '夜間停止: 毎時のリマインドを送らない（「赤」と優先度「高」の課題は即時送信）',
              )}
        </label>
        {quiet && (
          <div className="form-grid">
            <label>
              {l('Từ', '開始')}
              <select value={s.quietFrom} onChange={(e) => set({ quietFrom: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {l('Đến', '終了')}
              <select value={s.quietTo} onChange={(e) => set({ quietTo: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={s.skipWeekends} onChange={(e) => set({ skipWeekends: e.target.checked })} />{' '}
          {l('Không gửi nhắc nhở và tóm tắt vào thứ 7, Chủ nhật', '土曜・日曜はリマインドとサマリーを送らない')}
        </label>

        {digest && (
          <div className="form-grid">
            <label>
              {l('Giờ gửi tóm tắt', 'サマリーの送信時刻')}
              <select value={s.digestHour} onChange={(e) => set({ digestHour: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {l('Kiểu tóm tắt', 'サマリーの種類')}
              <select value={s.digestDays} onChange={(e) => set({ digestDays: e.target.value as ChannelSchedule['digestDays'] })}>
                <option value="daily">{l('Hằng ngày', '毎日')}</option>
                <option value="weekdays">{l('Ngày làm việc (thứ 2 – thứ 6)', '平日（月〜金）')}</option>
                <option value="monday">{l('Tóm tắt tuần, sáng thứ 2', '週次サマリー（月曜）')}</option>
              </select>
            </label>
          </div>
        )}

        {milestones && (
          <div>
            <div className="muted">{l('Báo trước mốc / sự kiện (số ngày)', 'マイルストーン / イベントの事前通知（日数）')}</div>
            <div className="checks">
              {LEAD_CHOICES.map((d) => {
                const on = s.milestoneLeadDays.includes(d);
                return (
                  <label key={d} className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      // At least one lead day stays selected; turn the event off to stop reminders.
                      disabled={on && s.milestoneLeadDays.length === 1}
                      onChange={(e) => toggleLead(d, e.target.checked)}
                    />{' '}
                    {d === 1 ? l('1 ngày (ngày mai)', '1 日前（明日）') : l(`${d} ngày`, `${d} 日前`)}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {pause && (
          <div className="form-grid">
            <label>
              {l('Tạm dừng đến hết ngày', 'この日の終わりまで一時停止')}
              <input
                type="date"
                value={paused}
                min={vnDate(Date.now())}
                onChange={(e) => onChange({ ...value, pausedUntil: e.target.value ? endOfVnDay(e.target.value) : null })}
              />
            </label>
          </div>
        )}
        {pause && paused && (
          <div className="muted">
            ⏸{' '}
            {l(`Đang tạm dừng: không gửi tin nào đến hết ngày ${dm(paused)}.`, `一時停止中: ${dm(paused)} の終わりまで何も送信しません。`)}{' '}
            <button type="button" className="btn" onClick={() => onChange({ ...value, pausedUntil: null })}>
              {l('Bỏ tạm dừng', '一時停止を解除')}
            </button>
          </div>
        )}
      </div>
    </fieldset>
  );
}
