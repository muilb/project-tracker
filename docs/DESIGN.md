# Thiết kế hệ thống theo dõi dự án

## Mục tiêu
Thay file Excel theo dõi dự án bằng một hệ thống web nhỏ trên AWS:
- nhập nhanh, kể cả bằng ngôn ngữ tự nhiên (AI);
- **chủ động cảnh báo** qua kênh Teams / Telegram / Slack mà người dùng đăng ký, và thông báo cá nhân (🔔, Telegram riêng, trình duyệt);
- dashboard gọn theo người đăng nhập, cộng thêm một dashboard **public** về sự kiện và mức khẩn cấp.

Ưu tiên làm nhanh và chi phí thấp; bảo mật ở mức vừa đủ.

## Kiến trúc

```
CloudFront ─ S3            web React; trang /public không cần đăng nhập
API Gateway HTTP API ─ Lambda "api" (Hono) ─ DynamoDB (1 bảng)
   └ Cognito JWT authorizer (trừ GET /public, GET /health, POST /telegram/webhook)
EventBridge (mỗi giờ, phút 05) ─ Lambda "cron" → Teams / Telegram / Slack / Web Push
EventBridge (mỗi phút) ─ Lambda "FlushFn" (hàng đợi OUTBOX: gộp tin, gửi lại)
Lambda "api" ─ Bedrock / Claude API               (giai đoạn 4)
```

- Cognito **chỉ lo đăng nhập** (email và mật khẩu, cho tự đăng ký). Vai trò và nhóm lưu trong DynamoDB.
  - Người đăng nhập lần đầu mặc định có vai trò PL.
  - Email nằm trong `ADMIN_EMAILS` nhận vai trò ghi kèm (`email:MNG`), hoặc PMO nếu không ghi vai trò.
  - Mail công ty hay chặn thư xác nhận của Cognito (`no-reply@verificationemail.com`). Vì vậy PMO / MNG có thể **duyệt** tài khoản chờ xác nhận ở trang Người dùng; menu hiện số tài khoản đang chờ. Lambda API được cấp các quyền `ListUsers`, `AdminGetUser`, `AdminConfirmSignUp`, `AdminUpdateUserAttributes`, `AdminDeleteUser`, chỉ trên user pool này.
- Dữ liệu ít (vài chục dự án), nên dashboard đọc toàn bộ dự án / cập nhật / mục / người dùng rồi tính trong bộ nhớ. Việc đọc này đi qua chỉ mục `byKind` (khoá `kind`, `sk`), mỗi loại một query, nên **không quét** các dòng hộp thư, nhật ký gửi, chống trùng, hàng đợi… (chúng tăng theo lượng thông báo). Danh sách kênh và người dùng cũng đọc qua chỉ mục này. Khi chỉ mục chưa có hoặc đang tạo (lần deploy đầu), store tự quét cả bảng như trước và thử lại chỉ mục sau 1 phút.
- Lịch sử cập nhật tăng mãi nên không đọc hết mỗi lần. `snapshot({ now })` chỉ lấy cập nhật trong `SNAPSHOT_UPDATE_DAYS` (60) ngày gần nhất (khoá sắp xếp của cập nhật bắt đầu bằng thời gian, nên chỉ mục `byKind` lọc được ngay), cộng thêm **cập nhật ghim** của từng dự án (dòng `PROJECT#<id>` / `PINS`). Cập nhật ghim (`rules.pinUpdates`) là, với mỗi người viết + vai trò, cập nhật mới nhất và cập nhật có màu mới nhất. Mọi giá trị của `buildProjectView` (màu PL khai, màu PMO, nhận xét quản lý, cập nhật gần nhất của PL…) đều là "cập nhật mới nhất thoả điều kiện về người viết / vai trò / có màu", nên luôn nằm trong các dòng ghim: màu dự án tính ra giống hệt khi đọc toàn bộ lịch sử, kể cả khi đổi PL / GL / supporter. `test/history.test.ts` kiểm tra điều này với lịch sử ngẫu nhiên.
  - `putUpdate` giữ dòng ghim luôn đúng: cập nhật mới / khôi phục được gộp vào, không đọc lịch sử; xoá một cập nhật đang ghim thì đọc lại lịch sử của dự án đó (hiếm). Hai người ghi cùng lúc (điều kiện `version`) thì dòng ghim bị xoá, lần đọc sau dựng lại từ lịch sử. Dữ liệu cũ chưa có dòng ghim được dựng một lần khi `snapshot` gặp.
  - Trang dự án và nút "Xem thêm" đọc đúng một trang cập nhật (`pageUpdates`, mới nhất trước); thêm cập nhật tính màu trước / sau từ dòng ghim. Thùng rác đọc riêng các cập nhật đã xoá (`listDeletedUpdates`). Báo cáo tuần đọc lịch sử đầy đủ chỉ cho các dự án có cập nhật trong tuần (màu của tuần trước có thể đến từ cập nhật cũ hơn 60 ngày).
- Vấn đề / sự kiện / mốc cũng tăng mãi: `snapshot({ now })` chỉ mang **mục đang mở** và mục đã đóng (Xong / Hoãn) có thay đổi trong `SNAPSHOT_UPDATE_DAYS` (60) ngày (`keepItem`). Màu, số vấn đề, mục quá hạn, mốc kế tiếp chỉ tính mục đang mở nên không đổi; báo cáo tuần cần mục đóng trong 7 ngày. Trang dự án đọc mọi mục của dự án (`listItems`), thùng rác đọc mọi mục đã xoá.
  - Trong DynamoDB, `kind` của mục cho biết nó thuộc nhóm nào: `ITEM` (đang mở), `ITEM_CLOSED#<YYYY-MM>` (đã đóng, theo tháng của lần sửa cuối), `ITEM_DELETED` (đã xoá). `putItem` đặt `kind` mỗi lần ghi (đóng / mở lại / xoá / khôi phục). Snapshot đọc `ITEM` và các tháng từ 60 ngày trước đến nay (3 tháng), thùng rác đọc thêm `ITEM_DELETED`. Dòng cũ (trước khi tách, đều là `ITEM`) được chuyển đúng `kind` một lần khi snapshot gặp, chỉ khi dòng chưa bị sửa từ lúc đọc (`updatedAt`).
- **Xu hướng màu** (`api/src/trend.ts`): mỗi lần chạy, job mỗi giờ (`runHourly`) ghi màu của mọi dự án đang chạy / tạm dừng vào dòng của ngày hôm đó (giờ Việt Nam): `HEALTH` / `<YYYY-MM-DD>`, một dòng cho mọi dự án (`HealthDay`: trạng thái, màu, màu PL/GL khai, màu PMO, số mục quá hạn, giờ trễ). Lần chạy sau trong ngày ghi đè, nên mỗi ngày giữ lần ghi cuối. Dự án đã đóng / đã xoá không được ghi. Ghi lỗi thì cảnh báo vẫn gửi, rồi job báo lỗi. **Không dựng lại từ dữ liệu cũ**: xu hướng bắt đầu từ ngày job chạy lần đầu (dữ liệu mẫu có sẵn 27 ngày lịch sử cho dev / test). Đọc theo khoảng ngày (query `pk = HEALTH`, `sk BETWEEN`): trang dự án 84 ngày (12 tuần, "Xem toàn bộ" tối đa 2 năm), Tổng quan từ thứ Hai của 11 tuần trước đến hôm nay (≤ 84 dòng, endpoint riêng để Tổng quan không chậm thêm). Mỗi ngày một dòng (365 dòng / năm), vài KB với khoảng 30 dự án.
- Một bảng DynamoDB (`pk` / `sk`, chi tiết ở `api/src/store/dynamo.ts`):

  | `pk` | `sk` | Nội dung |
  |---|---|---|
  | `USER#<email>` | `USER` | Người dùng, vai trò |
  | `PROJECT#<id>` | `PROJECT` · `UPDATE#<giờ>#<id>` · `ITEM#<id>` · `COMMENT#<id>` | Dự án, cập nhật, mục, bình luận (`kind` `COMMENT`, đã xoá `COMMENT_DELETED`) |
  | `CHANNEL#<id>` | `CHANNEL` | Kênh nhóm |
  | `SENT#<khoá>` | `SENT` | Chống trùng cảnh báo (TTL) |
  | `AUDIT` | `<giờ>#<id>` | Nhật ký quản trị (400 ngày) |
  | `NOTIFY` | `<email>` | Cài đặt thông báo cá nhân |
  | `INBOX#<email>` | `<giờ>#<id>` | Hộp thư web (60 ngày) |
  | `OUTBOX` | `<giờ đến hạn>#<id>` | Hàng đợi gửi (7 ngày) |
  | `DELIVERY#<kênh>` | `<giờ>#<id>` | Nhật ký gửi (30 ngày) |
  | `PUSH#<email>` | `<id>` | Thiết bị Web Push |
  | `TEMP#<khoá>` | `TEMP` | Trạng thái ngắn hạn của bot Telegram (TTL) |
  | `HEALTH` | `<YYYY-MM-DD>` | Màu của mọi dự án đang chạy / tạm dừng trong ngày (xu hướng) |
  | `CONFIG` | `SETTINGS` · `TELEGRAM` · `AI` · `PUSH` · `SEQ#…` | Cài đặt, bí mật, bộ đếm mã |
