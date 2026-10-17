// ⭐ Watch / unwatch a project (project page header). Watched projects are in "My notifications".
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { l } from '../../i18n';
import { savePrefs, type MyNotify, type MyPrefs } from './shared';

export function WatchButton({ projectId }: { projectId: string }) {
  const [prefs, setPrefs] = useState<MyPrefs>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .get<MyNotify>('/me/notify')
      .then((r) => setPrefs(r.prefs))
      .catch(() => {});
  }, []);
  if (!prefs) return null;
  const watching = prefs.watch.includes(projectId);

  async function toggle() {
    if (!prefs) return;
    setBusy(true);
    setError(undefined);
    try {
      const watch = watching ? prefs.watch.filter((p) => p !== projectId) : [...prefs.watch, projectId];
      setPrefs(await savePrefs(prefs, { watch }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`btn watch-btn${watching ? ' watching' : ''}`}
      aria-pressed={watching}
      disabled={busy}
      onClick={toggle}
      title={
        error ??
        (watching
          ? l('Đang nhận thông báo của dự án này. Bấm để bỏ theo dõi.', 'このプロジェクトの通知を受信中。クリックでウォッチ解除。')
          : l('Nhận thông báo khi dự án chuyển Đỏ hoặc có vấn đề Cao mới.', '「赤」になったときや優先度「高」の課題が追加されたときに通知を受け取ります。'))
      }
    >
      <span aria-hidden>{watching ? '★' : '☆'}</span> {watching ? l('Đang theo dõi', 'ウォッチ中') : l('Theo dõi', 'ウォッチ')}
      {error && <span aria-hidden> ⚠</span>}
    </button>
  );
}
