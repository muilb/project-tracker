import type { ReactNode } from 'react';
import { auth } from '../auth';
import { LangSwitch, useScrollToHash } from '../components/ui';
import { lang } from '../i18n';
import { HelpPageJa } from './HelpJa';

// User manual for newcomers. Public (no login needed) so people can read it before signing up.
// Keep it in step with the UI labels when pages change, and HelpJa.tsx (Japanese) in step with it.

const SECTIONS: [id: string, title: string][] = [
  ['bat-dau', '1. Bắt đầu: tài khoản & đăng nhập'],
  ['vai-tro', '2. Vai trò và quyền'],
  ['trang-thai', '3. Đọc trạng thái dự án'],
  ['tong-quan', '4. Trang Tổng quan'],
  ['du-an', '5. Danh sách & chi tiết dự án'],
  ['cap-nhat', '6. Cập nhật tình hình (việc hằng ngày)'],
  ['muc', '7. Vấn đề · Sự kiện · Mốc'],
  ['ai', '8. Trợ lý AI: nhập và hỏi'],
  ['tao-du-an', '9. Tạo và sửa dự án'],
  ['thong-bao', '10. Kênh thông báo (Telegram / Teams / Slack)'],
  ['thong-bao-ca-nhan', '11. Thông báo cá nhân (🔔, Telegram riêng, trình duyệt)'],
  ['public', '12. Trang public'],
  ['pmo', '13. Dành cho PMO / quản lý'],
  ['hoi-dap', '14. Câu hỏi thường gặp'],
];

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={id} className="card help-section">
      <h2>{SECTIONS.find(([s]) => s === id)?.[1]}</h2>
      {children}
      <a className="btn-link help-top" href="#muc-luc">
        ↑ Mục lục
      </a>
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <b className="ui-label">{children}</b>;

