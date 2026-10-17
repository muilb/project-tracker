import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ProjectState } from '../../../api/src/types';
import { api } from '../api';
import { ErrorBox } from '../components/ui';
import { STATE_LABEL } from '../labels';
import { useSession } from '../session';
import type { ProjectDetail, ProjectView } from '../types';
import { l } from '../i18n';

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
  const { me, users, isAdmin } = useSession();
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

  async function removeProject() {
    if (!confirm(l(`Xoá dự án ${id}?`, `プロジェクト ${id} を削除しますか？`))) return;
    setBusy(true);
    try {
      await api.del(`/projects/${id}`);
      navigate('/projects');
    } catch (err) {
      setError((err as Error).message);
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
            ← {l('Quay lại', '戻る')}
          </Link>
          <h1>{editing ? l(`Sửa dự án ${id}`, `プロジェクト編集 ${id}`) : l('Tạo dự án mới', '新規プロジェクト作成')}</h1>
        </div>
      </div>
      <form className="card form" onSubmit={submit}>
        <div className="form-grid">
          {!editing && (
            <label>
              {l('Mã dự án', 'プロジェクトコード')}
              <input
                value={f.id}
                placeholder={l('Để trống để tự sinh (P08…)', '空欄で自動採番（P08…）')}
                onChange={(e) => set('id', e.target.value)}
              />
            </label>
          )}
          <label className="span-2">
            {l('Tên dự án *', 'プロジェクト名 *')}
            <input required value={f.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>
            {l('Khách hàng', '顧客')}
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
            {l('PMO theo dõi', '担当 PMO')}
            <select value={f.pmo} onChange={(e) => set('pmo', e.target.value)}>
              <option value="">—</option>
              {people((r) => r === 'PMO')}
            </select>
          </label>
          <label>
            {l('Bắt đầu', '開始日')}
            <input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label>
            {l('Kết thúc', '終了日')}
            <input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </label>
          <label>
            {l('Tần suất cập nhật riêng (giờ)', '個別の報告頻度（時間）')}
            <input
              type="number"
              min={1}
              placeholder={l('Để trống = theo trạng thái', '空欄 = 状態に応じて自動')}
              value={f.updateFrequencyHours}
              onChange={(e) => set('updateFrequencyHours', e.target.value)}
            />
          </label>
          {editing && (
            <label>
              {l('Tình trạng', '状況')}
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
          <legend>{l('Người hỗ trợ cập nhật (thay PL / GL khi vắng)', '報告サポーター（PL / GL 不在時に代理）')}</legend>
          <div className="checks">
            {users
              .filter((u) => u.id !== f.pl && u.id !== f.gl)
              .map((u) => (
                <label key={u.id} className="check">
                  <input
                    type="checkbox"
                    checked={f.supporters.includes(u.id)}
                    onChange={(e) => set('supporters', e.target.checked ? [...f.supporters, u.id] : f.supporters.filter((s) => s !== u.id))}
                  />
                  {u.name}
                </label>
              ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{l('Trang public', '公開ページ')}</legend>
          <label className="check">
            <input type="checkbox" checked={f.publicVisible} onChange={(e) => set('publicVisible', e.target.checked)} />{' '}
            {l('Hiện dự án này trên trang public', 'このプロジェクトを公開ページに表示')}
          </label>
          <label>
            {l('Tên hiển thị trên trang public', '公開ページでの表示名')}
            <input
              value={f.publicName}
              placeholder={l('Để trống = dùng tên dự án', '空欄 = プロジェクト名を使用')}
              onChange={(e) => set('publicName', e.target.value)}
            />
          </label>
        </fieldset>

        <p className="muted">
          {l(
            'Người cần chọn chưa có trong danh sách? Nhờ PMO thêm ở trang Người dùng, hoặc để họ đăng nhập một lần.',
            '選びたい人が一覧にいない場合は、PMO に「ユーザー」画面で追加してもらうか、本人に一度ログインしてもらってください。',
          )}
        </p>
        <ErrorBox error={error} />
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? l('Đang lưu…', '保存中…') : editing ? l('Lưu thay đổi', '変更を保存') : l('Tạo dự án', 'プロジェクト作成')}
          </button>
        </div>
      </form>
      {editing && isAdmin && (
        <section className="card danger-zone">
          <h2>{l('Xoá dự án', 'プロジェクトの削除')}</h2>
          <p className="muted">
            {l(
              'Dự án và toàn bộ cập nhật, vấn đề / sự kiện / mốc của nó sẽ bị ẩn khỏi mọi trang và không còn nhắc. PMO / quản lý khôi phục được ở Cài đặt → Thùng rác. Dự án đã kết thúc thì nên chọn tình trạng "Đã đóng" thay vì xoá.',
              'プロジェクトとその報告・課題 / イベント / マイルストーンはすべての画面から非表示になり、通知も止まります。PMO / 管理者は「設定 → ごみ箱」から復元できます。完了したプロジェクトは削除せず、状況を「終了」にしてください。',
            )}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={removeProject}>
              {l('Xoá dự án', 'プロジェクトを削除')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
