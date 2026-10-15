// Sign-ups whose confirmation email never arrived (company mail filters often drop
// Cognito's no-reply mail). PMO / MNG approve them from the Users page instead.
import {
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';

export interface PendingAccount {
  email: string;
  name?: string;
  createdAt: string;
}

export class NotPendingError extends Error {}

export interface Accounts {
  listPending(): Promise<PendingAccount[]>;
  /** Confirms the sign-up and marks the email verified (so "forgot password" works). */
  approve(email: string): Promise<PendingAccount>;
  /** Deletes the unconfirmed sign-up. */
  reject(email: string): Promise<void>;
}

const attr = (attrs: AttributeType[] | undefined, name: string) => attrs?.find((a) => a.Name === name)?.Value;

export class CognitoAccounts implements Accounts {
  constructor(
    private userPoolId: string,
    private client = new CognitoIdentityProviderClient({}),
  ) {}

  async listPending(): Promise<PendingAccount[]> {
    const out: PendingAccount[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListUsersCommand({
          UserPoolId: this.userPoolId,
          Filter: 'cognito:user_status = "UNCONFIRMED"',
          PaginationToken: token,
        }),
      );
      for (const u of res.Users ?? []) {
        const email = attr(u.Attributes, 'email');
        if (email) out.push({ email: email.toLowerCase(), name: attr(u.Attributes, 'name'), createdAt: (u.UserCreateDate ?? new Date()).toISOString() });
      }
      token = res.PaginationToken;
    } while (token);
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async pending(email: string): Promise<PendingAccount> {
    try {
      const u = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: email }));
      if (u.UserStatus !== 'UNCONFIRMED') throw new NotPendingError(email);
      return { email, name: attr(u.UserAttributes, 'name'), createdAt: (u.UserCreateDate ?? new Date()).toISOString() };
    } catch (e) {
      if ((e as Error).name === 'UserNotFoundException') throw new NotPendingError(email);
      throw e;
    }
  }

  async approve(email: string) {
    const account = await this.pending(email);
    await this.client.send(new AdminConfirmSignUpCommand({ UserPoolId: this.userPoolId, Username: email }));
    await this.client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
      }),
    );
    return account;
  }

  async reject(email: string) {
    await this.pending(email);
    await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: email }));
  }
}

/** Tests and local dev. */
export class MemoryAccounts implements Accounts {
  constructor(public pendingAccounts: PendingAccount[] = []) {}
  async listPending() {
    return [...this.pendingAccounts];
  }
  private take(email: string) {
    const i = this.pendingAccounts.findIndex((a) => a.email === email);
    if (i < 0) throw new NotPendingError(email);
    return this.pendingAccounts.splice(i, 1)[0];
  }
  async approve(email: string) {
    return this.take(email);
  }
  async reject(email: string) {
    this.take(email);
  }
}
