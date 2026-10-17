// When a channel (or, on "My notifications", a person) receives messages. Track D extends it.
import type { ChannelSchedule } from '../../../../api/src/types';
import { l } from '../../i18n';

export interface Timing {
  quietHours: boolean;
  schedule?: ChannelSchedule;
}

export function ScheduleFields({ value, onChange }: { value: Timing; onChange: (t: Timing) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value.quietHours} onChange={(e) => onChange({ ...value, quietHours: e.target.checked })} />{' '}
      {l(
        'Không gửi nhắc nhở từ 22h đến 7h (cảnh báo Đỏ và vấn đề Cao vẫn gửi ngay)',
        '夜間停止: 22:00〜07:00 はリマインドを送らない（「赤」と優先度「高」の課題は即時送信）',
      )}
    </label>
  );
}