- **Header bảo mật của web** (`infra/lib/headers.ts`, CloudFront `ResponseHeadersPolicy`, gắn cho mọi file kể cả `/sw.js`):
  - `Content-Security-Policy`: chỉ chạy script / CSS của chính site; chỉ gọi tới chính site, API Gateway và Cognito của region (`connect-src`); ảnh `data:` cho favicon; không cho nhúng vào iframe (`frame-ancestors 'none'`), không plugin, `base-uri` / `form-action` chỉ chính site.
  - `Strict-Transport-Security` (2 năm), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (chỉ micro, cho nút 🎤).
  - **Thêm dịch vụ bên ngoài** mà web gọi trực tiếp (font, CDN, API khác…) thì phải thêm nguồn vào CSP, không thì trình duyệt chặn. `vite preview` trong test E2E gửi cùng các header này, nên vi phạm CSP làm test hỏng trước khi deploy.
- **Tải web theo phần:** React + router là một file riêng (ít đổi, trình duyệt giữ lại qua các lần deploy). Các trang lớn / ít mở (Hướng dẫn, AI, Kênh, Thông báo của tôi, Người dùng, Cài đặt, Thùng rác, form dự án) chỉ tải khi mở lần đầu (`lazyPage` trong `App.tsx`). Lần mở đầu tải khoảng 323 KB JS (104 KB nén) thay vì 534 KB (158 KB nén). Tab mở từ trước một lần deploy mà xin file của bản cũ (đã bị xoá) thì tự tải lại trang một lần (`vite:preloadError` trong `main.tsx`), không lặp lại trong 1 phút.
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
| Quản trị hệ thống | `ADMIN` |

| Thao tác | Ai được làm |
|---|---|
| Xem dự án | Mọi người; riêng `OTHER` chỉ xem dự án mình tham gia (xem "Quyền xem") |
| Tạo dự án | PL trở lên (mọi vai trò trừ `OTHER`) |
| Sửa dự án, đổi trạng thái | PMO / SUBMNG / MNG, hoặc GL / PL của dự án |
| Ghi cập nhật, thêm/sửa vấn đề và sự kiện | Mọi người đã đăng nhập |
| Thêm/sửa người dùng, duyệt tài khoản, đặt lại mật khẩu | PMO / MNG / ADMIN (tài khoản `ADMIN` thì chỉ ADMIN) |
| Sửa cài đặt (tần suất, ngưỡng), xoá dự án, thùng rác | PMO / SUBMNG / MNG / ADMIN |
| Đăng ký kênh thông báo | Mọi người; sửa / xoá / gửi thử / nhật ký / chuyển người phụ trách: người tạo hoặc PMO / SUBMNG / MNG / ADMIN (thấy mọi kênh, nhãn Mồ côi) |
| API key AI, bot Telegram, cấp vai trò `ADMIN`, nhật ký quản trị | Chỉ `ADMIN` |

`ADMIN` đầu tiên: `ADMIN_EMAILS` (biến GitHub) có `email:ADMIN` → lần đăng nhập sau tài khoản đó được nâng lên ADMIN (các vai trò khác trong `ADMIN_EMAILS` chỉ áp dụng ở lần đăng nhập đầu). Không ai tự đổi vai trò của mình nên luôn còn ít nhất một ADMIN.

Nhật ký quản trị (`GET /audit`, ADMIN): đổi vai trò, thêm / duyệt / từ chối tài khoản, đặt lại mật khẩu, cài / gỡ key AI và bot, xoá dự án, khôi phục, tạo / sửa / xoá / chuyển kênh (`channel_*`), kênh tự tắt (`channel_auto_pause`, người thực hiện `system`). Lưu ở `pk = AUDIT`, tự xoá sau 400 ngày (TTL).

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

**Quá ngày kết thúc** (mới, không có trong Excel): dự án `active` có `endDate` đã qua → `daysPastEnd` = số ngày quá. Chỉ là cảnh báo (🏁 trên web, ô số liệu, cột trong Excel, đưa vào "Cần chú ý"), **không** đổi màu hay mức khẩn cấp. Dự án tạm dừng / đã đóng không bị cảnh báo.

**Mức khẩn cấp:**
- `critical`: dự án Đỏ, hoặc có vấn đề ưu tiên Cao đã quá hạn.
- `attention`: dự án Vàng, hoặc có mục quá hạn, hoặc có mốc / sự kiện ưu tiên Cao trong ≤ 3 ngày.
- `normal`: các trường hợp còn lại.

## API

Mọi endpoint, trừ `/health`, `/public` và `POST /telegram/webhook` (kiểm tra secret token), cần header `Authorization: <Cognito ID token>`.

