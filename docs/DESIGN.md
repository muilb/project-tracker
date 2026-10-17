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
  - Mail công ty hay chặn thư xác nhận của Cognito (`no-reply@verificationemail.com`). Vì vậy PMO / MNG có thể **duyệt** tài khoản chờ xác nhận ở trang Người dùng; menu hiện số tài khoản đang chờ. Lambda API được cấp các quyền `ListUsers`, `AdminGetUser`, `AdminConfirmSignUp`, `AdminUpdateUserAttributes`, `AdminDeleteUser`, chỉ trên user pool này.
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
| Quản trị hệ thống | `ADMIN` |

| Thao tác | Ai được làm |
|---|---|
| Xem dự án | Mọi người; riêng `OTHER` chỉ xem dự án mình tham gia (xem "Quyền xem") |
| Tạo dự án | PL trở lên (mọi vai trò trừ `OTHER`) |
| Sửa dự án, đổi trạng thái | PMO / SUBMNG / MNG, hoặc GL / PL của dự án |
| Ghi cập nhật, thêm/sửa vấn đề và sự kiện | Mọi người đã đăng nhập |
| Thêm/sửa người dùng, duyệt tài khoản, đặt lại mật khẩu | PMO / MNG / ADMIN (tài khoản `ADMIN` thì chỉ ADMIN) |
| Sửa cài đặt (tần suất, ngưỡng), xoá dự án, thùng rác | PMO / SUBMNG / MNG / ADMIN |
| API key AI, bot Telegram, cấp vai trò `ADMIN`, nhật ký quản trị | Chỉ `ADMIN` |

`ADMIN` đầu tiên: `ADMIN_EMAILS` (biến GitHub) có `email:ADMIN` → lần đăng nhập sau tài khoản đó được nâng lên ADMIN (các vai trò khác trong `ADMIN_EMAILS` chỉ áp dụng ở lần đăng nhập đầu). Không ai tự đổi vai trò của mình nên luôn còn ít nhất một ADMIN.

Nhật ký quản trị (`GET /audit`, ADMIN): đổi vai trò, thêm / duyệt / từ chối tài khoản, đặt lại mật khẩu, cài / gỡ key AI và bot, xoá dự án, khôi phục. Lưu ở `pk = AUDIT`, tự xoá sau 400 ngày (TTL).

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

