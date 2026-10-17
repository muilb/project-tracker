import { useState } from 'react';
import type { TestSample } from '../../../../api/src/notify/samples';
import { l } from '../../i18n';
import { SAMPLE_LABEL } from './shared';

/** "Gửi thử" with a choice of sample: real alert formats filled with the channel's current data. */
export function TestSender({ onSend }: { onSend: (sample: TestSample) => Promise<void> }) {
  const [sample, setSample] = useState<TestSample>('connect');
  const [busy, setBusy] = useState(false);
  return (
    <div className="test-sender">
      <select
        aria-label={l('Mẫu tin thử', 'テストメッセージの種類')}
        value={sample}
        onChange={(e) => setSample(e.target.value as TestSample)}
      >
        {(Object.keys(SAMPLE_LABEL) as TestSample[]).map((k) => (
          <option key={k} value={k}>
            {SAMPLE_LABEL[k]}
          </option>
        ))}
      </select>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onSend(sample);
          setBusy(false);
        }}
      >
        {busy ? l('Đang gửi…', '送信中…') : l('Gửi thử', 'テスト送信')}
      </button>
    </div>
  );
}
