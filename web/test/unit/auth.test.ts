// The Cognito client, against a fake Cognito endpoint (production config, no dev auth).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  getConfig: () => ({ apiUrl: 'https://api.example.com', region: 'ap-southeast-1', userPoolClientId: 'client-1' }),
}));

import { auth, AuthError, NewPasswordRequired } from '../../src/auth';

const ENDPOINT = 'https://cognito-idp.ap-southeast-1.amazonaws.com/';
const T0 = new Date('2026-10-09T02:00:00Z');
const tokens = (id: string, refresh?: string) => ({
  AuthenticationResult: { IdToken: id, ExpiresIn: 3600, ...(refresh ? { RefreshToken: refresh } : {}) },
});

/** Answers by Cognito action; records each call as { action, body }. */
let answers: Record<string, () => Response>;
let calls: { action: string; body: Record<string, unknown> }[];
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const fail = (type: string, message = '') => () => new Response(JSON.stringify({ __type: type, message }), { status: 400 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  answers = {};
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe(ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-amz-json-1.1');
    const action = headers['X-Amz-Target'].replace('AWSCognitoIdentityProviderService.', '');
    calls.push({ action, body: JSON.parse(String(init.body)) });
    const answer = answers[action];
    if (!answer) throw new Error(`unexpected ${action}`);
    return answer();
  });
  auth.signOut();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sign-in', () => {
  it('password sign-in; the ID token goes on API calls and survives a reload', async () => {
    answers.InitiateAuth = ok(tokens('id-1', 'refresh-1'));
    await auth.signIn('  Lan@Example.COM ', 'secret123');
    expect(calls).toEqual([
      {
        action: 'InitiateAuth',
        body: {
          ClientId: 'client-1',
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: 'lan@example.com', PASSWORD: 'secret123' },
        },
      },
    ]);
    expect(auth.email()).toBe('lan@example.com');
    expect(await auth.headers()).toEqual({ Authorization: 'id-1' });

    vi.resetModules();
    const reloaded = (await import('../../src/auth')).auth;
    expect(reloaded.isSignedIn()).toBe(true);
    expect(await reloaded.headers()).toEqual({ Authorization: 'id-1' });
  });

  it('Cognito errors become messages in the user language', async () => {
    answers.InitiateAuth = fail('com.amazonaws.cognito#NotAuthorizedException', 'Incorrect username or password.');
    const e = await auth.signIn('lan@example.com', 'wrong').catch((err) => err);
    expect(e).toBeInstanceOf(AuthError);
    expect(e).toMatchObject({ code: 'NotAuthorizedException', message: 'Sai email hoặc mật khẩu' });
    expect(auth.isSignedIn()).toBe(false);

    answers.InitiateAuth = fail('SomethingNewException', 'Raw Cognito text');
    await expect(auth.signIn('lan@example.com', 'x')).rejects.toMatchObject({ code: 'SomethingNewException', message: 'Raw Cognito text' });
  });

  it('a temporary password asks for a new one, then signs in', async () => {
    answers.InitiateAuth = ok({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'challenge-1' });
    const e = await auth.signIn('an@example.com', 'Temp1234').catch((err) => err);
    expect(e).toBeInstanceOf(NewPasswordRequired);
    expect(e.session).toBe('challenge-1');
    expect(auth.isSignedIn()).toBe(false);

    answers.RespondToAuthChallenge = ok(tokens('id-2', 'refresh-2'));
    await auth.completeNewPassword('An@example.com', 'challenge-1', 'newpass99');
    expect(calls.at(-1)).toEqual({
      action: 'RespondToAuthChallenge',
      body: {
        ClientId: 'client-1',
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'challenge-1',
        ChallengeResponses: { USERNAME: 'an@example.com', NEW_PASSWORD: 'newpass99' },
      },
    });
    expect(await auth.headers()).toEqual({ Authorization: 'id-2' });
  });

  it('any other challenge is refused instead of half signing in', async () => {
    answers.InitiateAuth = ok({ ChallengeName: 'SMS_MFA', Session: 's' });
    await expect(auth.signIn('an@example.com', 'x')).rejects.toMatchObject({ code: 'Challenge' });
    expect(auth.isSignedIn()).toBe(false);
  });

  it('sign-up, confirmation and password reset send trimmed, lower-case emails', async () => {
    for (const a of ['SignUp', 'ConfirmSignUp', 'ResendConfirmationCode', 'ForgotPassword', 'ConfirmForgotPassword']) answers[a] = ok({});
    await auth.signUp(' Thao@Example.com', 'pass1234', ' Thảo ');
    await auth.confirmSignUp('Thao@Example.com', ' 123456 ');
    await auth.resendCode('Thao@Example.com');
    await auth.forgotPassword('Thao@Example.com');
    await auth.confirmForgotPassword('Thao@Example.com', '654321 ', 'pass5678');
    expect(calls.map((c) => c.body)).toEqual([
      {
        ClientId: 'client-1',
        Username: 'thao@example.com',
        Password: 'pass1234',
        UserAttributes: [
          { Name: 'email', Value: 'thao@example.com' },
          { Name: 'name', Value: 'Thảo' },
        ],
      },
      { ClientId: 'client-1', Username: 'thao@example.com', ConfirmationCode: '123456' },
      { ClientId: 'client-1', Username: 'thao@example.com' },
      { ClientId: 'client-1', Username: 'thao@example.com' },
      { ClientId: 'client-1', Username: 'thao@example.com', ConfirmationCode: '654321', Password: 'pass5678' },
    ]);
  });
});

describe('token refresh', () => {
  beforeEach(async () => {
    answers.InitiateAuth = ok(tokens('id-1', 'refresh-1'));
    await auth.signIn('lan@example.com', 'secret123');
    calls = [];
  });

  it('refreshes a minute before expiry and keeps the refresh token', async () => {
    vi.setSystemTime(T0.getTime() + 58 * 60_000);
    expect(await auth.headers()).toEqual({ Authorization: 'id-1' });
    expect(calls).toEqual([]);

    // Cognito does not send a new refresh token on refresh.
    answers.InitiateAuth = ok(tokens('id-2'));
    vi.setSystemTime(T0.getTime() + 59.5 * 60_000);
    expect(await auth.headers()).toEqual({ Authorization: 'id-2' });
    expect(calls).toEqual([
      { action: 'InitiateAuth', body: { ClientId: 'client-1', AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: 'refresh-1' } } },
    ]);

    answers.InitiateAuth = ok(tokens('id-3'));
    vi.setSystemTime(T0.getTime() + 2 * 3600_000);
    expect(await auth.headers()).toEqual({ Authorization: 'id-3' });
    expect(calls.at(-1)?.body.AuthParameters).toEqual({ REFRESH_TOKEN: 'refresh-1' });
  });

  it('a refused refresh signs out', async () => {
    answers.InitiateAuth = fail('NotAuthorizedException', 'Refresh Token has expired');
    vi.setSystemTime(T0.getTime() + 3600_000);
    await expect(auth.headers()).rejects.toBeInstanceOf(AuthError);
    expect(auth.isSignedIn()).toBe(false);
    expect(await auth.headers()).toEqual({});
  });
});
