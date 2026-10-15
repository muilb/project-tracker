import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthError, auth } from '../auth';
import { ErrorBox } from '../components/ui';
import { getConfig } from '../config';

type Mode = 'signIn' | 'signUp' | 'confirm' | 'forgot' | 'reset';

const SAMPLE_USERS = [
  ['lan@example.com', 'Lan · PMO'],
  ['mng@example.com', 'MNG · Manager'],
  ['hung@example.com', 'Hùng · GL'],
  ['an@example.com', 'An · PL'],
];

export function Login() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const dev = getConfig().devAuth;
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      await fn();
    } catch (e) {
      if (e instanceof AuthError && e.code === 'UserNotConfirmedException') {
        await auth.resendCode(email).catch(() => {});
        setMode('confirm');
        setInfo('Tài khoản chưa xác nhận. Mã xác nhận mới đã được gửi tới email của bạn.');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const signIn = (e?: string) =>
    run(async () => {
      await auth.signIn(e ?? email, password);
      navigate(from, { replace: true });
    });

  function submit(ev: FormEvent) {
    ev.preventDefault();
    if (mode === 'signIn') return signIn();
    if (mode === 'signUp')
      return run(async () => {
        await auth.signUp(email, password, name);
        setMode('confirm');
        setInfo('Đã gửi mã xác nhận tới email của bạn.');
      });
    if (mode === 'confirm')
      return run(async () => {
        await auth.confirmSignUp(email, code);
        if (password) return signIn();
        setMode('signIn');
        setInfo('Xác nhận thành công, mời đăng nhập.');
      });
    if (mode === 'forgot')
      return run(async () => {
        await auth.forgotPassword(email);
        setMode('reset');
        setInfo('Đã gửi mã đặt lại mật khẩu tới email của bạn.');
      });
    return run(async () => {
      await auth.confirmForgotPassword(email, code, password);
      await signIn();
    });
  }

  const titles: Record<Mode, string> = {
    signIn: 'Đăng nhập',
    signUp: 'Đăng ký tài khoản',
    confirm: 'Xác nhận email',
    forgot: 'Quên mật khẩu',
    reset: 'Đặt lại mật khẩu',
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Theo dõi dự án</h1>
        <h2>{titles[mode]}</h2>

        {dev ? (
          <>
            <p className="muted">Chế độ chạy trên máy: chọn một người dùng mẫu hoặc nhập email.</p>
            <div className="sample-users">
              {SAMPLE_USERS.map(([e, label]) => (
                <button type="button" key={e} className="btn" onClick={() => signIn(e)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {info && <div className="info-box">{info}</div>}
        {mode === 'confirm' && (
          <p className="muted">
            Không nhận được email (kể cả trong Spam)? Báo PMO duyệt tài khoản của bạn trên trang Người dùng, sau đó quay lại{' '}
            <b>Đăng nhập</b> bằng email và mật khẩu vừa đặt.
          </p>
        )}
        <ErrorBox error={error} />

        <label>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'signUp' && (
          <label>
            Họ tên
            <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {(mode === 'confirm' || mode === 'reset') && (
          <label>
            Mã xác nhận (trong email)
            <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        )}
        {!dev && (mode === 'signIn' || mode === 'signUp' || mode === 'reset') && (
          <label>
            {mode === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu'}
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode !== 'signIn' && <small className="muted">Tối thiểu 8 ký tự, gồm chữ thường và số</small>}
          </label>
        )}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Đang xử lý…' : titles[mode]}
        </button>

        {!dev && (
          <div className="auth-links">
            {mode === 'signIn' ? (
              <>
                <button type="button" className="btn-link" onClick={() => setMode('signUp')}>
                  Đăng ký tài khoản
                </button>
                <button type="button" className="btn-link" onClick={() => setMode('forgot')}>
                  Quên mật khẩu?
                </button>
              </>
            ) : (
              <>
                {mode === 'confirm' && (
                  <button type="button" className="btn-link" onClick={() => run(() => auth.resendCode(email).then(() => setInfo('Đã gửi lại mã.')))}>
                    Gửi lại mã
                  </button>
                )}
                <button type="button" className="btn-link" onClick={() => setMode('signIn')}>
                  ← Quay lại đăng nhập
                </button>
              </>
            )}
          </div>
        )}
        <a className="btn-link public-link" href="/public">
          Xem trang tình hình dự án (public) →
        </a>
      </form>
    </div>
  );
}
