// Minimal Cognito client: calls the Cognito User Pools JSON API directly (no Amplify).
import { getConfig } from './config';

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
  NotAuthorizedException: 'Sai email hoặc mật khẩu',
  UserNotFoundException: 'Sai email hoặc mật khẩu',
  UserNotConfirmedException: 'Tài khoản chưa xác nhận email',
  UsernameExistsException: 'Email này đã được đăng ký',
  CodeMismatchException: 'Mã xác nhận không đúng',
  ExpiredCodeException: 'Mã xác nhận đã hết hạn, hãy gửi lại mã',
  InvalidPasswordException: 'Mật khẩu tối thiểu 8 ký tự, gồm chữ thường và số',
  InvalidParameterException: 'Thông tin không hợp lệ',
  LimitExceededException: 'Thử quá nhiều lần, vui lòng đợi một lúc',
  TooManyRequestsException: 'Thử quá nhiều lần, vui lòng đợi một lúc',
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
    const code = String(json.__type ?? 'Error').split('#').pop()!;
    throw new AuthError(code, MESSAGES[code] ?? json.message ?? 'Lỗi đăng nhập');
  }
  return json as T;
}

interface AuthResult {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
}

function store(email: string, r: AuthResult, refreshToken?: string) {
  const a = r.AuthenticationResult;
  if (!a) throw new AuthError('Challenge', 'Tài khoản cần thao tác thêm, hãy liên hệ PMO');
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
      if (!session.refreshToken) throw new AuthError('Expired', 'Phiên đăng nhập đã hết hạn');
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