Thông báo lỗi trả về theo header `Accept-Language` (`ja…` → tiếng Nhật, còn lại → tiếng Việt); web luôn gửi ngôn ngữ người dùng đang chọn.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Kiểm tra API còn sống |
| GET | `/public` | Dashboard public: số dự án theo mức khẩn cấp, dự án khẩn cấp / cần chú ý, mốc và sự kiện 7 ngày tới |
| GET | `/me` | Người đang đăng nhập |
| GET | `/dashboard?scope=all\|mine&gl=<email>` | Số liệu tổng, dự án cần chú ý, trễ cập nhật, vấn đề ưu tiên, sắp tới, thống kê theo GL |
| GET | `/projects?scope=mine&gl=&state=active\|paused\|closed\|all` | Danh sách dự án kèm số liệu đã tính |
| POST | `/projects` | Tạo dự án (PL trở lên). `id` tự sinh `P01, P02…` nếu không truyền |
| GET | `/projects/:id` | Chi tiết, 10 cập nhật gần nhất (+ `nextBefore` nếu còn cũ hơn), các vấn đề / sự kiện |
| PATCH | `/projects/:id` | Sửa thông tin, `state` (`active` / `paused` / `closed`), `publicVisible`, `publicName` |
| GET / POST | `/projects/:id/updates` | GET: trang cập nhật cũ hơn, `?before=<nextBefore>&limit=` (mặc định 20, tối đa 100) → `{ updates, nextBefore? }`. POST: ghi cập nhật `health`, `summary`, `needHelp` |
| GET / POST | `/projects/:id/items` | Vấn đề / sự kiện / mốc: `type` = `issue` / `event` / `milestone` |
| PATCH | `/projects/:id/items/:itemId` | Sửa, đóng mục (`status: done`) |
| GET / POST | `/users`, PATCH `/users/:email` | Người dùng; PMO tạo trước người chưa đăng nhập (chỉ tạo hồ sơ trong DynamoDB, **không** tạo tài khoản Cognito — người đó tự đăng ký bằng đúng email) |
| GET | `/users/accounts` | PMO / MNG: trạng thái tài khoản đăng nhập của từng người dùng (đọc từ Cognito): `none` (chưa đăng ký), `pending` (chờ xác nhận), `temp` (mật khẩu tạm chưa đổi), `active` |
| GET | `/users/pending` | PMO / MNG: các tài khoản đã đăng ký nhưng chưa xác nhận email (đọc từ Cognito) |
| POST | `/users/pending/:email/approve` | PMO / MNG / ADMIN (vai trò `ADMIN` thì chỉ ADMIN): xác nhận tài khoản và đánh dấu email đã xác minh. Body `{ "role"?: … }`; nếu không truyền vai trò thì lấy theo `ADMIN_EMAILS`, không có thì PL |
| POST | `/users/pending/:email/reject` | PMO / MNG: xoá đăng ký chưa xác nhận |
| GET / PUT | `/settings` | Tần suất cập nhật và các ngưỡng |
| GET / POST | `/channels` | Kênh thông báo `kind: teams` (`webhookUrl`) hoặc `kind: telegram` (`connectCode`). Mỗi người thấy kênh mình tạo, PMO / quản lý thấy tất cả. Khi tạo, hệ thống gửi tin thử, chỉ lưu nếu gửi được. `lang` (`vi` / `ja`) là ngôn ngữ tin gửi vào kênh, mặc định theo ngôn ngữ người tạo |
| GET / PUT / DELETE | `/settings/telegram` | Trạng thái bot (`configured`, `username`; ai đăng nhập cũng xem được). Cài token (`PUT { token }`) hoặc gỡ bot: PMO / quản lý |
| PATCH / DELETE | `/channels/:id` | Sửa (tên, phạm vi, loại thông báo, giờ yên lặng, ngôn ngữ tin `lang`, bật / tắt, URL Teams; Telegram: `connectCode` để chuyển sang nhóm khác — tìm nhóm như khi tạo và gửi tin thử) hoặc xoá: người tạo, PMO / quản lý |
| POST | `/channels/:id/test` | Gửi tin thử. Body `{ sample }`: `connect` (mặc định), hoặc mẫu tin thật lấy từ dữ liệu hiện tại trong phạm vi kênh: `became_red`, `high_issue`, `hourly`, `daily_digest`. Tiêu đề có `[Mẫu]`, không đánh dấu đã gửi nên không ảnh hưởng cảnh báo thật |
| GET / PUT / DELETE | `/settings/ai` | Trạng thái API key Claude (`configured`, `model`). Cài (`PUT { apiKey }`, được kiểm tra với Claude trước khi lưu) hoặc gỡ: PMO / quản lý. Key không bao giờ được trả về |
| POST | `/ai/parse` | PL trở lên. Body `{ text, projectId? }` (≤ 4000 ký tự; `projectId` = dự án mặc định khi ghi chú không nêu dự án). Không xác định được dự án thì đề xuất vẫn được trả về với `needsProject: true` để người dùng chọn. Trả về `proposals` (đề xuất `update` / `item` / `item_status` / `item_update` / `project_create` / `project_update`, đã kiểm tra hợp lệ, có `error` nếu không ghi được) và `questions`. **Không ghi gì** — web hiển thị để người dùng sửa / bỏ chọn, rồi tự gọi các endpoint ở trên |
| POST | `/ai/ask` | Mọi người đã đăng nhập. Body `{ messages }`: hội thoại xen kẽ `user` / `assistant`, kết thúc bằng câu hỏi, tối đa 20 tin. Trả về `{ answer, truncated }`. Chỉ đọc |
| DELETE | `/projects/:id` | Xoá mềm dự án: PMO / quản lý |
| DELETE | `/projects/:id/items/:itemId` | Xoá mềm mục: người tạo, PL / GL của dự án, PMO / quản lý |
| DELETE | `/projects/:id/updates/:updateId` | Xoá mềm cập nhật: người viết trong 24 giờ, hoặc PMO / quản lý |
| GET | `/trash` | PMO / quản lý: dự án, mục, cập nhật đã xoá (ai xoá, lúc nào) |
| POST | `/trash/restore` | PMO / quản lý. Body `{ kind: project \| item \| update, projectId, id? }`. Khôi phục mục của dự án đang bị xoá thì phải khôi phục dự án trước |
| POST | `/users/:email/reset-password` | PMO / MNG (không cho chính mình). Đặt mật khẩu tạm trong Cognito (`Permanent: false`), trả về `{ password }` một lần; lần đăng nhập sau Cognito yêu cầu `NEW_PASSWORD_REQUIRED`, web hiện bước đặt mật khẩu mới |
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

