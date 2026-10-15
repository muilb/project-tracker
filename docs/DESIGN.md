# Thiết kế hệ thống theo dõi dự án

## Mục tiêu
Thay file Excel theo dõi dự án bằng một hệ thống web nhỏ trên AWS:
- nhập nhanh, kể cả bằng ngôn ngữ tự nhiên (AI);
- **chủ động cảnh báo** qua kênh Teams mà người dùng đăng ký;
- dashboard gọn theo người đăng nhập, cộng thêm một dashboard **public** về sự kiện và mức khẩn cấp.

Ưu tiên làm nhanh và chi phí thấp; bảo mật ở mức vừa đủ.

## Kiến trúc

```
CloudFront ─ S3            web React; trang /public không cần đăng nhập
API Gateway HTTP API ─ Lambda "api" (Hono) ─ DynamoDB (1 bảng)
   └ Cognito JWT authorizer (trừ GET /public, GET /health)
EventBridge (mỗi giờ, phút 05) ─ Lambda "cron" → Teams
Lambda "api" ─ Bedrock / Claude API               (giai đoạn 4)
```

- Cognito **chỉ lo đăng nhập** (email và mật khẩu, cho tự đăng ký). Vai trò và nhóm lưu trong DynamoDB.
  - Người đăng nhập lần đầu mặc định có vai trò PL.
  - Email nằm trong `ADMIN_EMAILS` nhận vai trò ghi kèm (`email:MNG`), hoặc PMO nếu không ghi vai trò.
- Dữ liệu ít (vài chục dự án), nên dashboard đọc toàn bộ bảng rồi tính trong bộ nhớ.
- `GET /public` không cần đăng nhập:
  - chỉ trả về các trường được phép công khai;
  - được cache 30 giây;
  - API Gateway giới hạn 20 request/giây.

## Vai trò và quyền

| Vai trò | Mã |
|---|---|
| Project leader | `PL` |
| Group leader | `GL` |
| PMO | `PMO` |
| Sub manager / Manager | `SUBMNG` / `MNG` |
| Người hỗ trợ, khác | `OTHER` |

| Thao tác | Ai được làm |
|---|---|
| Tạo dự án | PL trở lên (mọi vai trò trừ `OTHER`) |
| Sửa dự án, đổi trạng thái | PMO / SUBMNG / MNG, hoặc GL / PL của dự án |
| Ghi cập nhật, thêm/sửa vấn đề và sự kiện | Mọi người đã đăng nhập |
| Thêm/sửa người dùng | PMO / MNG |
| Sửa cài đặt | PMO / SUBMNG / MNG |

## Quy tắc (giữ nguyên từ file Excel) — `api/src/rules.ts`

**Trạng thái tổng hợp** = mức xấu nhất trong ba nguồn:
- trạng thái do PL / GL / người hỗ trợ khai gần nhất;
- đánh giá gần nhất của PMO;
- có mục quá hạn thì tối thiểu là Vàng.

**Tần suất cập nhật:**
- Xanh 168h, Vàng 72h, Đỏ 24h.
- Nếu còn ≤ 3 ngày đến mốc hoặc sự kiện kế tiếp thì 24h.
- Tần suất riêng của dự án (nếu có) được ưu tiên hơn các quy tắc trên.

**Trễ cập nhật:** hạn = lần cập nhật cuối của PL / GL / người hỗ trợ + tần suất. Cập nhật của PMO và quản lý không tính.

**Quá hạn:** mục chưa ở trạng thái `done` / `postponed` và ngày đã qua (tính theo giờ Việt Nam).

**Mức khẩn cấp:**
- `critical`: dự án Đỏ, hoặc có vấn đề ưu tiên Cao đã quá hạn.
- `attention`: dự án Vàng, hoặc có mục quá hạn, hoặc có mốc / sự kiện ưu tiên Cao trong ≤ 3 ngày.
- `normal`: các trường hợp còn lại.

## API

Mọi endpoint, trừ `/health` và `/public`, cần header `Authorization: <Cognito ID token>`.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Kiểm tra API còn sống |
| GET | `/public` | Dashboard public: số dự án theo mức khẩn cấp, dự án khẩn cấp / cần chú ý, mốc và sự kiện 7 ngày tới |
| GET | `/me` | Người đang đăng nhập |
| GET | `/dashboard?scope=all\|mine&gl=<email>` | Số liệu tổng, dự án cần chú ý, trễ cập nhật, vấn đề ưu tiên, sắp tới, thống kê theo GL |
| GET | `/projects?scope=mine&gl=&state=active\|paused\|closed\|all` | Danh sách dự án kèm số liệu đã tính |
| POST | `/projects` | Tạo dự án (PL trở lên). `id` tự sinh `P01, P02…` nếu không truyền |
| GET | `/projects/:id` | Chi tiết, 50 cập nhật gần nhất, các vấn đề / sự kiện |
| PATCH | `/projects/:id` | Sửa thông tin, `state` (`active` / `paused` / `closed`), `publicVisible`, `publicName` |
| GET / POST | `/projects/:id/updates` | Cập nhật tình hình: `health`, `summary`, `needHelp` |
| GET / POST | `/projects/:id/items` | Vấn đề / sự kiện / mốc: `type` = `issue` / `event` / `milestone` |
| PATCH | `/projects/:id/items/:itemId` | Sửa, đóng mục (`status: done`) |
| GET / POST | `/users`, PATCH `/users/:email` | Người dùng; PMO tạo trước người chưa đăng nhập |
| GET / PUT | `/settings` | Tần suất cập nhật và các ngưỡng |
| GET / POST | `/channels` | Kênh Teams: mỗi người thấy kênh mình tạo, PMO / quản lý thấy tất cả. Khi tạo, hệ thống gửi tin thử, chỉ lưu nếu gửi được |
| PATCH / DELETE | `/channels/:id` | Sửa (tên, phạm vi, loại thông báo, giờ yên lặng, bật / tắt, URL) hoặc xoá: người tạo, PMO / quản lý |
| POST | `/channels/:id/test` | Gửi tin thử |