Thông báo lỗi trả về theo header `Accept-Language` (`ja…` → tiếng Nhật, còn lại → tiếng Việt); web luôn gửi ngôn ngữ người dùng đang chọn.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Kiểm tra API còn sống |
| GET | `/public` | Dashboard public: số dự án theo mức khẩn cấp, dự án khẩn cấp / cần chú ý, mốc và sự kiện 7 ngày tới |
| GET | `/me` | Người đang đăng nhập |
| GET | `/dashboard?scope=all\|mine&gl=<email>` | Số liệu tổng (kể cả `pastEnd`), dự án cần chú ý (cả dự án quá ngày kết thúc), trễ cập nhật, vấn đề ưu tiên, sắp tới, dự án kết thúc trong `ENDING_SOON_DAYS` (14) ngày (`endingSoon`), thống kê theo GL |
| GET | `/dashboard/trend?scope=&gl=` | Xu hướng 12 tuần của các dự án Tổng quan đang hiện (cùng bộ lọc, chỉ dự án xem được, mọi trạng thái): `weeks` (mỗi tuần thứ Hai → Chủ nhật, tuần này đến hôm nay: đếm Đỏ / Vàng / Xanh / Tạm dừng theo lần ghi cuối của tuần; bỏ các tuần trước khi có dữ liệu), `worse` / `better` (dự án đang chạy đổi màu so với cuối tuần trước) |
| GET | `/export` | File Excel (`.xlsx`, `src/export/`): sheet Dự án (mọi trạng thái, có số ngày quá ngày kết thúc), Vấn đề / sự kiện / mốc (đang mở và đã đóng trong `SNAPSHOT_UPDATE_DAYS` ngày), Cập nhật `SNAPSHOT_UPDATE_DAYS` ngày, Lịch sử màu 12 tuần (mỗi dự án mỗi ngày đã ghi). Chỉ dữ liệu người gọi xem được, không có dòng đã xoá; tiêu đề / nhãn theo `Accept-Language`, giờ Việt Nam, tên người thay cho email. Văn bản luôn là chuỗi (không thành công thức) |
| GET | `/projects?scope=mine&gl=&state=active\|paused\|closed\|all` | Danh sách dự án kèm số liệu đã tính |
| POST | `/projects` | Tạo dự án (PL trở lên). `id` tự sinh `P01, P02…` nếu không truyền |
| GET | `/projects/:id` | Chi tiết, 10 cập nhật gần nhất (+ `nextBefore` nếu còn cũ hơn), các vấn đề / sự kiện |
| GET | `/projects/:id/trend?all=1` | Màu từng ngày đã ghi của dự án: `{ from, to, days, more }`. Mặc định 84 ngày đến hôm nay (dự án đã đóng: đến ngày sửa cuối, tức ngày đóng), `all=1` tối đa 2 năm; không trước ngày bắt đầu dự án. `more`: có thể còn ngày cũ hơn |
| PATCH | `/projects/:id` | Sửa thông tin, `state` (`active` / `paused` / `closed`), `publicVisible`, `publicName` |
| GET / POST | `/projects/:id/updates` | GET: trang cập nhật cũ hơn, `?before=<nextBefore>&limit=` (mặc định 20, tối đa 100) → `{ updates, nextBefore? }`. POST: ghi cập nhật `health`, `summary`, `needHelp` |
| GET / POST | `/projects/:id/items` | Vấn đề / sự kiện / mốc: `type` = `issue` / `event` / `milestone` |
| PATCH | `/projects/:id/items/:itemId` | Sửa, đóng mục (`status: done`) |
| GET / POST | `/projects/:id/comments` | Bình luận (`src/comments.ts`). GET: mọi bình luận chưa xoá của dự án, cũ trước (trang dự án tải một lần rồi nhóm theo chuỗi). POST: ai xem được dự án cũng viết được; body `{ target: update \| item, targetId, updateAt? (cập nhật: đúng `at` API trả), text }` (≤ 2000 ký tự; `@{email}` là gọi tên, người phải tồn tại) → 201 `{ comment, notVisible }` (`notVisible`: người được gọi tên mà không xem được dự án, họ không nhận tin). Không đổi màu, không tính là cập nhật |
| PATCH / DELETE | `/projects/:id/comments/:commentId` | Sửa (`{ text }`, người viết trong 24 giờ, ghi `editedAt`; chỉ báo người mới được gọi tên) / xoá mềm (người viết trong 24 giờ, hoặc PMO / quản lý) |
| GET / POST | `/users`, PATCH `/users/:email` | Người dùng; PMO tạo trước người chưa đăng nhập (chỉ tạo hồ sơ trong DynamoDB, **không** tạo tài khoản Cognito — người đó tự đăng ký bằng đúng email) |
| GET | `/users/accounts` | PMO / MNG: trạng thái tài khoản đăng nhập của từng người dùng (đọc từ Cognito): `none` (chưa đăng ký), `pending` (chờ xác nhận), `temp` (mật khẩu tạm chưa đổi), `active` |
| GET | `/users/pending` | PMO / MNG: các tài khoản đã đăng ký nhưng chưa xác nhận email (đọc từ Cognito) |
| POST | `/users/pending/:email/approve` | PMO / MNG / ADMIN (vai trò `ADMIN` thì chỉ ADMIN): xác nhận tài khoản và đánh dấu email đã xác minh. Body `{ "role"?: … }`; nếu không truyền vai trò thì lấy theo `ADMIN_EMAILS`, không có thì PL |
| POST | `/users/pending/:email/reject` | PMO / MNG: xoá đăng ký chưa xác nhận |
| GET / PUT | `/settings` | Tần suất cập nhật và các ngưỡng, `maxChannelDetail` (PMO / quản lý) |
| GET / POST | `/channels` | Kênh thông báo `kind: teams` / `slack` (`webhookUrl`) hoặc `kind: telegram` (`connectCode`); thêm `detail`, `schedule`, `pausedUntil`. Mỗi người thấy kênh mình tạo, PMO / quản lý thấy tất cả. Khi tạo, hệ thống gửi tin thử, chỉ lưu nếu gửi được. `lang` (`vi` / `ja`) là ngôn ngữ tin gửi vào kênh, mặc định theo ngôn ngữ người tạo |
| GET / PUT / DELETE | `/settings/telegram` | Trạng thái bot (`configured`, `username`, `webhook: { active, url?, error? }`; ai đăng nhập cũng xem được; ADMIN thấy thêm `pendingUpdates`, `lastError`, `lastErrorAt`, `elsewhere` lấy từ `getWebhookInfo`). Cài token (`PUT { token }`: kiểm tra bằng `getMe`, rồi `setWebhook` tới `<URL API>/telegram/webhook` với `secret_token` ngẫu nhiên) hoặc gỡ bot (`deleteWebhook`): ADMIN. `setWebhook` lỗi thì bot vẫn được lưu, chạy một chiều (`webhook.error`) |
| POST | `/settings/telegram/webhook` | ADMIN: đặt lại webhook cho bot đã lưu (bot cài trước khi có webhook, hoặc sau khi lỗi), secret mới |
| POST | `/telegram/webhook` | **Không cần đăng nhập** — Telegram gọi. Từ chối (401, body `{}`) nếu header `X-Telegram-Bot-Api-Secret-Token` không khớp (so sánh thời gian hằng). Hợp lệ thì luôn trả `200 { ok: true }`, không bao giờ trả dữ liệu; xem "Telegram hai chiều" |
| PATCH / DELETE | `/channels/:id` | Sửa (tên, phạm vi, loại thông báo, giờ yên lặng / `schedule` / `pausedUntil`, `detail`, ngôn ngữ tin `lang`, bật / tắt, URL Teams / Slack — đổi URL Slack thì gửi tin thử trước khi lưu; Telegram: `connectCode` để chuyển sang nhóm khác — tìm nhóm như khi tạo và gửi tin thử) hoặc xoá: người tạo, PMO / quản lý |
| POST | `/channels/:id/test` | Gửi tin thử. Body `{ sample }`: `connect` (mặc định), hoặc mẫu tin thật lấy từ dữ liệu hiện tại trong phạm vi kênh: `became_red`, `high_issue`, `hourly`, `daily_digest`. Tiêu đề có `[Mẫu]`, không đánh dấu đã gửi nên không ảnh hưởng cảnh báo thật |
| GET / PUT / DELETE | `/settings/ai` | Trạng thái API key Claude (`configured`, `model`). Cài (`PUT { apiKey }`, được kiểm tra với Claude trước khi lưu) hoặc gỡ: ADMIN. Key không bao giờ được trả về |
| POST | `/ai/parse` | PL trở lên. Body `{ text, projectId? }` (≤ 4000 ký tự; `projectId` = dự án mặc định khi ghi chú không nêu dự án). Không xác định được dự án thì đề xuất vẫn được trả về với `needsProject: true` để người dùng chọn. Trả về `proposals` (đề xuất `update` / `item` / `item_status` / `item_update` / `project_create` / `project_update`, đã kiểm tra hợp lệ, có `error` nếu không ghi được) và `questions`. **Không ghi gì** — web hiển thị để người dùng sửa / bỏ chọn, rồi tự gọi các endpoint ở trên |
| POST | `/ai/ask` | Mọi người đã đăng nhập. Body `{ messages }`: hội thoại xen kẽ `user` / `assistant`, kết thúc bằng câu hỏi, tối đa 20 tin. Trả về `{ answer, truncated }`. Chỉ đọc |
| DELETE | `/projects/:id` | Xoá mềm dự án: PMO / quản lý |
| DELETE | `/projects/:id/items/:itemId` | Xoá mềm mục: người tạo, PL / GL của dự án, PMO / quản lý |
| DELETE | `/projects/:id/updates/:updateId` | Xoá mềm cập nhật: người viết trong 24 giờ, hoặc PMO / quản lý |
| GET | `/trash` | PMO / quản lý: dự án, mục, cập nhật, bình luận đã xoá (ai xoá, lúc nào) |
| POST | `/trash/restore` | PMO / quản lý. Body `{ kind: project \| item \| update \| comment, projectId, id? }`. Khôi phục mục của dự án đang bị xoá thì phải khôi phục dự án trước |
| POST | `/users/:email/reset-password` | PMO / MNG / ADMIN (không cho chính mình; tài khoản ADMIN thì chỉ ADMIN). Đặt mật khẩu tạm trong Cognito (`Permanent: false`), trả về `{ password }` một lần; lần đăng nhập sau Cognito yêu cầu `NEW_PASSWORD_REQUIRED`, web hiện bước đặt mật khẩu mới |
| GET | `/audit` | ADMIN: 50 thao tác mới nhất mỗi trang, `?before=<nextBefore>` để xem cũ hơn |

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
| 4 | Trang nhập bằng AI (Claude API, model Haiku 5.5) | Xong |
| 5 | Giao diện tiếng Nhật (web, lỗi API, tin thông báo theo kênh, hướng dẫn) | Xong |
| 6 | Thông báo: cá nhân, Slack, lịch gửi, độ tin cậy, giới hạn OTHER, Web Push, bot Telegram hai chiều (`docs/plans/notifications.md`) | Xong |
| 7 | Xu hướng màu theo ngày / tuần (trang dự án, Tổng quan, Excel), cảnh báo quá ngày kết thúc, dự án sắp kết thúc | Xong |
| 8 | Bình luận dưới cập nhật / mục, @gọi tên, thông báo cá nhân `mentioned` / `comment_reply` | Xong (chưa có: trả lời từ Telegram, bình luận trong Excel / ngữ cảnh AI) |

## Web