## Web

| Trang | Ai thấy | Nội dung |
|---|---|---|
| `/login` | Mọi người | Đăng nhập, đăng ký, xác nhận email, quên mật khẩu (gọi thẳng Cognito) |
| `/` Tổng quan | Đã đăng nhập | Ô số liệu, dự án cần chú ý, mốc / sự kiện sắp tới, vấn đề cần xử lý, trễ cập nhật, theo GL. PL / GL / người hỗ trợ mặc định xem "Dự án của tôi", PMO / quản lý xem "Tất cả" |
| `/ai` ✦ AI | Đã đăng nhập (tab Nhập dữ liệu: PL trở lên) | Tab **Hỏi về dữ liệu** (`?tab=ask`): hỏi đáp chỉ đọc, giữ hội thoại trong trang. Tab **Nhập dữ liệu**: viết ghi chú tự do → AI đề xuất cập nhật, thêm / sửa / đổi trạng thái mục, tạo / sửa dự án → sửa, chọn rồi ghi. Cập nhật lưu kèm nguyên văn ghi chú (`rawText`) |
| `/help` Hướng dẫn | Mọi người (không cần đăng nhập) | Hướng dẫn sử dụng cho người mới: tài khoản, vai trò, trạng thái, cập nhật, mục, AI, dự án, thông báo, trang public, PMO, hỏi đáp. Cập nhật khi giao diện đổi |
| `/projects` | Đã đăng nhập | Danh sách, lọc theo tình trạng / phạm vi, tìm kiếm |
| `/projects/new`, `/projects/:id/edit` | PL trở lên / người có quyền sửa | Form dự án |
| `/projects/:id` | Đã đăng nhập | Thông tin, form cập nhật nhanh, lịch sử, vấn đề / sự kiện / mốc (thêm, đổi trạng thái) |
| `/users` | PMO / MNG | Thêm người dùng trước, đổi vai trò |
| `/settings` | PMO / SUBMNG / MNG | Tần suất, ngưỡng |
| `/public` | Mọi người (internet) | Số dự án theo mức khẩn cấp, dự án khẩn cấp / cần chú ý, mốc và sự kiện sắp tới; tự làm mới mỗi phút |

**Điện thoại:** dưới 760px, menu thu vào nút ☰ (đóng lại sau mỗi lần chuyển trang). Trang AI có nút 🎤 nhập giọng nói (Web Speech API, `vi-VN` / `ja-JP` theo ngôn ngữ giao diện), chỉ hiện trên thiết bị cảm ứng; trình duyệt không hỗ trợ thì hướng dẫn dùng micro của bàn phím.

