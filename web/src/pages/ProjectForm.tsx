import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ProjectState } from '../../../api/src/types';
import { api } from '../api';
import { ErrorBox } from '../components/ui';
import { STATE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectDetail, ProjectView } from '../types';

interface FormState {
  id: string;
  name: string;
  customer: string;
  gl: string;
  pl: string;
  supporters: string[];
  pmo: string;
  startDate: string;
  endDate: string;
  updateFrequencyHours: string;
  publicVisible: boolean;
  publicName: string;
  state: ProjectState;
}

export function ProjectForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { me, users } = useSession();
  const [f, setF] = useState<FormState>({
    id: '',
    name: '',
    customer: '',
    gl: me.role === 'GL' ? me.id : '',
    pl: me.role === 'PL' ? me.id : '',
    supporters: [],
    pmo: '',
    startDate: '',
    endDate: '',
    updateFrequencyHours: '',
    publicVisible: true,
    publicName: '',
    state: 'active',
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get<ProjectDetail>(`/projects/${id}`)
      .then(({ project: p }) =>
        setF({
          id: p.id,
          name: p.name,
          customer: p.customer ?? '',
          gl: p.gl ?? '',
          pl: p.pl ?? '',
          supporters: p.supporters,
          pmo: p.pmo ?? '',
          startDate: p.startDate ?? '',
          endDate: p.endDate ?? '',
          updateFrequencyHours: p.updateFrequencyHours ? String(p.updateFrequencyHours) : '',
          publicVisible: p.publicVisible,
          publicName: p.publicName ?? '',
          state: p.state,
        }),
      )
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const opt = (s: string) => s.trim() || undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const body = {
      name: f.name,
      customer: opt(f.customer),
      gl: opt(f.gl),
      pl: opt(f.pl),
      supporters: f.supporters,
      pmo: opt(f.pmo),
      startDate: opt(f.startDate),
      endDate: opt(f.endDate),
      updateFrequencyHours: f.updateFrequencyHours ? Number(f.updateFrequencyHours) : null,
      publicVisible: f.publicVisible,
      publicName: opt(f.publicName),
    };
    try {
      const r = editing
        ? await api.patch<{ project: ProjectView }>(`/projects/${id}`, { ...body, state: f.state })
        : await api.post<{ project: ProjectView }>('/projects', { ...body, id: opt(f.id) });
      navigate(`/projects/${r.project.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const people = (filter?: (role: string) => boolean) =>
    users
      .filter((u) => !filter || filter(u.role))
      .map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.id})
        </option>
      ));

  return (
    <div className="stack narrow">
      <div className="page-head">
        <div>
          <Link to={editing ? `/projects/${id}` : '/projects'} className="muted">
            ← Quay lại
          </Link>
          <h1>{editing ? `Sửa dự án ${id}` : 'Tạo dự án mới'}</h1>
        </div>
      </div>
      <form className="card form" onSubmit={submit}>
        <div className="form-grid">
          {!editing && (
            <label>
              Mã dự án
              <input value={f.id} placeholder="Để trống để tự sinh (P08…)" onChange={(e) => set('id', e.target.value)} />
            </label>
          )}
          <label className="span-2">
            Tên dự án *
            <input required value={f.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>
            Khách hàng
            <input value={f.customer} onChange={(e) => set('customer', e.target.value)} />
          </label>
          <label>
            GL
            <select value={f.gl} onChange={(e) => set('gl', e.target.value)}>
              <option value="">—</option>
              {people((r) => r === 'GL')}
            </select>
          </label>
          <label>
            PL
            <select value={f.pl} onChange={(e) => set('pl', e.target.value)}>
              <option value="">—</option>
              {people()}
            </select>
          </label>
          <label>
            PMO theo dõi
            <select value={f.pmo} onChange={(e) => set('pmo', e.target.value)}>
              <option value="">—</option>
              {people((r) => r === 'PMO')}
            </select>
          </label>
          <label>
            Bắt đầu
            <input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label>
            Kết thúc
            <input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </label>
          <label>
            Tần suất cập nhật riêng (giờ)
            <input
              type="number"
              min={1}
              placeholder="Để trống = theo trạng thái"
              value={f.updateFrequencyHours}
              onChange={(e) => set('updateFrequencyHours', e.target.value)}
            />
          </label>
          {editing && (
            <label>
              Tình trạng
              <select value={f.state} onChange={(e) => set('state', e.target.value as ProjectState)}>
                {Object.entries(STATE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <fieldset>
          <legend>Người hỗ trợ cập nhật (thay PL / GL khi vắng)</legend>
          <div className="checks">
            {users
              .filter((u) => u.id !== f.pl && u.id !== f.gl)
              .map((u) => (
                <label key={u.id} className="check">
                  <input
                    type="checkbox"
                    checked={f.supporters.includes(u.id)}
                    onChange={(e) =>
                      set('supporters', e.target.checked ? [...f.supporters, u.id] : f.supporters.filter((s) => s !== u.id))
                    }
                  />
                  {u.name}
                </label>
              ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Trang public</legend>
          <label className="check">
            <input type="checkbox" checked={f.publicVisible} onChange={(e) => set('publicVisible', e.target.checked)} /> Hiện dự án này
            trên trang public
          </label>
          <label>
            Tên hiển thị trên trang public
            <input value={f.publicName} placeholder="Để trống = dùng tên dự án" onChange={(e) => set('publicName', e.target.value)} />
          </label>
        </fieldset>

        <p className="muted">Người cần chọn chưa có trong danh sách? Nhờ PMO thêm ở trang Người dùng, hoặc để họ đăng nhập một lần.</p>
        <ErrorBox error={error} />
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo dự án'}
          </button>
        </div>
      </form>
    </div>
  );
}
