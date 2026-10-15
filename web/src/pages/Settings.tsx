import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox } from '../components/ui';
import { useSession } from '../session';
import type { Settings } from '../types';

export function SettingsPage() {
  const { isAdmin } = useSession();
  const [s, setS] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ settings: Settings }>('/settings')
      .then((r) => setS(r.settings))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!isAdmin) return <ErrorBox error="Chỉ PMO / quản lý mới sửa cài đặt" />;
  if (!s) return error ? <ErrorBox error={error} /> : <p className="loading">Đang tải…</p>;

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    try {
      const r = await api.put<{ settings: Settings }>('/settings', s);
      setS(r.settings);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack narrow">
      <h1>Cài đặt</h1>
      <form className="card form" onSubmit={submit}>
        <fieldset>
          <legend>Tần suất cập nhật theo trạng thái (giờ)</legend>
          <div className="form-grid">
            {(['green', 'yellow', 'red'] as const).map((h) => (
              <label key={h}>
                {{ green: 'Xanh', yellow: 'Vàng', red: 'Đỏ' }[h]}
                <input
                  type="number"
                  min={1}
                  required
                  value={s.frequencyHours[h]}
                  onChange={(e) => setS({ ...s, frequencyHours: { ...s.frequencyHours, [h]: num(e.target.value) } })}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          <label>
            Cảnh báo "sắp tới" khi còn ≤ (ngày)
            <input type="number" min={0} required value={s.soonDays} onChange={(e) => setS({ ...s, soonDays: num(e.target.value) })} />
          </label>
          <label>
            Tần suất khi mốc / sự kiện sắp tới (giờ)
            <input
              type="number"
              min={1}
              required
              value={s.nearEventFrequencyHours}
              onChange={(e) => setS({ ...s, nearEventFrequencyHours: num(e.target.value) })}
            />
          </label>
          <label>
            Danh sách "sắp tới" trên dashboard (ngày)
            <input type="number" min={1} required value={s.upcomingDays} onChange={(e) => setS({ ...s, upcomingDays: num(e.target.value) })} />
          </label>
        </div>
        <ErrorBox error={error} />
        {saved && <div className="info-box">Đã lưu.</div>}
        <div className="actions">
          <button className="btn btn-primary">Lưu cài đặt</button>
        </div>
      </form>
    </div>
  );
}
