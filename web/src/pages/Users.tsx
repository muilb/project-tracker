import { useState, type FormEvent } from 'react';
import { ROLES, type Role } from '../../../api/src/types';
import { api } from '../api';
import { ErrorBox, Section } from '../components/ui';
import { ROLE_LABEL } from '../labels';
import { useSession } from '../session';

export function UsersPage() {
  const { users, reloadUsers, canManageUsers, me } = useSession();
  const [error, setError] = useState<string>();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('PL');

  if (!canManageUsers) return <ErrorBox error="Chỉ PMO / MNG mới quản lý người dùng" />;

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
      <h1>Người dùng</h1>
      <ErrorBox error={error} />
      <Section title="Thêm người dùng trước khi họ đăng nhập">
        <form className="form inline-form" onSubmit={add}>
          <label className="grow">
            Email
            <input type="email" required value={id} onChange={(e) => setId(e.target.value)} />
          </label>
          <label className="grow">
            Họ tên
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Vai trò
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">Thêm</button>
        </form>
        <p className="muted">
          Người đăng nhập lần đầu được tạo tự động với vai trò PL. Khi họ đăng ký bằng đúng email này, vai trò ở đây được giữ nguyên.
        </p>
      </Section>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Email</th>
                <th>Vai trò</th>
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
                      disabled={u.id === me.id}
                      title={u.id === me.id ? 'Không tự đổi vai trò của chính mình' : undefined}
                      onChange={(e) => changeRole(u.id, e.target.value as Role)}
                      aria-label={`Vai trò của ${u.name}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
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