| Trang | Ai thấy | Nội dung |
|---|---|---|
| `/login` | Mọi người | Đăng nhập, đăng ký, xác nhận email, quên mật khẩu (gọi thẳng Cognito) |
| `/` Tổng quan | Đã đăng nhập | Ô số liệu, dự án cần chú ý, mốc / sự kiện sắp tới, vấn đề cần xử lý, dự án sắp kết thúc, trễ cập nhật, xu hướng 12 tuần (bảng theo tuần + xấu đi / tốt lên), theo GL. PL / GL / người hỗ trợ mặc định xem "Dự án của tôi", PMO / quản lý xem "Tất cả" |
| `/ai` ✦ AI | Đã đăng nhập (tab Nhập dữ liệu: PL trở lên) | Tab **Hỏi về dữ liệu** (`?tab=ask`): hỏi đáp chỉ đọc, giữ hội thoại trong trang. Tab **Nhập dữ liệu**: viết ghi chú tự do → AI đề xuất cập nhật, thêm / sửa / đổi trạng thái mục, tạo / sửa dự án → sửa, chọn rồi ghi. Cập nhật lưu kèm nguyên văn ghi chú (`rawText`) |
| `/help` Hướng dẫn | Mọi người (không cần đăng nhập) | Hướng dẫn sử dụng cho người mới: tài khoản, vai trò, trạng thái, cập nhật, mục, AI, dự án, thông báo, trang public, PMO, hỏi đáp. Cập nhật khi giao diện đổi |
| `/projects` | Đã đăng nhập | Danh sách, lọc theo tình trạng / phạm vi, tìm kiếm |
| `/projects/new`, `/projects/:id/edit` | PL trở lên / người có quyền sửa | Form dự án |
| `/projects/:id` | Đã đăng nhập | Thông tin, bình luận dưới từng cập nhật / mục (💬, gõ `@` để gọi tên; link `#update-<id>` / `#item-<id>` mở đúng chuỗi), xu hướng màu (lịch ô theo ngày: cột = tuần, hàng = thứ; bấm ô xem chi tiết ngày; kéo tới ngày kết thúc nếu còn ≤ 4 tuần; danh sách các quãng cùng màu), form cập nhật nhanh, lịch sử, vấn đề / sự kiện / mốc (thêm, đổi trạng thái) |
| `/users` | PMO / MNG | Thêm người dùng trước, đổi vai trò |
| `/settings` | PMO / SUBMNG / MNG / ADMIN | Tần suất, ngưỡng, mức chi tiết tối đa của kênh nhóm; ADMIN: AI, bot Telegram, nhật ký quản trị |
| `/trash` | PMO / quản lý | Thùng rác, khôi phục |
| `/channels` | Đã đăng nhập | Kênh nhóm (Telegram / Teams / Slack): đăng ký, sửa, gửi thử, nhật ký gửi, chuyển người phụ trách |
| `/me/notify` | Đã đăng nhập | Thông báo của tôi: nơi nhận (🔔, Telegram riêng, trình duyệt), loại tin, dự án theo dõi, lịch, tạm dừng |
| `/public` | Mọi người (internet) | Số dự án theo mức khẩn cấp, dự án khẩn cấp / cần chú ý, mốc và sự kiện sắp tới; tự làm mới mỗi phút |

**Điện thoại:** dưới 760px, menu thu vào nút ☰ (đóng lại sau mỗi lần chuyển trang). Trang AI có nút 🎤 nhập giọng nói (Web Speech API, `vi-VN` / `ja-JP` theo ngôn ngữ giao diện), chỉ hiện trên thiết bị cảm ứng; trình duyệt không hỗ trợ thì hướng dẫn dùng micro của bàn phím.

**Ngôn ngữ:** tiếng Việt (mặc định) và tiếng Nhật. Nút `VI / 日本語` ở thanh trên, trang đăng nhập, trang public và hướng dẫn; lựa chọn lưu trong trình duyệt (`localStorage`), lần đầu theo ngôn ngữ trình duyệt. Chuỗi giao diện viết cặp `l('tiếng Việt', '日本語')` (`web/src/i18n.ts`); đổi ngôn ngữ thì tải lại trang. Hướng dẫn tiếng Nhật ở `HelpJa.tsx`. Dữ liệu người dùng nhập (tên dự án, tình hình…) giữ nguyên ngôn ngữ gốc.

**Danh sách dài:** mỗi list hiện N dòng đầu và nút **Xem thêm (còn x)** / **Thu gọn** (`useShowMore`, dữ liệu đã tải sẵn): 5 dòng ở Tổng quan và trang public, 10 ở bảng mục của dự án, 20 ở danh sách dự án, người dùng (có ô tìm), thùng rác. Lịch sử cập nhật và nhật ký quản trị tải tiếp từ máy chủ theo con trỏ `nextBefore`. Khung lịch sử cập nhật cao bằng form cập nhật bên cạnh, phần dư cuộn bên trong.

Màu trạng thái (Xanh / Vàng / Đỏ) luôn đi kèm biểu tượng (● ▲ ■) và chữ, không dùng màu một mình. Ô của lịch xu hướng có ký hiệu bên trong (● ▲ ■, ‖ tạm dừng), có chú giải, và danh sách "Diễn biến" ghi lại bằng chữ.

**Test web** (`web/test/`, vitest + jsdom + Testing Library, chạy trong `npm test`):
- `unit/`: client API (`api.ts`: header ngôn ngữ / đăng nhập, lỗi, 401 → đăng xuất, tải file), Cognito (`auth.ts`, với Cognito giả: đăng nhập, mật khẩu tạm, làm mới token), Web Push (`push.ts`: tên thiết bị, id thiết bị giống API), định dạng ngày giờ, badge trạng thái (biểu tượng + chữ), "Xem thêm", hai bản hướng dẫn cùng mục lục.
- `pages/`: cả ứng dụng chạy với **API thật trong cùng tiến trình** (`harness.tsx`: `fetch('/api/…')` gọi thẳng `createApp` với `MemoryStore` + dữ liệu mẫu, giờ cố định ở "bây giờ" của dữ liệu mẫu). Kiểm tra Tổng quan (số liệu khớp API, phạm vi, lọc GL, OTHER, xuất Excel, menu theo vai trò), trang dự án (gửi / xoá cập nhật, phân trang lịch sử, thêm / đóng mục, quyền), form dự án, đăng nhập, trang public không lộ dữ liệu riêng, giao diện và lỗi API bằng tiếng Nhật.

**Test E2E** (`web/e2e/`, Playwright + Chromium, `npm run e2e`, job `e2e` trong CI): chạy bản build production (`vite build` + `vite preview`, `/config.json` của test) với API local (`api/src/local.ts`, `SAMPLE_NOW=1`: đồng hồ bắt đầu ở "bây giờ" của dữ liệu mẫu). Mỗi test hỏng nếu có lỗi console, exception hay request lỗi.
- Bản build tải cấu hình, đăng nhập, Tổng quan có số liệu và CSS.
- Mở thẳng đường dẫn / F5 / quay lại vẫn đúng trang và còn đăng nhập; chưa đăng nhập thì sau khi đăng nhập quay về trang đã mở; `/public`, `/help#muc` mở được (cuộn tới mục).
- PL cập nhật Đỏ → Tổng quan "Cần chú ý" → trang public "Khẩn cấp" (không lộ nội dung); test xoá lại cập nhật sau khi chạy.
- Đổi ngôn ngữ tải lại trang bằng tiếng Nhật, giữ khi chuyển trang / F5, quay lại VI.
- Điện thoại 390px: các trang chính không cuộn ngang; menu ☰ mở / đóng sau khi chuyển trang; bảng vấn đề / sự kiện / mốc thành thẻ, nút 💬 và ô bình luận nằm trong màn hình, ô chữ ≥ 16px (iOS không tự phóng to), danh sách @ hiện phía trên ô.
- Xuất Excel trên trình duyệt thật: file `.xlsx` có 4 sheet.
- Xu hướng: bảng tuần và xấu đi / tốt lên ở Tổng quan; lịch ô của dự án, bấm một ngày; dự án quá ngày kết thúc được cảnh báo.
- Bình luận: PMO gọi tên GL bằng `@` dưới cập nhật của PL; GL đăng nhập, mở 🔔, bấm tin → đúng chuỗi bình luận (API local nhận `WEB_URL` của `vite preview` để link cùng nguồn).
- Bản build: header bảo mật có đủ, service worker chạy được dưới CSP; trang ít dùng chỉ tải khi mở; tab cũ sau deploy tự tải lại.
- Chưa có: service worker / bật thông báo, hộp xác nhận xoá, kiểm tra tương phản, tự làm mới trang public.

## Thông báo (Teams / Telegram / Slack, cá nhân, Web Push) — `api/src/notify/`

### Kênh nhóm

**Kết nối Teams:**
- Mỗi kênh Teams tạo một Workflow từ mẫu *"Send webhook alerts to a channel"* (tên cũ: *"Post to a channel when a webhook request is received"*), rồi dán URL vào trang **Kênh thông báo**. Việc tạo Workflow cần quyền Power Automate (có môi trường Default).
- Hệ thống chỉ chấp nhận URL `https` thuộc `*.logic.azure.com` hoặc `*.powerplatform.com`. URL `*.webhook.office.com` (Office 365 connector, Microsoft đã ngừng) không nhận nữa; kênh cũ dùng host này vẫn gửi nhưng hiện cảnh báo (xem Độ tin cậy).
- URL này có tác dụng như mật khẩu: API không bao giờ trả về đầy đủ, chỉ trả về tên máy chủ và đầu đường dẫn.

**Telegram** (dùng khi tài khoản không có quyền Power Automate để tạo Workflows trong Teams):
- ADMIN cài **một bot** cho cả hệ thống: tạo bot bằng @BotFather, rồi dán token vào **Cài đặt → Bot Telegram**. Hệ thống kiểm tra token bằng `getMe` rồi đặt webhook (xem "Telegram hai chiều"). Token và secret của webhook lưu ở `CONFIG/TELEGRAM` trong DynamoDB và không bao giờ được trả về.
- Đăng ký nhóm: thêm bot vào nhóm và gửi dòng `/connect@<bot> PT-XXXXX` (web tạo sẵn mã). Webhook ghi nhớ mã nào đến từ chat nào (24 giờ), web tìm `chat.id` theo mã, gửi tin thử, gửi được thì mới lưu kênh. Bot chưa có webhook (cài trước đây, hoặc `setWebhook` lỗi) thì vẫn đọc `getUpdates` như cũ.
- Nội dung cảnh báo dùng chung với Teams (`notify/message.ts`). Teams nhận Adaptive Card, Telegram nhận HTML (`parse_mode: HTML`).

