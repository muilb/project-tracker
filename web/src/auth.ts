// Minimal Cognito client: calls the Cognito User Pools JSON API directly (no Amplify).
import { getConfig } from './config';
import { l } from './i18n';

interface Session {
  email: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // ms epoch
}

const KEY = 'pt.session';

function load(): Session | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : undefined;
  } catch {
    return undefined;
  }
}

let session: Session | undefined = load();

function save(s: Session | undefined) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable (private mode): keep the session in memory only
  }
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  NotAuthorizedException: l('Sai email hoặc mật khẩu', 'メールまたはパスワードが違います'),
  UserNotFoundException: l('Sai email hoặc mật khẩu', 'メールまたはパスワードが違います'),
  UserNotConfirmedException: l('Tài khoản chưa xác nhận email', 'メールアドレスが未確認です'),
  UsernameExistsException: l('Email này đã được đăng ký', 'このメールアドレスは登録済みです'),
  CodeMismatchException: l('Mã xác nhận không đúng', '確認コードが違います'),
  ExpiredCodeException: l('Mã xác nhận đã hết hạn, hãy gửi lại mã', '確認コードの有効期限が切れました。再送信してください'),
  InvalidPasswordException: l(
    'Mật khẩu tối thiểu 8 ký tự, gồm chữ thường và số',
    'パスワードは 8 文字以上で、英小文字と数字を含めてください',
  ),
  InvalidParameterException: l('Thông tin không hợp lệ', '入力内容が正しくありません'),
  LimitExceededException: l('Thử quá nhiều lần, vui lòng đợi một lúc', '試行回数が多すぎます。しばらく待ってください'),
  TooManyRequestsException: l('Thử quá nhiều lần, vui lòng đợi một lúc', '試行回数が多すぎます。しばらく待ってください'),
};

async function cognito<T>(action: string, body: object): Promise<T> {
  const { region, userPoolClientId } = getConfig();
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify({ ClientId: userPoolClientId, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(json.__type ?? 'Error')
      .split('#')
      .pop()!;
    throw new AuthError(code, MESSAGES[code] ?? json.message ?? l('Lỗi đăng nhập', 'ログインエラー'));
  }
  return json as T;
}

interface AuthResult {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
  ChallengeName?: string;
  Session?: string;
}

/** Signed in with a temporary password set by PMO / MNG: a new password must be chosen. */
export class NewPasswordRequired extends Error {
  constructor(readonly session: string) {
    super('NEW_PASSWORD_REQUIRED');
  }
}

function store(email: string, r: AuthResult, refreshToken?: string) {
  const a = r.AuthenticationResult;
  if (!a)
    throw new AuthError(
      'Challenge',
      l('Tài khoản cần thao tác thêm, hãy liên hệ PMO', 'アカウントに追加の操作が必要です。PMO に連絡してください'),
    );
  save({ email, idToken: a.IdToken, refreshToken: a.RefreshToken ?? refreshToken, expiresAt: Date.now() + a.ExpiresIn * 1000 });
}

export const auth = {
  email: () => session?.email,
  isSignedIn: () => !!session,

  async signIn(email: string, password: string) {
    email = email.trim().toLowerCase();
    if (getConfig().devAuth) return save({ email, idToken: '', expiresAt: Infinity });
    const r = await cognito<AuthResult>('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED' && r.Session) throw new NewPasswordRequired(r.Session);
    store(email, r);
  },

  /** Answers the NEW_PASSWORD_REQUIRED challenge and signs in. */
  async completeNewPassword(email: string, session: string, newPassword: string) {
    email = email.trim().toLowerCase();
    const r = await cognito<AuthResult>('RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: session,
      ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
    });
    store(email, r);
  },

  signUp: (email: string, password: string, name: string) =>
    cognito('SignUp', {
      Username: email.trim().toLowerCase(),
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email.trim().toLowerCase() },
        { Name: 'name', Value: name.trim() },
      ],
    }),
  confirmSignUp: (email: string, code: string) =>
    cognito('ConfirmSignUp', { Username: email.trim().toLowerCase(), ConfirmationCode: code.trim() }),
  resendCode: (email: string) => cognito('ResendConfirmationCode', { Username: email.trim().toLowerCase() }),
  forgotPassword: (email: string) => cognito('ForgotPassword', { Username: email.trim().toLowerCase() }),
  confirmForgotPassword: (email: string, code: string, password: string) =>
    cognito('ConfirmForgotPassword', { Username: email.trim().toLowerCase(), ConfirmationCode: code.trim(), Password: password }),

  signOut: () => save(undefined),

  /** Headers for API calls; refreshes the ID token shortly before it expires. */
  async headers(): Promise<Record<string, string>> {
    if (!session) return {};
    if (getConfig().devAuth) return { 'x-dev-user': session.email };
    if (session.expiresAt - Date.now() < 60_000) {
      if (!session.refreshToken) throw new AuthError('Expired', l('Phiên đăng nhập đã hết hạn', 'ログインの有効期限が切れました'));
      try {
        const r = await cognito<AuthResult>('InitiateAuth', {
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: session.refreshToken },
        });
        store(session.email, r, session.refreshToken);
      } catch (e) {
        save(undefined);
        throw e;
      }
    }
    return { Authorization: session!.idToken };
  },
};
