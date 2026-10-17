// "My notifications": personal delivery (inbox, Telegram), events, watched projects, schedule.
// Track B builds the page; F0 only reserves the route (no menu link yet).
import { l } from '../i18n';

export function MyNotifyPage() {
  return (
    <div className="stack narrow">
      <h1>{l('Thông báo của tôi', '自分の通知')}</h1>
    </div>
  );
}