**Ngôn ngữ:** tiếng Việt (mặc định) và tiếng Nhật. Nút `VI / 日本語` ở thanh trên, trang đăng nhập, trang public và hướng dẫn; lựa chọn lưu trong trình duyệt (`localStorage`), lần đầu theo ngôn ngữ trình duyệt. Chuỗi giao diện viết cặp `l('tiếng Việt', '日本語')` (`web/src/i18n.ts`); đổi ngôn ngữ thì tải lại trang. Hướng dẫn tiếng Nhật ở `HelpJa.tsx`. Dữ liệu người dùng nhập (tên dự án, tình hình…) giữ nguyên ngôn ngữ gốc.

**Danh sách dài:** mỗi list hiện N dòng đầu và nút **Xem thêm (còn x)** / **Thu gọn** (`useShowMore`, dữ liệu đã tải sẵn): 5 dòng ở Tổng quan và trang public, 10 ở bảng mục của dự án, 20 ở danh sách dự án, người dùng (có ô tìm), thùng rác. Lịch sử cập nhật và nhật ký quản trị tải tiếp từ máy chủ theo con trỏ `nextBefore`. Khung lịch sử cập nhật cao bằng form cập nhật bên cạnh, phần dư cuộn bên trong.

Màu trạng thái (Xanh / Vàng / Đỏ) luôn đi kèm biểu tượng (● ▲ ■) và chữ, không dùng màu một mình.

## Thông báo Teams / Telegram — `api/src/notify/`

### Kênh nhóm

**Kết nối Teams:**
- Mỗi kênh Teams tạo một Workflow từ mẫu *"Send webhook alerts to a channel"* (tên cũ: *"Post to a channel when a webhook request is received"*), rồi dán URL vào trang **Kênh thông báo**. Việc tạo Workflow cần quyền Power Automate (có môi trường Default).
- Hệ thống chỉ chấp nhận URL `https` thuộc `*.logic.azure.com`, `*.powerplatform.com` hoặc `*.webhook.office.com`.
- URL này có tác dụng như mật khẩu: API không bao giờ trả về đầy đủ, chỉ trả về tên máy chủ và đầu đường dẫn.

**Telegram** (dùng khi tài khoản không có quyền Power Automate để tạo Workflows trong Teams):
- PMO / quản lý cài **một bot** cho cả hệ thống: tạo bot bằng @BotFather, rồi dán token vào **Cài đặt → Bot Telegram**. Hệ thống kiểm tra token bằng `getMe`. Token lưu ở `CONFIG/TELEGRAM` trong DynamoDB và không bao giờ được trả về.
- Đăng ký nhóm: thêm bot vào nhóm và gửi dòng `/connect@<bot> PT-XXXXX` (web tạo sẵn mã). Hệ thống đọc `getUpdates` của bot để tìm `chat.id` theo mã, gửi tin thử, gửi được thì mới lưu kênh. Không cần endpoint nhận webhook từ Telegram.
- Nội dung cảnh báo dùng chung với Teams (`notify/message.ts`). Teams nhận Adaptive Card, Telegram nhận HTML (`parse_mode: HTML`).

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

**Ngôn ngữ tin:** mỗi kênh có `lang` (`vi` / `ja`); mọi tin gửi vào kênh (cảnh báo ngay, job mỗi giờ, tóm tắt, tin thử) dùng ngôn ngữ của kênh, không phụ thuộc người thao tác.

**Giờ yên lặng** (22h–7h, tuỳ chọn cho từng kênh) chỉ chặn các tin của job mỗi giờ. Cảnh báo Đỏ và vấn đề Cao vẫn gửi ngay.

Teams lỗi không làm thất bại thao tác của người dùng, ví dụ lưu cập nhật vẫn thành công.

### Luồng xử lý (các file trong `api/src/notify/`)