#### Telegram hai chiều (bot) — `api/src/bot/`, `routes/telegram.ts`

- **Webhook thay cho polling.** Lưu token → `setWebhook(url = <gốc URL của request>/telegram/webhook, secret_token, allowed_updates: message, channel_post, my_chat_member, callback_query)`. Lambda không biết URL API của chính nó từ CDK (sẽ thành vòng phụ thuộc), nên lấy từ request của ADMIN. Gỡ bot → `deleteWebhook`. Đổi sang bot khác → `deleteWebhook` cho bot cũ. Route `POST /telegram/webhook` trong CDK không có Cognito authorizer.
- **Bảo mật:** kiểm tra secret trước mọi việc khác (so sánh SHA-256 bằng `timingSafeEqual`), giới hạn body 256 KB, mỗi `update_id` chỉ xử lý một lần (Telegram gửi lại khi tưởng lỗi), mỗi chat tối đa 20 tin / nút mỗi phút và 10 ghi chú AI mỗi giờ (`bumpCounter`, khoá chứa hash của chat id). Lỗi xử lý vẫn trả 200 (không thì Telegram gửi lại mãi) và chỉ ghi log đã che token; không ghi chat id.
- **Mã kết nối:** mọi tin có `PT-XXXXX` được lưu `TEMP#tgcode#<mã>` → `{ id, title, type }` 24 giờ; tên các *nhóm* gần đây (`tgseen`, không có chat riêng) để giải thích khi không tìm thấy mã. Hai luồng `/connect@bot PT-…` (kênh nhóm) và `/start PT-…` (cá nhân) giữ nguyên trang và thông báo lỗi; bot trả lời "đã nhận mã, quay lại web".
- **Ai đang hỏi** (`who.ts`): chat riêng → người có `NotifyPrefs.telegramChatId` bằng chat đó; nhóm → kênh Telegram của nhóm (kênh đang bật trước), trả lời theo **phạm vi kênh và quyền xem của người tạo kênh**, ngôn ngữ `channel.lang`; kênh `compact` không hiện chữ người dùng gõ (tóm tắt, cần hỗ trợ, tên mục). Chat chưa liên kết → một dòng hướng dẫn (liên kết ở "Thông báo của tôi" / tạo kênh), theo ngôn ngữ app Telegram.
- **Lệnh:** `/mine` (dự án mình tham gia hoặc có mục phụ trách; trong nhóm: dự án của kênh), `/status P03` (trạng thái, trễ / hạn cập nhật, cập nhật gần nhất, vấn đề mở, sự kiện tới — dự án không được xem trả lời như không tồn tại), `/late`, `/help` (`/start` không mã = `/help`). Trong nhóm bot chỉ đọc lệnh gửi cho nó (`/lệnh@bot` hoặc privacy mode mặc định).
- **Nút** (chỉ trong chat riêng, chỉ khi webhook đang bật): `assigned_to_me` có "✓ Đóng mục"; tin nhắc việc theo giờ có "✓ Đóng mục" cho tối đa 3 mục `my_item_due` và "⏰ Hoãn nhắc 1 ngày". Đóng mục chạy `patchItem` (`projectOps.ts`, cùng code với `PATCH /projects/:id/items/:itemId`) với quyền của người đã liên kết; bấm lại khi mục đã đóng thì không ghi gì. Hoãn: `callback_data` trỏ tới `TEMP#tgsnz#<id>` (3 ngày) chứa các "chủ đề" của tin (`my_item_due#I0015`, `late_update_mine#P03`…); bấm → `markSent(P#<email>#snooze#<chủ đề>, 1 ngày)`, job mỗi giờ bỏ qua các chủ đề đó.
- **Ghi chú qua chat:** người đã liên kết, PL trở lên, gõ chữ tự do trong chat riêng → `buildContext` + `extract` + `toProposals` như `POST /ai/parse`. Đề xuất hợp lệ lưu ở `TEMP#tgai#<id>` 30 phút, bot trả danh sách kèm nút Xác nhận / Huỷ; đề xuất lỗi hoặc không rõ dự án được liệt kê riêng và không ghi. Xác nhận (chỉ đúng người, đúng chat; `takeTemp` nên bấm hai lần chỉ ghi một lần) → ghi theo thứ tự như web (dự án mới trước) qua `projectOps.ts` (kiểm tra schema, quyền, `emit` cảnh báo; cập nhật có `rawText`). Chưa cài API key AI → giải thích lịch sự, vẫn dùng được các lệnh.
- **Bot bị xoá khỏi chat** (`my_chat_member` → `left` / `kicked`): kênh nhóm bị tắt, `lastError` ghi lý do rõ ràng và cách sửa, người tạo kênh nhận tin trong hộp thư (`channel_broken`); chat riêng (người dùng chặn bot) → Telegram cá nhân tắt, bỏ `telegramChatId`, `telegramBroken` hiện ở "Thông báo của tôi" cho đến khi liên kết lại. `migrate_to_chat_id` (nhóm lên supergroup) → cập nhật `telegramChatId` của các kênh.
- Trạng thái ngắn hạn ở `TEMP#<khoá>` (`getTemp` / `putTemp` / `takeTemp` / `bumpCounter`, hết hạn qua `ttl`).

**Phạm vi** của mỗi kênh: tất cả dự án, một nhóm GL, hoặc danh sách dự án chọn sẵn.

| Loại | Khi nào gửi | Chống trùng |
|---|---|---|
| `became_red` | Ngay khi trạng thái tổng hợp chuyển sang Đỏ, sau một lần cập nhật | Chỉ khi trạng thái thay đổi; không báo lại trong 6 giờ (chống nhấp nháy) |
| `high_issue` | Sau 2 phút (gộp các vấn đề Cao cùng kênh) | Mỗi vấn đề một lần |
| `late_update` | Job mỗi giờ | Một lần cho mỗi hạn bị trễ, nhắc lại sau mỗi 24 giờ còn trễ |
| `overdue` | Job mỗi giờ | Mỗi mục một lần mỗi ngày |
| `milestone_soon` | Job mỗi giờ, trước `milestoneLeadDays` ngày (mặc định ngày mai) | Mỗi mục × mốc một lần |
| `daily_digest` | `digestHour` / `digestDays` (mặc định 08:00 hằng ngày, giờ Việt Nam) | Mỗi kênh một lần mỗi ngày |

**Cách gửi của job mỗi giờ:**
- Các cảnh báo của cùng một lượt chạy được gộp thành **một tin** cho mỗi kênh, tối đa 15 dòng.
- Một cảnh báo chỉ được đánh dấu "đã gửi" khi kênh nhận thành công. Nếu gửi lỗi thì giờ sau gửi lại, và lỗi được hiện trên trang kênh.
- Bản ghi chống trùng tự hết hạn nhờ TTL của DynamoDB.

**Ngôn ngữ tin:** mỗi kênh có `lang` (`vi` / `ja`); mọi tin gửi vào kênh (cảnh báo ngay, job mỗi giờ, tóm tắt, tin thử) dùng ngôn ngữ của kênh, không phụ thuộc người thao tác.

**Giờ yên lặng:** xem "Lịch gửi".

Teams lỗi không làm thất bại thao tác của người dùng, ví dụ lưu cập nhật vẫn thành công.

### Luồng xử lý (các file trong `api/src/notify/`)

- Route chỉ gọi `emit()` (`pipeline.ts`) sau khi lưu: `update_posted` (kèm trạng thái tổng hợp trước / sau) và `item_saved` (kèm bản trước khi sửa). Job mỗi giờ gọi `runHourly()`.
- `events.ts`: kiểu sự kiện và phần quét dữ liệu mỗi giờ (trễ, quá hạn, mốc). `routeChannels.ts`: chọn kênh nhóm theo phạm vi, loại tin, bật / tắt / tạm dừng, và `can.viewProject(người tạo kênh, dự án)` kiểm tra lúc gửi. `routePersonal.ts`: chọn người nhận cá nhân. `policy.ts`: giờ yên lặng, giờ tóm tắt, tạm dừng. `render.ts`: dựng tin. `deliver.ts`: gửi, ghi nhật ký gửi, hàng đợi. `sender.ts`: cách gửi theo loại kênh.
- Tin gửi ngay vẫn gửi trực tiếp trong request. Hàng đợi (`OUTBOX`) dành cho tin gửi trễ, gộp tin và gửi lại; Lambda `FlushFn` chạy mỗi phút (`flushDue`), mỗi tin chỉ được một lượt lấy (xoá có điều kiện) nên không gửi trùng.
- Mỗi lần gửi tới kênh nhóm được ghi vào `DELIVERY#<kênh>` (giữ 30 ngày).