export function HelpPage() {
  useScrollToHash();
  if (lang === 'ja') return <HelpPageJa />;
  const signedIn = auth.isSignedIn();
  return (
    <main className="container narrow stack help">
      <div className="page-head">
        <div>
          <h1>Hướng dẫn sử dụng</h1>
          <p className="muted">Hệ thống Theo dõi dự án — thay cho file Excel theo dõi dự án.</p>
        </div>
        <div className="filters">
          <LangSwitch />
          <a className="btn" href={signedIn ? '/' : '/login'}>
            {signedIn ? '← Về hệ thống' : 'Đăng nhập'}
          </a>
        </div>
      </div>

      <div className="card help-intro">
        <p>
          <b>Hệ thống giúp gì?</b> Mỗi dự án có <b>trạng thái</b> (Xanh / Vàng / Đỏ), <b>lịch sử cập nhật</b> và danh sách{' '}
          <b>vấn đề, sự kiện, mốc</b>. Hệ thống tự tính dự án nào <b>trễ cập nhật</b>, việc nào <b>quá hạn</b>, và <b>tự nhắn Telegram</b>{' '}
          cho nhóm khi có chuyện cần chú ý.
        </p>
        <p>
          <b>Người mới chỉ cần nhớ 3 việc:</b>
        </p>
        <ol className="howto">
          <li>Đăng ký bằng email công ty, đăng nhập.</li>
          <li>
            Mở dự án của mình → <B>Cập nhật tình hình</B> đúng hạn (hoặc dùng <B>✦ AI</B> để gõ như nhắn tin).
          </li>
          <li>Ghi lại vấn đề, sự kiện, mốc và đóng chúng khi xong.</li>
        </ol>
      </div>

      <nav id="muc-luc" className="card help-toc" aria-label="Mục lục">
        <b>Mục lục</b>
        <ol>
          {SECTIONS.map(([id, title]) => (
            <li key={id}>
              <a href={`#${id}`}>{title.replace(/^\d+\.\s*/, '')}</a>
            </li>
          ))}
        </ol>
      </nav>

      <H id="bat-dau">
        <h3>Đăng ký</h3>
        <ol className="howto">
          <li>
            Mở trang đăng nhập → <B>Đăng ký tài khoản</B>. Nhập họ tên, email công ty, mật khẩu (tối thiểu 8 ký tự, có chữ thường và số).
          </li>
          <li>
            Hệ thống gửi <b>mã xác nhận</b> qua email → nhập mã ở màn hình <B>Xác nhận email</B>.
          </li>
          <li>
            <b>Không nhận được email?</b> (mail công ty hay chặn thư tự động) → báo PMO. PMO vào <B>Người dùng → Chờ duyệt</B> để duyệt tài
            khoản cho bạn, sau đó bạn đăng nhập bình thường.
          </li>
        </ol>
        <h3>Đăng nhập & mật khẩu</h3>
        <ul className="howto">
          <li>Đăng nhập bằng email + mật khẩu. Hệ thống nhớ đăng nhập trên máy đó, không phải đăng nhập lại mỗi ngày.</li>
          <li>
            <B>Quên mật khẩu</B> gửi mã đặt lại qua email. Nếu email không tới, nhờ PMO / MNG bấm <B>Đặt lại mật khẩu</B> ở trang Người
            dùng: họ đưa bạn mật khẩu tạm, bạn đăng nhập bằng mật khẩu đó rồi hệ thống yêu cầu <B>Đặt mật khẩu mới</B>.
          </li>
          <li>Dùng được trên điện thoại: mở cùng địa chỉ web bằng trình duyệt.</li>
          <li>
            Đổi ngôn ngữ hiển thị (tiếng Việt / tiếng Nhật) bằng nút <B>VI / 日本語</B> ở góc trên bên phải (trang đăng nhập: ở cuối).
          </li>
        </ul>
        <p className="muted">
          Lần đầu đăng nhập bạn có vai trò mặc định là PL. Nếu cần vai trò khác (GL, PMO…), nhờ PMO đổi ở trang Người dùng.
        </p>
      </H>

      <H id="vai-tro">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vai trò</th>
                <th>Là ai</th>
                <th>Làm được</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>PL</td>
                <td>Trưởng dự án</td>
                <td>
                  Xem tất cả; cập nhật tình hình, thêm / sửa vấn đề, sự kiện, mốc; tạo dự án mới; sửa dự án mình là PL; dùng AI (nhập và
                  hỏi)
                </td>
              </tr>
              <tr>
                <td>GL</td>
                <td>Trưởng nhóm</td>
                <td>Như PL, sửa được các dự án mình là GL; xem tình hình theo nhóm</td>
              </tr>
              <tr>
                <td>PMO</td>
                <td>Văn phòng quản lý dự án</td>
                <td>Sửa mọi dự án, đánh giá trạng thái, quản lý người dùng (duyệt, đổi vai trò), cài đặt hệ thống</td>
              </tr>
              <tr>
                <td>Sub MNG / MNG</td>
                <td>Quản lý</td>
                <td>Sửa mọi dự án, để lại chỉ đạo, cài đặt. MNG quản lý người dùng như PMO</td>
              </tr>
              <tr>
                <td>Hỗ trợ / Khác</td>
                <td>Thành viên hỗ trợ</td>
                <td>
                  Chỉ xem dự án mình tham gia: là PL / GL / PMO / "Người hỗ trợ" của dự án, hoặc phụ trách ít nhất một mục của dự án.
                  Dự án khác không hiện ở Tổng quan, Dự án, thống kê theo GL, AI và kênh thông báo mình tạo. Cập nhật tình hình thay PL
                  / GL khi được thêm vào "Người hỗ trợ". Không tạo dự án; dùng AI chỉ để hỏi, không nhập
                </td>
              </tr>
              <tr>
                <td>Quản trị hệ thống (ADMIN)</td>
                <td>Người phụ trách hệ thống</td>
                <td>
                  Làm được mọi việc của PMO / quản lý. Riêng ADMIN mới: cài / đổi API key AI và bot Telegram, cấp hoặc gỡ vai trò ADMIN, đổi
                  vai trò / đặt lại mật khẩu của tài khoản ADMIN, xem nhật ký quản trị
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </H>

      <H id="trang-thai">
        <h3>Trạng thái dự án</h3>
        <ul className="howto">
          <li>
            <span className="badge tone-green">
              <span aria-hidden>●</span> Xanh
            </span>{' '}
            tốt, đúng kế hoạch.
          </li>
          <li>
            <span className="badge tone-yellow">
              <span aria-hidden>▲</span> Vàng
            </span>{' '}
            cần chú ý, có rủi ro.
          </li>
          <li>
            <span className="badge tone-red">
              <span aria-hidden>■</span> Đỏ
            </span>{' '}
            nghiêm trọng: trễ, sự cố, khách phàn nàn.
          </li>
        </ul>
        <p>
          Trạng thái hiển thị là mức <b>xấu nhất</b> trong: trạng thái PL / GL / người hỗ trợ khai, đánh giá của PMO, và việc quá hạn (có
          mục quá hạn thì ít nhất là Vàng).
        </p>
        <h3>Mức khẩn cấp</h3>
        <ul className="howto">
          <li>
            <b>Khẩn cấp</b>: dự án Đỏ, hoặc có vấn đề ưu tiên Cao đã quá hạn.
          </li>
          <li>
            <b>Cần chú ý</b>: dự án Vàng, có mục quá hạn, hoặc mốc / sự kiện ưu tiên Cao sắp tới.
          </li>
          <li>
            <b>Bình thường</b>: còn lại.
          </li>
        </ul>
        <h3>Tần suất cập nhật & trễ cập nhật</h3>
        <ul className="howto">
          <li>Xanh: cập nhật ít nhất mỗi 7 ngày · Vàng: mỗi 3 ngày · Đỏ: mỗi ngày.</li>
          <li>Có mốc / sự kiện trong 3 ngày tới: mỗi ngày.</li>
          <li>Dự án có thể đặt tần suất riêng (ở trang sửa dự án). PMO đổi các mức chung ở Cài đặt.</li>
          <li>
            "Trễ" được tính từ lần cập nhật gần nhất của <b>PL / GL / người hỗ trợ</b>. Cập nhật của PMO hay quản lý không tính là cập nhật
            đúng hạn.
          </li>
        </ul>
      </H>

      <H id="tong-quan">
        <p>
          Trang đầu tiên sau khi đăng nhập. Nút <B>Dự án của tôi</B> / <B>Tất cả</B> chọn phạm vi (PL, GL mặc định xem dự án của mình; PMO,
          quản lý xem tất cả). Có thể <B>Lọc theo GL</B>.
        </p>
        <ul className="howto">
          <li>
            <b>Ô số liệu</b>: số dự án đang chạy, Đỏ, Vàng, Xanh, trễ cập nhật, vấn đề ưu tiên cao, mục quá hạn.
          </li>
          <li>
            <B>Cần chú ý</B>: dự án khẩn cấp / cần chú ý, xếp nặng nhất lên trên.
          </li>
          <li>
            <B>Mốc & sự kiện … ngày tới</B>: lịch tuần này.
          </li>
          <li>
            <B>Vấn đề cần xử lý</B>: vấn đề quá hạn, ưu tiên cao hoặc sắp tới hạn.
          </li>
          <li>
            <B>Chưa cập nhật kịp thời – cần nhắc</B>: dự án quá hạn cập nhật, trễ bao lâu, ai cần nhắc.
          </li>
          <li>
            <B>Tình hình theo GL</B>: số dự án Đỏ / Vàng / Xanh và trễ của từng nhóm.
          </li>
        </ul>
        <p>
          <B>⬇ Xuất Excel</B>: tải file Excel gồm 3 sheet — <b>Dự án</b> (mọi trạng thái: màu, mức khẩn, người phụ trách, cập nhật gần nhất,
          hạn / trễ cập nhật, số vấn đề, mốc tiếp theo), <b>Vấn đề, sự kiện, mốc</b> (kể cả đã đóng), <b>Cập nhật 60 ngày</b> gần nhất. Chỉ
          có những dự án bạn được xem; giờ là giờ Việt Nam; tiêu đề cột theo ngôn ngữ đang chọn. File không có dữ liệu đã xoá.
        </p>
        <p className="muted">Bấm vào tên dự án ở bất kỳ đâu để mở chi tiết.</p>
      </H>

      <H id="du-an">
        <ul className="howto">
          <li>
            Trang <B>Dự án</B>: danh sách có trạng thái, tình hình mới nhất, lần cập nhật cuối, việc kế tiếp. Lọc theo tình trạng (Đang chạy
            / Tạm dừng / Đã đóng / Tất cả), phạm vi, và ô tìm kiếm (mã, tên, khách hàng, người).
          </li>
          <li>
            Trang <b>chi tiết dự án</b> gồm: thông tin chung (khách hàng, GL, PL, người hỗ trợ, thời gian, tần suất, hạn cập nhật kế tiếp),
            khung <B>Cập nhật tình hình</B>, <B>Vấn đề · Sự kiện · Mốc</B> và <B>Lịch sử cập nhật</B>.
          </li>
          <li>
            Phần thông tin hiện riêng <B>Trạng thái PL/GL khai</B> và <B>PMO đánh giá</B> để biết trạng thái cuối đến từ đâu.
          </li>
        </ul>
      </H>

      <H id="cap-nhat">
        <p>
          Đây là việc quan trọng nhất của PL / GL / người hỗ trợ. Mở dự án → khung <B>Cập nhật tình hình</B>:
        </p>
        <ol className="howto">
          <li>
            Chọn <b>Trạng thái</b> (Xanh / Vàng / Đỏ).
          </li>
          <li>
            Viết <b>Tình hình</b>: tiến độ, việc đã làm, rủi ro. Ngắn gọn, đủ ý.
          </li>
          <li>
            <b>Cần hỗ trợ</b> (nếu có): việc cần cấp trên / PMO giúp, ví dụ "cần thêm 1 dev Java từ 20/10".
          </li>
          <li>
            Bấm <B>Lưu cập nhật</B>.
          </li>
        </ol>
        <ul className="howto">
          <li>Cập nhật cả khi không có gì mới ("đúng tiến độ, không vấn đề") để dự án không bị tính trễ.</li>
          <li>Chuyển sang Đỏ sẽ gửi thông báo Telegram ngay cho các kênh theo dõi dự án đó.</li>
          <li>PMO / quản lý cũng cập nhật được: đó là đánh giá hoặc chỉ đạo, hiện riêng trên trang dự án.</li>
        </ul>
        <p className="muted">
          <B>Lịch sử cập nhật</B> hiện 10 cập nhật mới nhất, cuộn trong khung; bấm <B>Xem thêm</B> để tải cập nhật cũ hơn. Các danh sách dài
          khác cũng hiện vài dòng đầu kèm nút <B>Xem thêm</B> / <B>Thu gọn</B>.
        </p>
        <p className="muted">
          Lỡ ghi nhầm (sai dự án, gõ nhầm)? Bấm <B>Xoá</B> cạnh cập nhật trong <B>Lịch sử cập nhật</B> — người viết xoá được trong 24 giờ,
          sau đó nhờ PMO / quản lý. Cập nhật đã xoá vào Thùng rác, PMO khôi phục được.
        </p>
      </H>

      <H id="muc">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Loại</th>
                <th>Dùng cho</th>
                <th>Ngày là</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>▲ Vấn đề</td>
                <td>Rủi ro, sự cố, việc cần xử lý</td>
                <td>Hạn xử lý</td>
              </tr>
              <tr>
                <td>● Sự kiện</td>
                <td>Họp, demo, đi khách hàng</td>
                <td>Ngày diễn ra</td>
              </tr>
              <tr>
                <td>◆ Mốc</td>
                <td>Release, nghiệm thu, bàn giao</td>
                <td>Ngày mốc</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="howto">
          <li>
            Ở trang dự án, khung <B>Vấn đề · Sự kiện · Mốc</B> → <B>＋ Thêm</B>: chọn loại, nội dung, ngày, <b>ưu tiên</b> (Cao / Trung bình
            / Thấp), người phụ trách.
          </li>
          <li>
            Trạng thái mục: <b>Mở → Đang xử lý → Xong</b>, hoặc <b>Hoãn</b>. Nhớ chuyển sang Xong khi đã xử lý, nếu không mục sẽ thành{' '}
            <b>quá hạn</b> và kéo trạng thái dự án lên Vàng.
          </li>
          <li>Thêm vấn đề ưu tiên Cao sẽ báo Telegram ngay.</li>
          <li>Mốc / sự kiện ngày mai sẽ được nhắc trong tin nhắc mỗi giờ và bản tóm tắt 8h sáng.</li>
        </ul>
        <p className="muted">
          Mục nhập nhầm: bấm <B>Xoá</B> ở cuối dòng (người tạo mục, PL / GL của dự án, PMO / quản lý). Mục đã làm xong thì nên chuyển trạng
          thái <B>Xong</B> thay vì xoá, để còn lịch sử.
        </p>
      </H>

      <H id="ai">
        <p>
          Menu <B>✦ AI</B> có hai tab: <B>Nhập dữ liệu</B> (PL trở lên) và <B>Hỏi về dữ liệu</B> (mọi người).
        </p>
        <h3>Nhập dữ liệu</h3>
        <p>
          Gõ tình hình như nhắn tin, AI tách thành các thao tác. <b>AI không tự ghi gì</b>: bạn xem từng đề xuất, sửa, bỏ chọn cái không
          muốn, rồi bấm <B>Ghi … mục đã chọn</B>.
        </p>
        <h3>AI làm được</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Thao tác</th>
                <th>Ví dụ ghi chú</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Cập nhật tình hình</td>
                <td>"P03 tuần này vàng, khách đổi yêu cầu màn hình báo cáo, cần thêm 1 dev"</td>
              </tr>
              <tr>
                <td>Thêm vấn đề / sự kiện / mốc</td>
                <td>"Thứ 6 demo cho khách P01", "server test P05 hay sập, cần xử lý gấp, Hùng phụ trách"</td>
              </tr>
              <tr>
                <td>Đổi trạng thái mục</td>
                <td>"Lỗi đăng nhập P01 đã xử lý xong", "họp với khách hoãn"</td>
              </tr>
              <tr>
                <td>Sửa mục</td>
                <td>"Demo P01 dời sang thứ 3 tuần sau, nâng ưu tiên cao"</td>
              </tr>
              <tr>
                <td>Tạo dự án mới</td>
                <td>"Dự án mới: Web bán hàng cho KH ABC, PL An, GL Hùng, từ 1/11 đến 31/12, release 15/12"</td>
              </tr>
              <tr>
                <td>Sửa thông tin dự án</td>
                <td>"P03 đổi PL sang Long, dời ngày kết thúc sang 20/12", "P05 tạm dừng"</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Mẹo</h3>
        <ul className="howto">
          <li>Một ghi chú có thể nói về nhiều dự án; AI tạo nhiều đề xuất.</li>
          <li>
            Nêu mã (P03), tên hoặc khách hàng của dự án. Không nêu thì chọn <B>Dự án mặc định</B> trước khi phân tích, hoặc chọn dự án trên
            từng thẻ.
          </li>
          <li>Ngày kiểu "thứ 6", "tuần sau", "cuối tháng" được AI tự đổi ra ngày cụ thể — kiểm tra lại trên thẻ.</li>
          <li>Sửa dự án / sửa mục hiện "Hiện tại: …" cạnh giá trị mới để so sánh.</li>
          <li>⚠ màu đỏ trên thẻ là cảnh báo (ví dụ không tìm thấy người); khung đỏ "Không ghi được" là đề xuất bị chặn.</li>
          <li>Cập nhật tình hình qua AI vẫn lưu kèm nguyên văn ghi chú của bạn.</li>
          <li>
            Trên điện thoại có nút <B>🎤 Nói</B> cạnh ô nhập (cả tab Nhập và Hỏi): bấm, nói một câu, chữ hiện vào ô; bấm lại để nói tiếp.
            Lần đầu trình duyệt hỏi quyền micro — chọn Cho phép. Nếu trình duyệt không hỗ trợ, dùng nút 🎤 trên bàn phím điện thoại.
          </li>
        </ul>
        <h3>Hỏi về dữ liệu</h3>
        <p>
          Tab <B>Hỏi về dữ liệu</B>: hỏi bằng câu bình thường, AI đọc dữ liệu trong hệ thống rồi trả lời. <b>Chỉ đọc</b> — AI không sửa gì.
          Hỏi tiếp được (VD: "còn P05 thì sao?"); đóng trang hoặc bấm <B>Cuộc hỏi mới</B> là xoá cuộc hỏi.
        </p>
        <ul>
          <li>
            Ví dụ: "Dự án nào đang Đỏ, vì sao?", "Tuần này có mốc gì?", "P03 hai tuần qua thế nào?", "Viết báo cáo tuần để gửi quản lý".
          </li>
          <li>AI thấy các dự án, cập nhật 60 ngày gần nhất, vấn đề / sự kiện / mốc và danh sách người dùng.</li>
          <li>
            Mã dự án trong câu trả lời bấm được để mở dự án; nút <B>Copy</B> để chép câu trả lời (VD: dán vào email).
          </li>
          <li>
            AI có thể nhầm; số liệu chính thức xem ở <B>Tổng quan</B>. Muốn ghi / sửa thì dùng tab <B>Nhập dữ liệu</B>.
          </li>
        </ul>
      </H>

      <H id="tao-du-an">
        <ul className="howto">
          <li>
            Trang <B>Dự án</B> → <B>＋ Tạo dự án</B> (PL trở lên). Nhập tên, khách hàng, GL, PL, người hỗ trợ, ngày bắt đầu / kết thúc. Mã
            dự án để trống sẽ tự sinh (P08, P09…).
          </li>
          <li>
            Người chọn làm GL / PL / hỗ trợ phải có trong danh sách người dùng. Chưa có? Nhờ họ đăng nhập một lần, hoặc nhờ PMO thêm ở trang
            Người dùng.
          </li>
          <li>
            <b>Tần suất cập nhật</b>: để trống = theo trạng thái (7 / 3 / 1 ngày). Đặt số giờ nếu dự án cần theo dõi sát hơn.
          </li>
          <li>
            <b>Trang public</b>: mặc định dự án hiện trên trang public với tên dự án; có thể đặt tên public khác, hoặc bỏ chọn{' '}
            <B>Hiện dự án này trên trang public</B> để ẩn khỏi trang public.
          </li>
          <li>
            Sửa: mở dự án → <B>Sửa dự án</B> (PMO, quản lý, GL / PL của dự án). Có thể đổi trạng thái dự án: Đang chạy / Tạm dừng / Đã đóng.
            Dự án tạm dừng, đã đóng không bị nhắc.
          </li>
        </ul>
      </H>

      <H id="thong-bao">
        <p>Mỗi người có thể đăng ký kênh nhận thông báo cho nhóm của mình (hoặc cho riêng mình).</p>
        <h3>Kết nối nhóm Telegram</h3>
        <ol className="howto">
          <li>
            Trong Telegram, thêm bot của hệ thống vào nhóm (tên bot hiện ở trang <B>Kênh thông báo</B>). Nhận riêng: chat với bot và bấm
            Start.
          </li>
          <li>
            Trên web: <B>Kênh thông báo</B> → <B>＋ Đăng ký kênh</B> → Telegram. Đặt tên, chọn <B>Phạm vi dự án</B> (tất cả / nhóm của một
            GL / chọn dự án) và các loại thông báo.
          </li>
          <li>
            Bấm <b>Copy</b> dòng <code>/connect@tên_bot PT-XXXXX</code>, gửi dòng đó vào nhóm Telegram <b>sau khi đã thêm bot</b>.
          </li>
          <li>
            Quay lại web, bấm <B>Kết nối & gửi tin thử</B>. Nhóm nhận tin ✅ là xong.
          </li>
        </ol>
        <h3>Kết nối Slack</h3>
        <ol className="howto">
          <li>
            Trên api.slack.com/apps: <b>Create New App</b> → <b>From scratch</b> → chọn workspace.
          </li>
          <li>
            Bật <b>Incoming Webhooks</b> → <b>Add New Webhook to Workspace</b> → chọn kênh Slack muốn nhận → <b>Allow</b>.
          </li>
          <li>
            Copy URL <code>https://hooks.slack.com/services/…</code>. URL này như mật khẩu: hệ thống chỉ hiện lại dạng che.
          </li>
          <li>
            Trên web: <B>Kênh thông báo</B> → <B>＋ Đăng ký kênh</B> → Slack, dán URL, chọn phạm vi và loại thông báo → <B>Kết nối & gửi tin thử</B>.
            Đổi URL sau này (<B>Sửa</B>) cũng gửi tin thử trước khi lưu.
          </li>
        </ol>
        <p>
          <B>Mức chi tiết của tin</B> (mọi loại kênh): <b>Rút gọn</b> không gửi nội dung người dùng nhập (tóm tắt, cần hỗ trợ, ghi chú, tên
          mục), chỉ gửi mã và tên dự án, trạng thái, hạn, số lượng và link — hợp với kênh có người ngoài. PMO có thể chọn{' '}
          <B>Luôn rút gọn</B> ở <B>Cài đặt</B> để áp cho mọi kênh.
        </p>
        <h3>Nhận được những gì</h3>
        <ul className="howto">
          <li>
            <b>Ngay lập tức</b>: dự án chuyển Đỏ; vấn đề ưu tiên Cao mới (nhiều vấn đề trong 2 phút gộp thành một tin).
          </li>
          <li>
            <b>Mỗi giờ</b> (gộp thành một tin): trễ cập nhật (nhắc lại mỗi 24 giờ), mục quá hạn, mốc / sự kiện sắp tới (mặc định ngày mai, xem Lịch gửi).
          </li>
          <li>
            <b>Tóm tắt</b>: mặc định 8h sáng mỗi ngày (đổi giờ / kiểu ở Lịch gửi).
          </li>
          <li>
            <B>Ngôn ngữ tin nhắn</B>: mỗi kênh chọn tiếng Việt hoặc tiếng Nhật (mặc định theo ngôn ngữ của người đăng ký). Sửa kênh để đổi.
          </li>
        </ul>
        <h3>Lịch gửi</h3>
        <p>
          Khi đăng ký hoặc <B>Sửa</B> kênh, phần <B>Lịch gửi</B> cho chọn:
        </p>
        <ul className="howto">
          <li>
            <b>Giờ yên lặng</b> từ … đến … (có thể qua đêm, ví dụ 23h–6h): không gửi nhắc nhở mỗi giờ; tin bị giữ lại sẽ gửi ở lượt đầu tiên
            sau đó. Bỏ chọn = gửi cả ngày.
          </li>
          <li>
            <b>Không gửi vào thứ 7, Chủ nhật</b>: bỏ nhắc nhở mỗi giờ và tóm tắt trong hai ngày này.
          </li>
          <li>
            <b>Giờ gửi tóm tắt</b> và <b>kiểu tóm tắt</b>: hằng ngày, ngày làm việc (thứ 2 – thứ 6), hoặc <b>tóm tắt tuần</b> sáng thứ 2 (dự
            án đổi màu so với tuần trước, mục đã đóng trong tuần, mốc / sự kiện 7 ngày tới).
          </li>
          <li>
            <b>Báo trước mốc / sự kiện</b>: chọn 1, 2, 3, 7, 14 ngày (ví dụ 7, 3 và 1 ngày). Mỗi mốc chỉ nhắc một lần cho mỗi số ngày.
          </li>
          <li>
            <b>Tạm dừng đến hết ngày</b>: kênh không nhận tin nào (kể cả tin ngay) đến hết ngày đã chọn. Bấm <B>Bỏ tạm dừng</B> để nhận lại.
          </li>
          <li>
            Chống làm phiền tự động: nhiều vấn đề Cao mới trong khoảng 2 phút được gộp thành một tin (ví dụ "3 vấn đề ưu tiên cao mới ở
            P03"); dự án chuyển Đỏ → hết Đỏ → lại Đỏ trong 6 giờ chỉ báo lần đầu.
          </li>
          <li>Kênh đã có từ trước giữ nguyên cách gửi cũ (yên lặng 22h–7h nếu đang bật, tóm tắt 8h mỗi ngày, báo trước 1 ngày).</li>
        </ul>
        <h3>Gửi thử</h3>
        <p>
          Ở mỗi kênh, chọn mẫu tin (kết nối, chuyển Đỏ, vấn đề Cao, nhắc mỗi giờ, tóm tắt) rồi bấm <B>Gửi thử</B> để xem trước tin thật
          trông thế nào. Tin mẫu có chữ <b>[Mẫu]</b> và không ảnh hưởng thông báo thật. Kênh có thể <B>Sửa</B>, <B>Tắt</B> hoặc <B>Xoá</B>.
        </p>
        <h3>Lỗi gửi &amp; nhật ký</h3>
        <ul className="howto">
          <li>
            Gửi lỗi (Teams / Slack / Telegram tạm trục trặc) thì hệ thống tự gửi lại sau 1, 5, 15, 60 phút (tối đa 6 lần). Tin nhắc mỗi giờ không
            gửi lại riêng mà vào lượt của giờ sau.
          </li>
          <li>
            Lỗi không thể tự hết (Workflow hoặc webhook Slack đã bị xoá, kênh Slack đã lưu trữ, bot bị đuổi khỏi nhóm, nhóm không còn) thì không gửi lại. Dòng ⚠ ở kênh ghi rõ lý do
            và cách sửa.
          </li>
          <li>
            Mất <b>5 tin liên tiếp</b> thì kênh <b>tự tắt</b> (nhãn ■ <b>Tự tắt do gửi lỗi</b>) và bạn nhận tin trong hộp thư 🔔. Sửa kênh,
            bấm <B>Gửi thử</B>, rồi <B>Bật</B> lại.
          </li>
          <li>Nhóm Telegram lên "supergroup" thì hệ thống tự chuyển sang nhóm mới, không cần làm gì.</li>
          <li>
            <B>Nhật ký gửi</B> dưới mỗi kênh: 20 lần gửi gần nhất, thành công hay lỗi. <B>Chuyển người phụ trách</B>: giao kênh cho người khác
            (người đó phải đăng nhập được). PMO thấy nhãn ▲ <b>Mồ côi</b> ở kênh mà người phụ trách đã nghỉ hoặc không còn xem được dự án.
          </li>
          <li>
            Kênh Teams dùng URL <code>…webhook.office.com</code> là kiểu cũ Microsoft đã ngừng: tạo Workflow mới rồi <B>Sửa</B> → dán URL mới.
          </li>
        </ul>
        <h3>Đổi nhóm / đổi URL</h3>
        <ul className="howto">
          <li>
            Kênh Telegram: <B>Sửa</B> → <B>Đổi sang nhóm khác</B> → gửi dòng /connect mới vào nhóm mới → <B>Lưu &amp; gửi tin thử</B>. Các
            thiết lập khác giữ nguyên.
          </li>
          <li>
            Kênh Teams: <B>Sửa</B> → dán URL webhook mới (để trống = giữ URL cũ) → <B>Lưu</B> → <B>Gửi thử</B>. Nhớ xoá Workflow cũ trong
            Teams.
          </li>
          <li>
            Kênh Slack: <B>Sửa</B> → dán URL mới (để trống = giữ URL cũ) → <B>Lưu</B>; hệ thống gửi tin thử trước khi lưu.
          </li>
          <li>Loại kênh (Telegram / Teams / Slack) không đổi được: đăng ký kênh mới rồi xoá kênh cũ.</li>
        </ul>
        <p className="muted">Teams cũng được hỗ trợ (dán URL webhook của Workflows) khi công ty cho phép dùng Power Automate.</p>
      </H>

      <H id="thong-bao-ca-nhan">
        <p>
          Ngoài kênh cho cả nhóm, mỗi người còn nhận <b>tin riêng</b>: việc của mình sắp đến hạn, được giao mục, dự án mình theo dõi có
          chuyện. Cài ở <B>Thông báo của tôi</B> (menu, hoặc bấm 🔔 → <B>Cài đặt thông báo của tôi</B>).
        </p>
        <h3>Chuông 🔔</h3>
        <ul className="howto">
          <li>Số đỏ cạnh 🔔 là số tin chưa đọc (tự làm mới mỗi phút). Trên điện thoại 🔔 nằm cạnh nút ☰.</li>
          <li>
            Bấm 🔔 để xem 30 tin mới nhất; <B>Xem thêm</B> để xem tin cũ hơn. Tin chưa đọc có nền xanh và nhãn <b>● Mới</b>, tin đã đọc có
            nhãn <b>✓ Đã đọc</b>.
          </li>
          <li>
            Bấm một tin để mở dự án liên quan, tin đó được đánh dấu đã đọc. <B>Đánh dấu đã đọc tất cả</B> để xoá số đỏ.
          </li>
          <li>Tin được giữ 60 ngày.</li>
        </ul>
        <h3>Nơi nhận</h3>
        <ul className="howto">
          <li>
            <B>Hộp thư web</B> (🔔) luôn bật.
          </li>
          <li>
            <b>Telegram riêng</b>: bấm <B>Kết nối Telegram</B> → <B>Mở @bot trong Telegram</B> → trong Telegram bấm <b>Start</b> → quay lại
            web bấm <B>Tôi đã bấm Start</B>. Bot gửi một tin thử là xong; ô <B>Gửi cả vào Telegram</B> được bật và lưu sẵn (bỏ chọn rồi <B>Lưu</B> để tạm ngừng).{' '}
            <B>Gỡ liên kết</B> để ngừng nhận qua Telegram.
          </li>
          <li>
            <B>Gửi thử</B>: gửi một tin thử vào 🔔 (và Telegram nếu đã kết nối, kể cả khi đang tắt; thông báo trình duyệt nếu đã bật).
          </li>
          <li className="muted">Nếu thấy ▲ "chưa khả dụng" thì chức năng đó chưa được bật trên máy chủ; hộp thư web vẫn nhận tin bình thường.</li>
        </ul>
        <h3>Thông báo trên trình duyệt</h3>
        <p>
          Hiện thông báo trên máy tính hoặc điện thoại (như tin nhắn của ứng dụng), kể cả khi không mở trang. Bật riêng cho từng thiết bị
          ở mục <B>📱 Thông báo trên trình duyệt / điện thoại</B>.
        </p>
        <ul className="howto">
          <li>
            Trên thiết bị muốn nhận, bấm <B>Bật trên thiết bị này</B> → trình duyệt hỏi quyền → chọn <b>Cho phép</b>. Nhãn đổi thành{' '}
            <b>● Đã bật trên thiết bị này</b> và thiết bị hiện trong danh sách (ví dụ "Chrome · Windows").
          </li>
          <li>
            Ô <B>Gửi thông báo tới các thiết bị dưới đây</B> bật / tắt cho mọi thiết bị (nhớ bấm <B>Lưu</B>). Bấm <B>Gỡ</B> để bỏ một thiết bị.
          </li>
          <li>
            <b>iPhone / iPad</b> (iOS 16.4 trở lên): mở trang bằng Safari → nút Chia sẻ → <b>Thêm vào MH chính</b>, mở ứng dụng từ Màn hình
            chính rồi mới bật được. Trang hiện ▲ <b>Cần thêm vào Màn hình chính</b> nếu chưa làm bước này.
          </li>
          <li>
            Nếu thấy ✕ <b>Đã bị chặn trên thiết bị này</b>: bấm biểu tượng 🔒 cạnh địa chỉ trang → Thông báo → Cho phép, rồi tải lại trang.
            Cửa sổ ẩn danh không nhận được thông báo.
          </li>
          <li>
            Theo cùng giờ yên lặng và tạm dừng như Telegram. Khi đăng xuất, trình duyệt đó tự ngừng nhận thông báo của bạn (máy dùng chung).
          </li>
        </ul>
        <h3>Loại tin</h3>
        <p>Chọn loại tin muốn nhận; dưới mỗi ô có ghi khi nào tin được gửi. Mặc định theo vai trò:</p>
        <ul className="howto">
          <li>
            <b>PL</b>: sắp đến hạn cập nhật (còn 4 giờ), dự án của tôi trễ cập nhật (nhắc mỗi 24 giờ).
          </li>
          <li>
            <b>GL, PMO / quản lý</b>: trễ kéo dài (trễ từ 2 lần chu kỳ báo GL, từ 4 lần báo PMO), cần hỗ trợ; GL thêm đổi trạng thái.
          </li>
          <li>
            <b>Mọi người</b>: được giao mục, mục của tôi đến hạn (ngày mai / quá hạn), dự án theo dõi chuyển Đỏ hoặc có vấn đề Cao mới.
          </li>
          <li>Không bao giờ nhận tin về việc do chính mình làm (ví dụ tự gán mục cho mình).</li>
        </ul>
        <h3>⭐ Theo dõi dự án</h3>
        <p>
          Mở một dự án → bấm <B>☆ Theo dõi</B> ở đầu trang (bấm lại <B>★ Đang theo dõi</B> để bỏ). Danh sách dự án theo dõi nằm ở{' '}
          <B>Thông báo của tôi</B>, có nút <B>Bỏ theo dõi</B> và ô <B>Thêm dự án</B>.
        </p>
        <h3>Lịch và tạm dừng</h3>
        <ul className="howto">
          <li>
            Giờ yên lặng (mặc định 22h–7h, chọn được giờ từ / đến, có thể bỏ chọn): nhắc việc theo giờ chờ đến hết giờ yên lặng; tin ngay
            (Đỏ, vấn đề Cao, được giao mục…) vẫn vào 🔔 nhưng không gửi Telegram / trình duyệt. Ô "Không gửi … thứ 7, Chủ nhật" áp dụng giống
            vậy cho hai ngày cuối tuần.
          </li>
          <li>
            <B>Tạm dừng đến hết ngày</B>: chọn ngày (ví dụ khi nghỉ phép), không nhận tin nào đến hết ngày đó. <B>Bỏ tạm dừng</B> để nhận lại.
            Đầu trang hiện ● Đang nhận hoặc ▲ Tạm dừng.
          </li>
          <li>
            <B>Ngôn ngữ tin nhắn</B>: tiếng Việt hoặc tiếng Nhật.
          </li>
          <li>
            Nhớ bấm <B>Lưu</B> ở cuối trang (theo dõi / bỏ theo dõi và kết nối Telegram được lưu ngay).
          </li>
        </ul>
        <h3>Dùng bot Telegram</h3>
        <p>
          Sau khi kết nối Telegram riêng, bạn có thể hỏi bot ngay trong chat (danh sách lệnh cũng có ở <B>Thông báo của tôi</B> →{' '}
          <B>Lệnh của bot</B>). Bot chỉ trả lời những gì bạn được xem trên web.
        </p>
        <ul className="howto">
          <li>
            <code>/mine</code> — dự án của tôi (trạng thái, trễ cập nhật). <code>/status P03</code> — tình hình một dự án.{' '}
            <code>/late</code> — các dự án đang trễ cập nhật. <code>/help</code> — danh sách lệnh.
          </li>
          <li>
            Trong <b>nhóm</b> đã kết nối làm kênh, gõ <code>/mine@tên_bot</code>, <code>/status@tên_bot P03</code>… — bot trả lời theo phạm
            vi của kênh.
          </li>
          <li>
            Nút dưới tin: <B>✓ Đóng mục</B> (khi được giao mục, hoặc mục mình phụ trách đến hạn) đóng mục như trên web;{' '}
            <B>⏰ Hoãn nhắc 1 ngày</B> tạm không nhắc lại các việc trong tin đó trong 24 giờ.
          </li>
          <li>
            <b>Ghi chú bằng chat</b> (PL trở lên): gõ tự do, ví dụ "P03 xong UAT, chuyển xanh". Bot dùng AI đề xuất các thay đổi, bấm{' '}
            <B>✓ Xác nhận</B> trong 30 phút thì mới ghi (như nhập bằng AI trên web), <B>✗ Huỷ</B> để bỏ.
          </li>
          <li>
            Chặn hoặc xoá bot thì Telegram riêng tự tắt, trang <B>Thông báo của tôi</B> báo lý do — bấm <B>Kết nối Telegram</B> để nối lại.
            Bot bị xoá khỏi một nhóm thì kênh đó tự tắt, người tạo kênh nhận tin trong 🔔.
          </li>
        </ul>
      </H>

      <H id="public">
        <p>
          <a href="/public">Trang public</a> ai cũng xem được, không cần đăng nhập: số dự án theo mức khẩn cấp, các dự án khẩn cấp / cần chú
          ý, mốc và sự kiện sắp tới. Tự làm mới mỗi phút — có thể mở trên màn hình chung.
        </p>
        <p>
          Trang public <b>không</b> hiện khách hàng, tên người, nội dung vấn đề hay phần "cần hỗ trợ". Dự án có thể dùng tên public riêng
          hoặc ẩn hẳn.
        </p>
      </H>

      <H id="pmo">
        <h3>Người dùng (PMO / MNG)</h3>
        <ul className="howto">
          <li>
            <B>Chờ duyệt</B>: các tài khoản đã đăng ký nhưng chưa xác nhận email. Chọn vai trò rồi duyệt, hoặc xoá đăng ký lạ. Menu Người
            dùng có số đỏ khi có người chờ.
          </li>
          <li>
            Đổi vai trò, sửa tên; thêm trước người chưa đăng nhập để gán vào dự án. Thêm trước <b>chưa tạo tài khoản đăng nhập</b>: người đó
            vẫn phải tự <B>Đăng ký tài khoản</B> bằng đúng email đó (vai trò đã chọn được giữ nguyên).
          </li>
          <li>
            Cột <B>Tài khoản đăng nhập</B>: ● Đã có tài khoản, ▲ Mật khẩu tạm (chưa đổi), ▲ Chờ duyệt, ■ Chưa có tài khoản (chưa đăng ký).
          </li>
          <li>
            <B>Đặt lại mật khẩu</B> (cuối mỗi dòng): tạo mật khẩu tạm, hiện một lần. Gửi riêng cho người đó; lần đăng nhập đầu họ phải đặt
            mật khẩu mới. Chỉ có với người đã có tài khoản; tài khoản đang chờ duyệt thì duyệt trước.
          </li>
        </ul>
        <h3>Xoá và Thùng rác</h3>
        <ul className="howto">
          <li>
            Xoá là <b>xoá mềm</b>: dữ liệu bị ẩn khỏi mọi trang, AI và thông báo, nhưng vẫn được giữ lại. <B>Cài đặt → Thùng rác</B> liệt kê
            dự án, cập nhật, mục đã xoá (ai xoá, lúc nào) và cho <B>Khôi phục</B>.
          </li>
          <li>
            Xoá dự án (PMO / quản lý): <B>Sửa dự án</B> → cuối trang <B>Xoá dự án</B>. Khôi phục dự án mang lại cả cập nhật và mục của nó.
            Dự án đã xong thì đặt tình trạng <B>Đã đóng</B> thay vì xoá.
          </li>
        </ul>
        <h3>Cài đặt (PMO / quản lý)</h3>
        <p className="muted">
          Mục AI và Bot Telegram chỉ <b>Quản trị hệ thống (ADMIN)</b> cài / đổi được; PMO / quản lý chỉ thấy trạng thái.
        </p>
        <ul className="howto">
          <li>
            <b>AI (Claude)</b> (ADMIN): dán API key (lấy ở console.anthropic.com). Key lưu trên máy chủ, không hiển thị lại. Nên đặt giới
            hạn chi tiêu trên console.
          </li>
          <li>
            <b>Bot Telegram</b> (ADMIN): tạo bot với @BotFather (<code>/newbot</code>) rồi dán token. Token lộ ra ngoài thì{' '}
            <code>/revoke</code> ở BotFather rồi bấm <B>Đổi token</B> và dán token mới — các nhóm đã kết nối vẫn giữ nguyên. Đổi sang bot
            khác thì phải thêm bot mới vào từng nhóm. Khi lưu token, hệ thống bật <b>webhook</b> để bot nhận lệnh và nút bấm; thẻ Bot
            Telegram hiện trạng thái webhook, nếu báo ▲ thì bấm <B>Kết nối lại webhook</B>.
          </li>
          <li>
            <b>Microsoft Teams / Slack</b>: không có gì để cài chung — mỗi kênh đăng ký ở trang Kênh thông báo với URL webhook riêng.
          </li>
          <li>
            Tần suất cập nhật theo trạng thái, ngưỡng "sắp tới", số ngày hiện trên danh sách sắp tới; <b>Mức chi tiết tối đa của kênh nhóm</b>{' '}
            (Theo từng kênh / Luôn rút gọn).
          </li>
        </ul>
        <p className="muted">Không bao giờ gửi API key hay token qua chat / email — chỉ dán vào trang Cài đặt.</p>
        <h3>Quản trị hệ thống (ADMIN)</h3>
        <ul className="howto">
          <li>
            ADMIN đầu tiên: người giữ repo GitHub sửa biến <code>ADMIN_EMAILS</code> (Settings → Variables) thành dạng{' '}
            <code>email@cty.vn:ADMIN</code> rồi deploy lại; lần đăng nhập sau tài khoản đó thành ADMIN. Từ đó ADMIN cấp quyền cho người khác
            ở trang Người dùng.
          </li>
          <li>Chỉ ADMIN cấp được vai trò ADMIN. Không ai tự đổi vai trò của mình, nên hệ thống luôn còn ít nhất một ADMIN.</li>
          <li>
            <B>Cài đặt → Nhật ký quản trị</B>: ai đổi vai trò, thêm người dùng, duyệt / từ chối tài khoản, đặt lại mật khẩu, cài key / bot, xoá dự
            án, khôi phục, tạo / sửa / xoá / chuyển người phụ trách kênh thông báo, kênh tự tắt do lỗi — lúc nào.
          </li>
          <li>
            <B>Cảnh báo hệ thống</B>: khi máy chủ gặp sự cố (API lỗi, gửi thông báo lỗi, cơ sở dữ liệu bị giới hạn…), mọi ADMIN nhận tin ▲
            trong hộp thư 🔔, và qua Telegram riêng / Web Push nếu đã bật ở Thông báo của tôi — kể cả trong giờ yên lặng. Khi hết sự cố có
            tin ✓. Người giữ repo có thể đặt thêm biến <code>ALARM_EMAILS</code> để nhận cả qua email (dùng được cả khi chính ứng dụng
            không chạy).
          </li>
        </ul>
      </H>

      <H id="hoi-dap">
        <dl className="faq">
          <dt>Tôi không nhận được email xác nhận / đặt lại mật khẩu.</dt>
          <dd>
            Kiểm tra thư rác. Mail công ty có thể chặn thư tự động — báo PMO duyệt tài khoản (chưa xác nhận), hoặc nhờ PMO / MNG bấm Đặt lại
            mật khẩu để lấy mật khẩu tạm.
          </dd>
          <dt>Dự án của tôi bị báo "trễ cập nhật" dù PMO vừa cập nhật.</dt>
          <dd>Chỉ cập nhật của PL / GL / người hỗ trợ mới tính. Hãy tự cập nhật tình hình.</dd>
          <dt>Dự án đang Xanh mà hiện Vàng?</dt>
          <dd>Có mục quá hạn, hoặc PMO đánh giá Vàng. Xử lý / đóng mục quá hạn hoặc trao đổi với PMO.</dd>
          <dt>Tôi không thấy nút Sửa dự án.</dt>
          <dd>Chỉ PMO, quản lý, GL và PL của dự án mới sửa được. Nhờ PMO thêm bạn vào dự án hoặc đổi vai trò.</dd>
          <dt>Kết nối Telegram báo "Bot chưa nhận được mã".</dt>
          <dd>Bot phải ở trong nhóm trước khi gửi dòng /connect. Thêm bot, gửi lại dòng đó, rồi bấm Kết nối.</dd>
          <dt>Tôi lỡ xoá nhầm.</dt>
          <dd>Không mất: báo PMO / quản lý khôi phục ở Cài đặt → Thùng rác.</dd>
          <dt>AI không đưa ra đề xuất nào.</dt>
          <dd>Ghi chú cần có nội dung về tình hình / việc cụ thể. Nêu dự án hoặc chọn Dự án mặc định. Đọc phần "AI cần làm rõ" nếu có.</dd>
        </dl>
      </H>
    </main>
  );
}