- Route chỉ gọi `emit()` (`pipeline.ts`) sau khi lưu: `update_posted` (kèm trạng thái tổng hợp trước / sau) và `item_saved` (kèm bản trước khi sửa). Job mỗi giờ gọi `runHourly()`.
- `events.ts`: kiểu sự kiện và phần quét dữ liệu mỗi giờ (trễ, quá hạn, mốc). `routeChannels.ts`: chọn kênh nhóm theo phạm vi, loại tin, bật / tắt / tạm dừng, và `can.viewProject(người tạo kênh, dự án)` kiểm tra lúc gửi. `routePersonal.ts`: chọn người nhận cá nhân. `policy.ts`: giờ yên lặng, giờ tóm tắt, tạm dừng. `render.ts`: dựng tin. `deliver.ts`: gửi, ghi nhật ký gửi, hàng đợi. `sender.ts`: cách gửi theo loại kênh.
- Tin gửi ngay vẫn gửi trực tiếp trong request. Hàng đợi (`OUTBOX`) dành cho tin gửi trễ, gộp tin và gửi lại; Lambda `FlushFn` chạy mỗi phút (`flushDue`), mỗi tin chỉ được một lượt lấy (xoá có điều kiện) nên không gửi trùng.
- Mỗi lần gửi tới kênh nhóm được ghi vào `DELIVERY#<kênh>` (giữ 30 ngày).

### Thông báo cá nhân

- Cài đặt riêng của mỗi người (`NotifyPrefs`, khoá `NOTIFY` / email): loại tin, Telegram cá nhân, dự án theo dõi, lịch, tạm dừng. Chưa lưu thì dùng mặc định theo vai trò (`notify/personal.ts`).
- Hộp thư web (`INBOX#<email>`, giữ 60 ngày) luôn nhận; Telegram cá nhân nhận thêm nếu đã liên kết. `chatId` cá nhân không bao giờ được trả về.

| Method | Path | Ghi chú |
|---|---|---|
| GET / PUT | `/me/notify` | Cài đặt của chính mình (`telegramLinked`, không có `chatId`); `telegram: true` chỉ có hiệu lực khi đã liên kết |
| DELETE | `/me/notify/telegram` | Gỡ Telegram cá nhân |
| GET | `/me/inbox?before=` | 30 tin mới nhất, `unread`, `nextBefore` |
| POST | `/me/inbox/read` | `{ ids }` hoặc `{ all: true }`; trả `unread` |

### Lịch gửi

_Nhánh D (`docs/plans/notifications.md`)._

### Độ tin cậy

_Nhánh C._

### Slack

_Nhánh E._

### Quyền xem

- `can.viewProject(user, project, items?)` (`api/src/auth.ts`): mọi vai trò xem tất cả, trừ `OTHER`. `OTHER` chỉ xem dự án mình **tham gia** — là PL / GL / PMO / người hỗ trợ — **hoặc** phụ trách (`owner`) ít nhất một mục chưa xoá của dự án.
- `visibleProjects(user, snap)` / `visibleSnapshot(user, snap)` (`api/src/views.ts`) lọc dữ liệu trước khi dựng read model.
- Áp cho:
  - `GET /dashboard` (KPI, danh sách, thống kê theo GL chỉ đếm dự án xem được), `GET /projects`;
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

- Dự án, cập nhật, mục có `deletedAt` / `deletedBy`. `Store.snapshot()`, `listUpdates()`, `listItems()` bỏ các dòng đã xoá và mọi dòng của dự án đã xoá; `snapshot({ includeDeleted: true })` dùng cho Thùng rác. `getProject` / `getItem` trả cả dòng đã xoá — route kiểm tra `deletedAt` và trả 404.
- Vì vậy dashboard, trang public, cảnh báo, AI đều không thấy dữ liệu đã xoá. Mã dự án đã xoá vẫn bị giữ (tạo trùng mã báo 409 kèm gợi ý khôi phục).
- Không có xoá cứng; khôi phục ở `/trash` (web: Cài đặt → Thùng rác).