Ví dụ tạo dự án:

```json
POST /projects
{ "name": "Web thương mại", "customer": "KH F", "gl": "hung@cty.vn", "pl": "long@cty.vn",
  "startDate": "2026-09-01", "endDate": "2026-12-15", "publicName": "Dự án TMĐT" }
```

## Lộ trình

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | API, quy tắc, CDK, CI/CD, seed | Xong |
| 2 | Web nội bộ (đăng nhập, dashboard, form) và trang public | Xong |
| 3 | Teams: đăng ký kênh, cảnh báo, tóm tắt 8h sáng | Xong |
| 4 | Trang nhập bằng AI (Bedrock hoặc Claude API) | |

## Web

| Trang | Ai thấy | Nội dung |
|---|---|---|
| `/login` | Mọi người | Đăng nhập, đăng ký, xác nhận email, quên mật khẩu (gọi thẳng Cognito) |
| `/` Tổng quan | Đã đăng nhập | Ô số liệu, dự án cần chú ý, mốc / sự kiện sắp tới, vấn đề cần xử lý, trễ cập nhật, theo GL. PL / GL / người hỗ trợ mặc định xem "Dự án của tôi", PMO / quản lý xem "Tất cả" |
| `/projects` | Đã đăng nhập | Danh sách, lọc theo tình trạng / phạm vi, tìm kiếm |
| `/projects/new`, `/projects/:id/edit` | PL trở lên / người có quyền sửa | Form dự án |
| `/projects/:id` | Đã đăng nhập | Thông tin, form cập nhật nhanh, lịch sử, vấn đề / sự kiện / mốc (thêm, đổi trạng thái) |
| `/users` | PMO / MNG | Thêm người dùng trước, đổi vai trò |
| `/settings` | PMO / SUBMNG / MNG | Tần suất, ngưỡng |
| `/public` | Mọi người (internet) | Số dự án theo mức khẩn cấp, dự án khẩn cấp / cần chú ý, mốc và sự kiện sắp tới; tự làm mới mỗi phút |

Màu trạng thái (Xanh / Vàng / Đỏ) luôn đi kèm biểu tượng (● ▲ ■) và chữ, không dùng màu một mình.

## Thông báo Teams — `api/src/notify/`

**Kết nối:**
- Mỗi kênh Teams tạo một Workflow từ mẫu *"Post to a channel when a webhook request is received"*, rồi dán URL vào trang **Kênh Teams**.
- Hệ thống chỉ chấp nhận URL `https` thuộc `*.logic.azure.com`, `*.powerplatform.com` hoặc `*.webhook.office.com`.
- URL này có tác dụng như mật khẩu: API không bao giờ trả về đầy đủ, chỉ trả về tên máy chủ và đầu đường dẫn.

**Phạm vi** của mỗi kênh: tất cả dự án, một nhóm GL, hoặc danh sách dự án chọn sẵn.

| Loại | Khi nào gửi | Chống trùng |
|---|---|---|
| `became_red` | Ngay khi trạng thái tổng hợp chuyển sang Đỏ, sau một lần cập nhật | Chỉ khi trạng thái thay đổi |
| `high_issue` | Ngay khi có vấn đề ưu tiên Cao mới | Mỗi vấn đề một lần |
| `late_update` | Job mỗi giờ | Một lần cho mỗi hạn bị trễ, nhắc lại sau mỗi 24 giờ còn trễ |
| `overdue` | Job mỗi giờ | Mỗi mục một lần mỗi ngày |
| `milestone_soon` | Job mỗi giờ, cho mốc / sự kiện diễn ra ngày mai | Mỗi mục một lần |
| `daily_digest` | 08:00 giờ Việt Nam | Mỗi kênh một lần mỗi ngày |

**Cách gửi của job mỗi giờ:**
- Các cảnh báo của cùng một lượt chạy được gộp thành **một tin** cho mỗi kênh, tối đa 15 dòng.
- Một cảnh báo chỉ được đánh dấu "đã gửi" khi Teams nhận thành công. Nếu gửi lỗi thì giờ sau gửi lại, và lỗi được hiện trên trang kênh.
- Bản ghi chống trùng tự hết hạn nhờ TTL của DynamoDB.

**Giờ yên lặng** (22h–7h, tuỳ chọn cho từng kênh) chỉ chặn các tin của job mỗi giờ. Cảnh báo Đỏ và vấn đề Cao vẫn gửi ngay.

Teams lỗi không làm thất bại thao tác của người dùng, ví dụ lưu cập nhật vẫn thành công.

