import { useEffect, useRef, useState } from 'react';
import { l, lang } from '../i18n';

// Web Speech API (Chrome / Android, Safari / iOS); not in TypeScript's DOM types.
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerCtor = new () => Recognizer;

const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
/** Voice input is offered on phones and tablets only. */
const touch = window.matchMedia('(pointer: coarse)').matches;

function errorText(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed')
    return l(
      'Chưa cho phép dùng micro — cấp quyền micro cho trình duyệt rồi thử lại.',
      'マイクが許可されていません。ブラウザにマイクの使用を許可してください。',
    );
  if (code === 'no-speech')
    return l('Không nghe thấy gì, bấm 🎤 và nói lại.', '音声が聞き取れませんでした。🎤 を押してもう一度話してください。');
  if (code === 'network') return l('Cần kết nối mạng để nhận giọng nói.', '音声入力にはネット接続が必要です。');
  return l('Không nhận được giọng nói, thử lại.', '音声を認識できませんでした。もう一度お試しください。');
}

/**
 * 🎤 button that dictates into a text field (Vietnamese or Japanese, following the UI language).
 * Each tap records one sentence and appends it; tap again while listening to stop.
 */
export function VoiceButton({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string>();
  const rec = useRef<Recognizer | null>(null);
  useEffect(() => () => rec.current?.abort(), []);
  if (!touch) return null;

  function start() {
    setMessage(undefined);
    if (!Recognition) {
      setMessage(
        l(
          'Trình duyệt này chưa hỗ trợ nhập giọng nói. Bấm vào ô nhập rồi dùng nút 🎤 trên bàn phím, hoặc mở trang bằng Chrome / Safari.',
          'このブラウザは音声入力に対応していません。入力欄を押してキーボードの 🎤 を使うか、Chrome / Safari で開いてください。',
        ),
      );
      return;
    }
    const r = new Recognition();
    r.lang = lang === 'ja' ? 'ja-JP' : 'vi-VN';
    r.continuous = false; // Android repeats results in continuous mode
    r.interimResults = true;
    const base = value && !/\s$/.test(value) ? `${value} ` : value;
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      onChange(base + said);
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setMessage(errorText(e.error));
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
    };
    rec.current = r;
    setListening(true);
    r.start();
  }

  return (
    <span className="voice">
      <button
        type="button"
        className={`btn voice-btn${listening ? ' listening' : ''}`}
        disabled={disabled}
        aria-pressed={listening}
        onClick={() => (listening ? rec.current?.stop() : start())}
      >
        {listening ? `■ ${l('Dừng', '停止')}` : `🎤 ${l('Nói', '音声入力')}`}
      </button>
      {listening && <small className="muted">{l('Đang nghe… nói xong sẽ tự dừng', '聞き取り中… 話し終えると自動で止まります')}</small>}
      {message && <small className="warn-text">{message}</small>}
    </span>
  );
}
