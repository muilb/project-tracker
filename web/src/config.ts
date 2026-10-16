import { l } from './i18n';
export interface AppConfig {
  apiUrl: string;
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
  /** Local dev: no Cognito, the API trusts the `x-dev-user` header. */
  devAuth?: boolean;
}

let config: AppConfig | undefined;

/** Production reads /config.json written by CDK at deploy time; dev talks to the local API. */
export async function loadConfig(): Promise<AppConfig> {
  if (config) return config;
  if (import.meta.env.DEV) {
    config = { apiUrl: '/api', devAuth: true };
  } else {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(l('Không tải được cấu hình (config.json)', '設定（config.json）を読み込めません'));
    config = (await res.json()) as AppConfig;
  }
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('Config not loaded');
  return config;
}
