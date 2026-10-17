import { useState, type FormEvent } from 'react';
import { ROLES, type Role } from '../../../api/src/types';
import { api, useApi } from '../api';
import { ErrorBox, Section } from '../components/ui';
import { fmtDateTime } from '../format';
import { ROLE_LABEL } from '../labels';
import { useSession } from '../session';
import { l } from '../i18n';

export function UsersPage() {
  const { users, reloadUsers, canManageUsers, isSystemAdmin, me } = useSession();
  // Only ADMIN grants ADMIN or touches ADMIN accounts.
  const assignable = ROLES.filter((r) => r !== 'ADMIN' || isSystemAdmin);
  const locked = (u: { role: Role }) => u.role === 'ADMIN' && !isSystemAdmin;
  const [error, setError] = useState<string>();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('PL');

  const pending = useApi<{ pending: { email: string; name?: string; createdAt: string }[] }>(canManageUsers ? '/users/pending' : null);
  const [approveRole, setApproveRole] = useState<Record<string, Role | ''>>({});
  const [info, setInfo] = useState<string>();
  const [temp, setTemp] = useState<{ email: string; password: string }>();

  if (!canManageUsers) return <ErrorBox error={l('Chỉ PMO / MNG mới quản lý người dùng', 'ユーザー管理は PMO / MNG のみ行えます')} />;

  async function decide(email: string, action: 'approve' | 'reject') {
    setError(undefined);
    setInfo(undefined);
    try {
      const role = approveRole[email];
      await api.post(`/users/pending/${encodeURIComponent(email)}/${action}`, action === 'approve' && role ? { role } : {});
      setInfo(
        action === 'approve'
          ? l(
              `Đã duyệt ${email}. Người này đăng nhập được ngay bằng mật khẩu đã đặt.`,
              `${email} を承認しました。設定済みのパスワードですぐにログインできます。`,
            )
          : l(`Đã từ chối ${email}.`, `${email} を却下しました。`),
      );
      pending.reload();
      reloadUsers();
      window.dispatchEvent(new Event('pending-changed'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function resetPassword(email: string) {
    if (
      !confirm(
        l(
          `Đặt mật khẩu tạm cho ${email}? Mật khẩu cũ sẽ không dùng được nữa.`,
          `${email} に仮パスワードを設定しますか？ 現在のパスワードは使えなくなります。`,
        ),
      )
    )
      return;
    setError(undefined);
    setTemp(undefined);
    try {
      const r = await api.post<{ password: string }>(`/users/${encodeURIComponent(email)}/reset-password`, {});
      setTemp({ email, password: r.password });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changeRole(userId: string, r: Role) {
    setError(undefined);
    try {
      await api.patch(`/users/${encodeURIComponent(userId)}`, { role: r });
      reloadUsers();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      await api.post('/users', { id, name, role });
      setId('');
      setName('');
      reloadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack narrow">
      <h1>{l('Người dùng', 'ユーザー')}</h1>
      <ErrorBox error={error ?? pending.error} />
      {info && <div className="info-box">{info}</div>}
      {temp && (
        <div className="info-box temp-password">
          <p>
            {l('Mật khẩu tạm của', '仮パスワード:')} <b>{temp.email}</b>
          </p>
          <div className="copy-line">
            <code>{temp.password}</code>
            <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(temp.password)}>
              {l('Copy', 'コピー')}
            </button>
          </div>
          <small className="muted">
            {l(
              'Gửi mật khẩu này cho người dùng qua kênh riêng (chat, gọi điện). Lần đăng nhập đầu, hệ thống bắt họ đặt mật khẩu mới. Mật khẩu chỉ hiện một lần.',
              'このパスワードを個別の手段（チャット・電話）で本人に伝えてください。初回ログイン時に新しいパスワードの設定を求められます。表示は一度だけです。',
            )}
          </small>
          <div className="actions">
            <button type="button" className="btn-link" onClick={() => setTemp(undefined)}>
              {l('Đóng', '閉じる')}
            </button>
          </div>
        </div>
      )}
      {!!pending.data?.pending.length && (
        <Section title={`${l('Chờ duyệt', '承認待ち')} (${pending.data.pending.length})`}>
          <p className="muted">
            {l(
              'Những người đã đăng ký nhưng chưa xác nhận email (thư xác nhận thường bị mail công ty chặn). Duyệt để họ đăng nhập được ngay.',
              '登録済みでメール未確認の人です（確認メールは社内メールでブロックされがちです）。承認するとすぐにログインできます。',
            )}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{l('Họ tên', '氏名')}</th>
                  <th>Email</th>
                  <th>{l('Đăng ký lúc', '登録日時')}</th>
                  <th>{l('Vai trò khi duyệt', '承認時のロール')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.data.pending.map((p) => (
                  <tr key={p.email}>
                    <td>{p.name || '—'}</td>
                    <td>{p.email}</td>
                    <td className="nowrap">{fmtDateTime(p.createdAt)}</td>
                    <td>
                      <select
                        value={approveRole[p.email] ?? ''}
                        onChange={(e) => setApproveRole({ ...approveRole, [p.email]: e.target.value as Role | '' })}
                        aria-label={l(`Vai trò của ${p.email}`, `${p.email} のロール`)}
                      >
                        <option value="">
                          {l('Mặc định (theo ADMIN_EMAILS, nếu không có thì PL)', '既定（ADMIN_EMAILS に従う。なければ PL）')}
                        </option>
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">
                      <button className="btn btn-primary" onClick={() => decide(p.email, 'approve')}>
                        {l('Duyệt', '承認')}
                      </button>{' '}
                      <button
                        className="btn"
                        onClick={() =>
                          confirm(l(`Từ chối và xoá đăng ký của ${p.email}?`, `${p.email} の登録を却下して削除しますか？`)) &&
                          decide(p.email, 'reject')
                        }
                      >
                        {l('Từ chối', '却下')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section title={l('Thêm người dùng trước khi họ đăng nhập', 'ログイン前にユーザーを追加')}>
        <form className="form inline-form" onSubmit={add}>
          <label className="grow">
            Email
            <input type="email" required value={id} onChange={(e) => setId(e.target.value)} />
          </label>
          <label className="grow">
            {l('Họ tên', '氏名')}
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {l('Vai trò', 'ロール')}
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">{l('Thêm', '追加')}</button>
        </form>
        <p className="muted">
          {l(
            'Người đăng nhập lần đầu được tạo tự động với vai trò PL. Khi họ đăng ký bằng đúng email này, vai trò ở đây được giữ nguyên.',
            '初回ログインしたユーザーはロール PL で自動作成されます。同じメールで登録した場合は、ここで設定したロールが維持されます。',
          )}
        </p>
      </Section>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{l('Họ tên', '氏名')}</th>
                <th>Email</th>
                <th>{l('Vai trò', 'ロール')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.id}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === me.id || locked(u)}
                      title={
                        u.id === me.id
                          ? l('Không tự đổi vai trò của chính mình', '自分自身のロールは変更できません')
                          : locked(u)
                            ? l(
                                'Chỉ Quản trị hệ thống mới đổi được tài khoản ADMIN',
                                'ADMIN アカウントを変更できるのはシステム管理者のみです',
                              )
                            : undefined
                      }
                      onChange={(e) => changeRole(u.id, e.target.value as Role)}
                      aria-label={l(`Vai trò của ${u.name}`, `${u.name} のロール`)}
                    >
                      {(locked(u) ? ROLES : assignable).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="nowrap">
                    {u.id !== me.id && !locked(u) && (
                      <button type="button" className="btn-link" onClick={() => resetPassword(u.id)}>
                        {l('Đặt lại mật khẩu', 'パスワード再設定')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