### Thông báo cá nhân

- Cài đặt riêng của mỗi người (`NotifyPrefs`, khoá `NOTIFY` / email): loại tin, Telegram cá nhân, dự án theo dõi, lịch, tạm dừng. Chưa lưu thì dùng mặc định theo vai trò (`notify/personal.ts`).
- Hộp thư web (`INBOX#<email>`, giữ 60 ngày) luôn nhận; Telegram cá nhân nhận thêm nếu đã liên kết và `telegram: true`; Web Push nếu `push: true`. `chatId` cá nhân không bao giờ được trả về.

| Method | Path | Ghi chú |
|---|---|---|
| GET / PUT | `/me/notify` | Cài đặt của chính mình (`telegramLinked`, không có `chatId`); `telegram: true` chỉ có hiệu lực khi đã liên kết |
| DELETE | `/me/notify/telegram` | Gỡ Telegram cá nhân |
| GET | `/me/inbox?before=` | 30 tin mới nhất, `unread`, `nextBefore` |
| POST | `/me/inbox/read` | `{ ids }` hoặc `{ all: true }`; trả `unread` |
| POST | `/me/notify/telegram/link` | Tạo mã `PT-XXXXX` (hiệu lực 1 ngày, dùng 1 lần); trả `{ code, url: https://t.me/<bot>?start=<mã>, bot }`. 400 nếu chưa cài bot |
| POST | `/me/notify/telegram/confirm` | `{ code }`: tìm chat đã gửi `/start <mã>` (webhook ghi nhớ; bot chưa có webhook thì `getUpdates`), **chỉ nhận chat riêng**, gửi tin thử rồi lưu (`telegram: true`); trả `{ prefs }`. Lỗi rõ ràng: mã sai / hết hạn / của người khác, bot chưa nhận được mã, mã gửi trong nhóm (400), không đọc được / không gửi được Telegram (502). Không liệt kê chat của người khác |
| POST | `/me/notify/test` | Tin thử vào hộp thư, vào Telegram nếu đã liên kết (kể cả khi đang tắt), và vào trình duyệt nếu `push` bật: `{ inbox, telegram?: { ok, error? }, push?: { sent, failed, errors } }` |

**Ai nhận gì** (`notify/routePersonal.ts`, mặc định theo vai trò ở `notify/personal.ts`):

| Sự kiện | Khi nào | Người nhận | Mặc định bật cho |
|---|---|---|---|
| `update_due_soon` | Còn ≤ 4 giờ đến hạn cập nhật (một lần mỗi hạn) | PL (không có PL thì GL) | PL |
| `late_update_mine` | Đã trễ cập nhật; nhắc lại mỗi 24 giờ | PL (không có PL thì GL) | PL |
| `escalation` | Trễ ≥ 2 lần chu kỳ → GL; ≥ 4 lần → PMO của dự án (mỗi mức một lần mỗi hạn) | GL, PMO | GL, PMO / quản lý |
| `assigned_to_me` | Mục mới có người phụ trách, hoặc đổi người phụ trách (mục chưa đóng) | người phụ trách mới | mọi người |
| `my_item_due` | Mục mình phụ trách đến hạn ngày mai hoặc quá hạn; một tin mỗi ngày, từ giờ tóm tắt (08:00) | người phụ trách | mọi người |
| `need_help` | Cập nhật có "cần hỗ trợ" | GL, PMO của dự án | GL, PMO / quản lý |
| `health_changed` | Trạng thái tổng hợp đổi (cả hai chiều) sau một cập nhật | GL, PL, người theo dõi | GL |
| `watched_red` | Dự án theo dõi chuyển sang Đỏ | người theo dõi (`watch`) | mọi người |
| `watched_high_issue` | Vấn đề ưu tiên Cao mới ở dự án theo dõi | người theo dõi | mọi người |
| `mentioned` | Bình luận có `@{email}` của mình (sửa bình luận: chỉ người mới được thêm) | người được gọi tên | mọi người |
| `comment_reply` | Bình luận mới dưới một cập nhật / mục (mọi trạng thái dự án) | người viết cập nhật; người tạo và người phụ trách mục; những ai đã bình luận trong chuỗi | mọi người |

- Hai loại tin bình luận ra đời sau khi mọi người đã lưu cài đặt, nên được **bật một lần** cho cài đặt đã lưu (`eventsVersion` < 2 → thêm `ADDED_EVENTS` khi đọc, `withAddedEvents`); lần lưu sau ở "Thông báo của tôi" ghi `eventsVersion: 2` và giữ đúng lựa chọn.

