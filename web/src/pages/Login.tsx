import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthError, NewPasswordRequired, auth } from '../auth';
import { ErrorBox, LangSwitch } from '../components/ui';
import { l, lang } from '../i18n';
import { getConfig } from '../config';

type Mode = 'signIn' | 'signUp' | 'confirm' | 'forgot' | 'reset' | 'newPassword';

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
  const [challenge, setChallenge] = useState<string>(); // Cognito session for a new password
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
      if (e instanceof NewPasswordRequired) {
        setChallenge(e.session);
        setPassword('');
        setMode('newPassword');
        setInfo(
          l(
            'Bạn đang dùng mật khẩu tạm do PMO cấp. Hãy đặt mật khẩu mới để tiếp tục.',
            'PMO が発行した仮パスワードでログインしました。続けるには新しいパスワードを設定してください。',
          ),
        );
      } else if (e instanceof AuthError && e.code === 'UserNotConfirmedException') {
        await auth.resendCode(email).catch(() => {});
        setMode('confirm');
        setInfo(
          l(
            'Tài khoản chưa xác nhận. Mã xác nhận mới đã được gửi tới email của bạn.',
            'アカウントが未確認です。新しい確認コードをメールで送信しました。',
          ),
        );
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
        setInfo(l('Đã gửi mã xác nhận tới email của bạn.', '確認コードをメールで送信しました。'));
      });
    if (mode === 'confirm')
      return run(async () => {
        await auth.confirmSignUp(email, code);
        if (password) return signIn();
        setMode('signIn');
        setInfo(l('Xác nhận thành công, mời đăng nhập.', '確認が完了しました。ログインしてください。'));
      });
    if (mode === 'forgot')
      return run(async () => {
        await auth.forgotPassword(email);
        setMode('reset');
        setInfo(l('Đã gửi mã đặt lại mật khẩu tới email của bạn.', 'パスワード再設定コードをメールで送信しました。'));
      });
    if (mode === 'newPassword')
      return run(async () => {
        await auth.completeNewPassword(email, challenge!, password);
        navigate(from, { replace: true });
      });
    return run(async () => {
      await auth.confirmForgotPassword(email, code, password);
      await signIn();
    });
  }

  const titles: Record<Mode, string> = {
    signIn: l('Đăng nhập', 'ログイン'),
    signUp: l('Đăng ký tài khoản', '新規登録'),
    confirm: l('Xác nhận email', 'メール確認'),
    forgot: l('Quên mật khẩu', 'パスワードを忘れた場合'),
    reset: l('Đặt lại mật khẩu', 'パスワード再設定'),
    newPassword: l('Đặt mật khẩu mới', '新しいパスワードを設定'),
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{l('Theo dõi dự án', 'プロジェクト管理')}</h1>
        <h2>{titles[mode]}</h2>

        {dev ? (
          <>
            <p className="muted">
              {l(
                'Chế độ chạy trên máy: chọn một người dùng mẫu hoặc nhập email.',
                'ローカル実行モード：サンプルユーザーを選ぶか、メールを入力してください。',
              )}
            </p>
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
            {lang === 'ja' ? (
              <>
                メールが届かない場合（迷惑メールも確認）は、PMO に「ユーザー」画面でアカウントを承認してもらい、設定したメールとパスワードで
                <b>ログイン</b>してください。
              </>
            ) : (
              <>
                Không nhận được email (kể cả trong Spam)? Báo PMO duyệt tài khoản của bạn trên trang Người dùng, sau đó quay lại{' '}
                <b>Đăng nhập</b> bằng email và mật khẩu vừa đặt.
              </>
            )}
          </p>
        )}
        <ErrorBox error={error} />

        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            readOnly={mode === 'newPassword'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode === 'signUp' && (
          <label>
            {l('Họ tên', '氏名')}
            <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {(mode === 'confirm' || mode === 'reset') && (
          <label>
            {l('Mã xác nhận (trong email)', '確認コード（メール記載）')}
            <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        )}
        {!dev && (mode === 'signIn' || mode === 'signUp' || mode === 'reset' || mode === 'newPassword') && (
          <label>
            {mode === 'reset' || mode === 'newPassword' ? l('Mật khẩu mới', '新しいパスワード') : l('Mật khẩu', 'パスワード')}
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode !== 'signIn' && (
              <small className="muted">{l('Tối thiểu 8 ký tự, gồm chữ thường và số', '8 文字以上、英小文字と数字を含む')}</small>
            )}
          </label>
        )}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? l('Đang xử lý…', '処理中…') : titles[mode]}
        </button>

        {!dev && (
          <div className="auth-links">
            {mode === 'signIn' ? (
              <>
                <button type="button" className="btn-link" onClick={() => setMode('signUp')}>
                  {l('Đăng ký tài khoản', '新規登録')}
                </button>
                <button type="button" className="btn-link" onClick={() => setMode('forgot')}>
                  {l('Quên mật khẩu?', 'パスワードを忘れた場合')}
                </button>
              </>
            ) : (
              <>
                {mode === 'confirm' && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => run(() => auth.resendCode(email).then(() => setInfo(l('Đã gửi lại mã.', 'コードを再送信しました。'))))}
                  >
                    {l('Gửi lại mã', 'コードを再送信')}
                  </button>
                )}
                <button type="button" className="btn-link" onClick={() => setMode('signIn')}>
                  ← {l('Quay lại đăng nhập', 'ログインに戻る')}
                </button>
              </>
            )}
          </div>
        )}
        <a className="btn-link public-link" href="/help">
          {l('Người mới? Xem hướng dẫn sử dụng →', '初めての方へ：利用ガイドを見る →')}
        </a>
        <a className="btn-link public-link" href="/public">
          {l('Xem trang tình hình dự án (public) →', 'プロジェクト状況（公開ページ）を見る →')}
        </a>
        <div className="auth-lang">
          <LangSwitch />
        </div>
      </form>
    </div>
  );
}