- Chỉ gửi cho người có trong danh sách người dùng, **không gửi cho chính người gây ra sự kiện**, người nhận phải `can.viewProject`, và loại tin đó phải đang bật trong cài đặt.
- Một thay đổi chỉ tạo **một tin cho mỗi người**: nếu một người nhận vì nhiều lý do (ví dụ GL vừa `health_changed` vừa `need_help`), tiêu đề theo lý do quan trọng nhất (`watched_red` > `health_changed` > `need_help`; `assigned_to_me` > `watched_high_issue`), nội dung luôn có "cần hỗ trợ" nếu có. Nhắc việc theo giờ được gộp thành một tin "🔔 Nhắc việc của bạn (n)".
- Chỉ dự án đang chạy; riêng `assigned_to_me` gửi cả khi dự án tạm dừng.
- **Tạm dừng** (`pausedUntil`): không gửi gì, kể cả hộp thư. **Giờ yên lặng**: mặc định 22:00–07:00 giờ VN; tắt bằng `schedule.quietFrom = quietTo` (giờ từ / đến và `skipWeekends` chọn ở "Thông báo của tôi"; `skipWeekends` áp dụng giống giờ yên lặng). Tin tức thời trong giờ yên lặng vẫn vào hộp thư nhưng không gửi Telegram / Web Push (bị bỏ, không gửi bù); nhắc việc theo giờ thì chờ hết giờ yên lặng mới gửi (cả hộp thư lẫn Telegram).
- Chống trùng bằng `markSent` với khoá `P#<email>#<sự kiện>#…` (14 ngày), chỉ ghi khi đã gửi được.
- Tin được dựng trong `withLang(prefs.lang)`; `lang` lưu theo ngôn ngữ lúc người dùng lưu cài đặt / liên kết Telegram (chưa có thì tiếng Việt).
- **Web Push** (nhánh H, `notify/push.ts`, `routes/push.ts`, thư viện `web-push`): nơi nhận thứ ba `via: 'push'`, bật bằng `NotifyPrefs.push` (thiếu = tắt), theo đúng giờ yên lặng / tạm dừng như Telegram.
  - Khoá VAPID tạo lần đầu cần dùng, lưu ở `CONFIG` / `PUSH` (khoá riêng là **bí mật**, không endpoint nào trả về; tạo đồng thời thì giữ cặp ghi trước — `initPushConfig` ghi có điều kiện).
  - Thiết bị: `PUSH#<email>` / `<id>` với `id` = 16 ký tự hex đầu của sha-256(endpoint) (cùng trình duyệt đăng ký lại thì ghi đè), `label` ("Chrome · Windows"), `createdAt`, `lastSentAt`, `lastError`. Tối đa 10 thiết bị / người (bỏ thiết bị cũ nhất). Endpoint chỉ nhận dịch vụ push của trình duyệt (`*.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, https) vì API gửi request tới đó.
  - Gửi: `deliver.send` tách tin thành một lượt cho mỗi thiết bị (`subscriptionId`), nên gửi lại chỉ tới thiết bị lỗi. 404 / 410 → xoá thiết bị, không gửi lại; 429 / 5xx / lỗi mạng → đường gửi lại của nhánh C; 4xx khác → lỗi vĩnh viễn, giữ thiết bị kèm `lastError`. Payload JSON ≤ 3000 byte: `title`, `body` (tối đa 4 dòng đầu), `url`, `tag` = `project-<id>` (tin mới cùng dự án thay tin cũ) hoặc tên sự kiện; TTL 24 giờ, `urgency: high` cho tin `attention`.
  - Web: `web/public/sw.js` chỉ hiện thông báo và mở / focus ứng dụng tại link (link khác origin chỉ giữ đường dẫn); **không có handler `fetch`** nên không cache gì. Đăng ký mỗi lần tải trang với `updateViaCache: 'none'`; CloudFront có behavior `/sw.js` không cache. `manifest.webmanifest` + icon để thêm vào Màn hình chính (bắt buộc cho push trên iOS). Đăng xuất bằng nút trên thanh trên cùng sẽ xoá thiết bị và huỷ đăng ký của trình duyệt (máy dùng chung).

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/me/push/key` | `{ publicKey }` (tạo khoá VAPID nếu chưa có) |
| GET | `/me/push/subscriptions` | Thiết bị của mình: `{ id, label, createdAt, lastSentAt?, lastError? }`, không có endpoint / khoá |
| POST | `/me/push/subscriptions` | `{ endpoint, keys: { p256dh, auth }, label }` → 201 `{ subscription }` |
| DELETE | `/me/push/subscriptions/:id` | Chỉ thiết bị của mình (của người khác → 404) |

`PUT /me/notify` nhận thêm `push` (thiếu = giữ giá trị đã lưu). `POST /me/notify/test` gửi cả tới mọi thiết bị khi `push` bật: thêm `push: { sent, failed, errors }`.

### Lịch gửi

Mỗi kênh (và mỗi người, ở "Thông báo của tôi") có thể có `schedule` (`ChannelSchedule`) và `pausedUntil`. Quy tắc nằm ở `notify/policy.ts`; mọi giờ / ngày tính theo giờ Việt Nam.

| Trường | Ý nghĩa | Mặc định (kênh cũ không có `schedule`) |
|---|---|---|
| `quietFrom`, `quietTo` | Giờ yên lặng `[từ, đến)`, có thể qua đêm (23 → 6). Bằng nhau = không có giờ yên lặng | 22 → 7 nếu `quietHours`, không có nếu tắt |
| `skipWeekends` | Không gửi tin của job mỗi giờ và tóm tắt vào thứ 7, CN | tắt |
| `digestHour` | Giờ gửi tóm tắt (lượt chạy của giờ đó) | 8 |
| `digestDays` | `daily` mỗi ngày · `weekdays` thứ 2–6 · `monday` tóm tắt tuần sáng thứ 2 | `daily` |
| `milestoneLeadDays` | Báo trước mốc / sự kiện bao nhiêu ngày, ví dụ `[1, 3, 7]` | `[1]` |
| `pausedUntil` | Không gửi gì (kể cả tin ngay) trước thời điểm này. Web chọn "đến hết ngày" = 00:00 ngày hôm sau | — |

- Người ("Thông báo của tôi"): chỉ dùng `quietFrom` / `quietTo`, `skipWeekends` (và `digestHour` làm giờ gửi `my_item_due`, không chỉnh trên web); `pausedUntil` nằm ở `NotifyPrefs`.
- `schedule` thay cho `quietHours` khi có; web vẫn ghi `quietHours` = (có giờ yên lặng) để kênh cũ / danh sách hiển thị đúng.
- Giờ yên lặng và bỏ cuối tuần chỉ chặn tin của job mỗi giờ (trễ cập nhật, quá hạn, báo trước mốc); tin bị chặn được gửi ở lượt đầu tiên sau đó. Tóm tắt theo `digestHour` / `digestDays` (cuối tuần bị bỏ nếu `skipWeekends`), không bị giờ yên lặng chặn. Cảnh báo Đỏ và vấn đề Cao không bị chặn.
- **Báo trước mốc:** mục được nhắc ở mốc nhỏ nhất ≥ số ngày còn lại (≥ 1), mỗi mục × mốc một lần (khoá `soon#<mục>#<ngày>#<mốc>`; mốc 1 giữ khoá cũ `soon#<mục>#<ngày>`). Mục thêm muộn (còn 5 ngày, mốc `[1, 7]`) vẫn được nhắc một lần "còn 5 ngày".
- **Tóm tắt tuần** (`monday`): so với đúng thời điểm này tuần trước: dự án đổi màu (màu tuần trước dựng lại từ các cập nhật trước thời điểm đó; mục đóng sau thời điểm đó coi như còn mở; dự án mới tạo trong tuần không tính), mục đã đóng (`done`) trong tuần, mốc / sự kiện trong 7 ngày tới.
- **Gộp vấn đề Cao:** `deliver.send` gọi `policy.hold` trước mỗi lần gửi. Vấn đề Cao mới không gửi ngay mà vào hàng đợi (`high_issue_held`) với `dueAt` = +2 phút. Khi `flushDue` gửi tin đó, các tin vấn đề Cao khác của cùng kênh đang chờ và đã đến hạn được lấy (claim) và gộp thành một tin ("▲ 3 vấn đề ưu tiên cao mới ở P03"; nhiều dự án thì không ghi mã), sự kiện `high_issue_group`. Chỉ một vấn đề thì gửi nguyên tin cũ. Lần thử lại (`attempts` > 0) đi thẳng qua, nên tin gộp vẫn được thử lại, tính `failCount` và tự tạm dừng kênh như mọi tin khác.
- **Chống nhấp nháy:** kênh đã được báo dự án chuyển Đỏ thì trong 6 giờ sau không báo lại cho dự án đó (Đỏ → không Đỏ → Đỏ). Ghi bằng `markSent` theo ô 15 phút (`<kênh>#red#<dự án>#<ô>`) ngay lần gửi đầu; gửi lỗi thì hàng đợi thử lại như mọi tin khác. Kiểm tra 24 ô gần nhất.

### Độ tin cậy

**Thử lại** (`deliver.ts`):
- `send()` lỗi thì đưa tin vào hàng đợi (`enqueue`, `attempts` + 1, `lastError`), `flushDue` gửi lại sau 1 → 5 → 15 → 60 → 60 phút: tối đa 6 lần gửi cho một tin, kể cả lần đầu.
- Lỗi vĩnh viễn (`PermanentDeliveryError`, `notify/errors.ts`) không thử lại: Teams và Slack HTTP 4xx trừ 408 / 429 (Teams 404 / 410 = Workflow đã bị xoá; Slack 404 `no_service` / 410 `channel_is_archived`); Telegram 4xx trừ 429 ("bot was kicked", "chat not found", "bot was blocked", token sai).
- Tin của job mỗi giờ (có `sentKeys`) **không** vào hàng đợi khi lỗi: giờ sau job tự dựng lại, xếp hàng sẽ gửi trùng.
- Tin cá nhân (hộp thư, Telegram riêng, Web Push theo từng thiết bị) thử lại theo cùng quy tắc.
- Khi tới lượt gửi lại mà kênh đã bị xoá hoặc tắt thì bỏ tin.

**Tự tắt kênh:**
- `failCount` đếm số **tin bị mất** liên tiếp của kênh (lỗi vĩnh viễn, hết lượt thử lại, hoặc tin mỗi giờ lỗi); các lần thử lại giữa chừng không tính, nên Teams chập chờn vài phút không làm tắt kênh. Gửi thành công thì `failCount = 0`.
- Mất 5 tin liên tiếp: `enabled = false`, `autoPausedAt`, ghi audit `channel_auto_pause` (người thực hiện `system`), báo vào hộp thư của người phụ trách kênh (ngôn ngữ theo `NotifyPrefs.lang`, không có thì theo kênh).
- Bật lại kênh bằng tay thì xoá `autoPausedAt`, `failCount = 0`. "Gửi thử" lỗi không tính vào `failCount`.

**Telegram:** lỗi `migrate_to_chat_id` (nhóm lên supergroup) thì gửi lại vào chat mới và lưu `telegramChatId` mới vào kênh. "bot was kicked" / "chat not found" có thông báo rõ bằng hai ngôn ngữ, kèm cách sửa (Sửa → Đổi sang nhóm khác).

**Teams kiểu cũ:** kênh có URL `*.webhook.office.com` vẫn gửi, API trả `legacyWebhook: true` và web hiện cảnh báo "kiểu cũ, Microsoft đã ngừng — tạo Workflow mới".

**Cảnh báo hệ thống** (CloudWatch → SNS `Alarms`, `notify/alarms.ts`, Lambda `AlarmFn` = `cron.alarm`):

| Alarm (mô tả = khoá tin) | Đo gì | Ngưỡng |
|---|---|---|
| `api-5xx` | HTTP API trả 5xx | ≥ 5 trong 5 phút |
| `api-errors` / `api-throttles` | Lambda API lỗi / quá thời gian, bị giới hạn | ≥ 1 trong 5 phút |
| `cron-errors` | Lambda chạy mỗi giờ lỗi | ≥ 1 trong 1 giờ |
| `flush-errors` | Lambda gửi hàng đợi (mỗi phút) lỗi | ≥ 3 trong 5 phút |
| `table-throttles` / `table-errors` | DynamoDB bị giới hạn / lỗi hệ thống (Get/Put/Update/Delete/Query/Scan) | ≥ 1 trong 5 phút |
| `alarm-errors` | Chính `AlarmFn` lỗi | ≥ 1 trong 5 phút, chỉ gửi email |

- Khi alarm chuyển sang ALARM hoặc trở lại OK, `AlarmFn` gửi cho **mọi ADMIN** (sự kiện `system_alarm`): hộp thư luôn, Telegram riêng / Web Push nếu bật; không theo giờ yên lặng, không chống trùng (CloudWatch chỉ báo khi đổi trạng thái). Tin theo ngôn ngữ `NotifyPrefs.lang`; alarm lạ thì hiện tên alarm. Không có ADMIN thì chỉ ghi log.
- Biến GitHub `ALARM_EMAILS` (không bắt buộc) thêm đăng ký email vào SNS — dùng được khi chính ứng dụng / DynamoDB hỏng. Mỗi địa chỉ phải bấm xác nhận một lần.
- Thiếu dữ liệu (không có request) không tính là lỗi (`treatMissingData: notBreaching`).

**Không lộ bí mật:** lỗi được làm sạch (`scrubError`: bỏ token bot, bỏ phần query của mọi URL, bỏ đường dẫn của URL webhook Slack) trước khi ghi vào kênh, nhật ký gửi, hàng đợi, log Lambda hay trả về.

**Nhật ký, audit, người phụ trách:**

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/channels/:id/deliveries` | 20 lần gửi gần nhất (`DeliveryLog`); người phụ trách hoặc PMO / quản lý |
| POST | `/channels/:id/transfer` | `{ to }`: người phụ trách hoặc PMO / quản lý. Người nhận phải là người dùng có tài khoản đăng nhập (`Accounts.statuses` khác `none` / `pending`) |

- Audit: `channel_create`, `channel_update` (ghi các trường đổi: phạm vi, loại tin, bật / tắt, đổi nhóm Telegram, đổi URL — không ghi URL), `channel_delete`, `channel_transfer` (`cũ → mới`).
- "Người phụ trách" của kênh là `createdBy`.
- **Kênh mồ côi** (`orphan: true`, chỉ trong danh sách của PMO / quản lý): người phụ trách không còn trong danh sách người dùng, không có tài khoản đăng nhập, hoặc là OTHER không xem được dự án nào đó trong phạm vi. Web hiện nhãn ▲ **Mồ côi**.

### Slack

- `kind: 'slack'`, `webhookUrl` là Slack Incoming Webhook. Chỉ chấp nhận `https://hooks.slack.com/services/T…/B…/…` (https, không port, không user). API chỉ trả `webhookUrlMasked` = `https://hooks.slack.com/services/T…/…` (không bao giờ có phần kênh / khoá bí mật).
- Tạo kênh, hoặc đổi URL của kênh Slack, đều gửi tin thử trước khi lưu (như Teams khi tạo).
- `notify/slack.ts` dựng Block Kit từ `Message`: `header` (plain text, ≤ 150 ký tự); các dòng liền nhau cùng loại gộp vào một khối `section` (mrkdwn) hoặc `context` (dòng phụ), mỗi khối ≤ 3000 ký tự; nút link (`actions`). Escape `& < >` (chặn `<!channel>` và link giả), `**x**` → `*x*`. Có `text` thuần làm dự phòng cho thông báo điện thoại. Tối đa 50 khối; thừa thì khối cuối là "…".

**Mức chi tiết** (mọi loại kênh nhóm):
- `Channel.detail`: `full` (mặc định) hoặc `compact`. `Settings.maxChannelDetail = 'compact'` (PMO, Cài đặt) bắt mọi kênh nhóm rút gọn.
- `render.compact(msg)` bỏ nội dung người dùng nhập (tóm tắt, cần hỗ trợ, ghi chú, tên mục) và tên người; giữ tiêu đề (mã + tên dự án, số lượng), trạng thái, hạn, số lượng và link. Mỗi `MessageLine` có thể mang `compact` (chuỗi thay thế, hoặc `true` nếu dòng không có nội dung người dùng); dòng không có `compact` bị bỏ — dòng mới mặc định an toàn.
- Áp ở `createSender` (một chỗ cho mọi loại kênh, kể cả tin thử / tin mẫu). Thông báo cá nhân (`U:<email>`) không bị rút gọn.

### Quyền xem

- `can.viewProject(user, project, items?)` (`api/src/auth.ts`): mọi vai trò xem tất cả, trừ `OTHER`. `OTHER` chỉ xem dự án mình **tham gia** — là PL / GL / PMO / người hỗ trợ — **hoặc** phụ trách (`owner`) một mục chưa xoá của dự án đang mở hoặc đóng / sửa trong `SNAPSHOT_UPDATE_DAYS` (60) ngày gần nhất (`keepItem`; trang dự án — `loadProject` — dùng cùng luật với Tổng quan).
- `visibleProjects(user, snap)` / `visibleSnapshot(user, snap)` (`api/src/views.ts`) lọc dữ liệu trước khi dựng read model.
- Áp cho:
  - `GET /dashboard` (KPI, danh sách, thống kê theo GL chỉ đếm dự án xem được), `GET /projects`, `GET /export`;
  - `/projects/:id` và mọi đường con (`/updates`, `/items`, ghi cập nhật / mục, xoá): dự án không xem được trả **404** như không tồn tại;
  - AI: `/ai/ask` chỉ gửi dự án xem được; `/ai/parse` không đề xuất cho dự án không xem được (báo "không tìm thấy");
  - kênh nhóm: chỉ gửi tin của dự án mà **người tạo kênh** xem được, kiểm tra lúc gửi (`creatorSees` trong `routeChannels.ts`); tin mẫu `/channels/:id/test` cũng vậy. Lúc gửi, việc phụ trách mục được xét theo các mục đang mở của dự án (tin theo giờ, tóm tắt) hoặc mục vừa lưu (vấn đề Cao).
- Không đổi: danh sách người dùng (cần để hiện tên), trang public.
- Web: `OTHER` không có lựa chọn "Của tôi / Tất cả" ở Tổng quan và Dự án; trang ghi "chỉ hiện dự án bạn tham gia".


## Nhập bằng AI

- Gọi Claude API (`claude-haiku-5-5`, effort `low`, structured output theo JSON schema sinh từ zod) trong `api/src/ai/assistant.ts`. Prompt gồm: hôm nay + lịch 3 tuần (để AI tính "thứ 6", "tuần sau"), các dự án chưa đóng và mục đang mở của chúng, danh sách người dùng.
- Dự án mới trong ghi chú có mã tạm `NEW1`, `NEW2`…; web tạo dự án trước, rồi ghi các mục / cập nhật của nó bằng mã thật. Sửa dự án / sửa mục chỉ gửi các trường thực sự thay đổi, kèm giá trị hiện tại để so sánh. Người không có trong danh sách người dùng bị bỏ trống kèm cảnh báo.
- AI chỉ **đề xuất**. Mọi thay đổi đi qua REST API thường nên vẫn kiểm tra hợp lệ, phân quyền và bắn cảnh báo (chuyển Đỏ, vấn đề Cao) như nhập tay.
- API key lưu ở `CONFIG/AI` trong DynamoDB, PMO / quản lý cài ở Cài đặt → AI. Nên đặt giới hạn chi tiêu trên console.anthropic.com. Chi phí Haiku 5.5 rất nhỏ (khoảng vài nghìn token mỗi lần, $0.10 / 1M token vào).
- AI giữ ngôn ngữ của ghi chú (tiếng Việt, tiếng Nhật…) cho tóm tắt / tiêu đề; câu hỏi làm rõ viết theo ngôn ngữ giao diện của người viết.
- Thời gian chờ Claude 12 giây (thử lại 1 lần) để nằm trong giới hạn 30 giây của API Gateway.

## Hỏi AI về dữ liệu — `api/src/ai/ask.ts`

- Mỗi câu hỏi gửi kèm toàn bộ bức tranh: lịch 3 tuần, người dùng, mọi dự án (dự án đã đóng chỉ một dòng) với trạng thái, mức khẩn, trễ cập nhật **do hệ thống tính sẵn**, mục đang mở, mục đóng trong 60 ngày, tối đa 15 cập nhật trong 60 ngày. AI không tự tính lại các con số đó.
- Không có công cụ ghi: endpoint chỉ trả lời văn bản. Dữ liệu người dùng nhập được đánh dấu là dữ liệu, không phải chỉ dẫn.
- Khối dữ liệu đặt sau prompt hệ thống, có `cache_control`, nên các câu hỏi tiếp trong vài phút đọc từ cache.
- Một lần gọi, không thử lại, chờ tối đa 24 giây (giới hạn 30 giây của API Gateway). Trả lời tối đa 4000 token; bị cắt thì `truncated: true`.
- Hội thoại chỉ nằm trong trang web (không lưu); web gửi tối đa 19 tin gần nhất.

## Xoá mềm

- Dự án, cập nhật, mục có `deletedAt` / `deletedBy`. `Store.snapshot()`, `listUpdates()`, `listItems()` bỏ các dòng đã xoá và mọi dòng của dự án đã xoá; `snapshot({ includeDeleted: true })` (dự án, mục) và `listDeletedUpdates()` (cập nhật) dùng cho Thùng rác. `getProject` / `getItem` trả cả dòng đã xoá — route kiểm tra `deletedAt` và trả 404.
- Vì vậy dashboard, trang public, cảnh báo, AI đều không thấy dữ liệu đã xoá. Mã dự án đã xoá vẫn bị giữ (tạo trùng mã báo 409 kèm gợi ý khôi phục).
- Không có xoá cứng; khôi phục ở `/trash` (web: Cài đặt → Thùng rác).
