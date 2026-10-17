# Kế hoạch: thông báo cá nhân, Slack, độ tin cậy, lịch gửi, giới hạn OTHER

Kế hoạch này chia việc để **nhiều phiên làm song song**. Đợt 0 là nền chung, làm tuần tự, merge trước. Sau đó các nhánh A–F của Đợt 1 chạy đồng thời. Mỗi nhánh có danh sách file riêng nên ít conflict.

Đã quyết định:
- Email: chưa làm.
- Slack: thêm (webhook vào kênh Slack).
- Vai trò OTHER bị giới hạn xem dự án. Kênh thông báo theo đúng quyền xem của người tạo kênh.
- Web Push và Telegram hai chiều để Đợt 2.

## Sơ đồ phụ thuộc

```
Đợt 0  F0 Nền chung (1 phiên, merge trước)
          │
Đợt 1     ├── A  Thông báo cá nhân — API
          ├── B  Thông báo cá nhân — Web (dùng hợp đồng API của F0, merge sau A hoặc cùng lúc)
          ├── C  Độ tin cậy gửi tin
          ├── D  Lịch gửi & chống làm phiền
          ├── E  Slack + mức chi tiết tin
          └── F  Giới hạn quyền xem của OTHER
          │
Đợt 2     ├── G  Telegram hai chiều (webhook, lệnh, cập nhật bằng chat qua AI) — sau A
          ├── H  Web Push — sau A, B
          └── Z  Rà soát cuối: tài liệu, hướng dẫn, kiểm thử tích hợp
```

## Quy tắc chung cho mọi nhánh

- Mỗi nhánh một PR. Nhánh tạo từ `main` **sau khi F0 đã merge**.
- **File dùng chung** (`api/src/types.ts`, `api/src/schemas.ts`, `api/src/store/*`, `api/src/notify/pipeline.ts`, `web/src/App.tsx`): F0 đã thêm sẵn mọi kiểu, trường và phương thức. Các nhánh **không sửa** những file này, trừ khi bảng sở hữu ghi rõ. Nếu bắt buộc phải sửa thì chỉ thêm vào cuối khối đã đánh dấu `// track X`.
- **Tài liệu:** F0 chia sẵn mục "Thông báo" trong `docs/DESIGN.md`, `Help.tsx`, `HelpJa.tsx` thành các tiểu mục có tiêu đề. Mỗi nhánh chỉ sửa tiểu mục của mình. Conflict ở tài liệu thì giữ cả hai phần.
- **Test:** mỗi nhánh có file test riêng `api/test/notify-<nhánh>.test.ts`. Không sửa test của nhánh khác, trừ khi hành vi thay đổi có chủ đích.
- **Trước khi đẩy:** `npm test`, `npm run typecheck`, `npm run synth` (nếu đụng `infra/`).
- **Chuỗi hiển thị** luôn dùng `l('…', '…')`, cả tiếng Việt và tiếng Nhật.
- Tính tương thích ngược: kênh cũ trong DynamoDB thiếu trường mới thì phải chạy như hiện nay. Mọi trường mới đều tuỳ chọn và có giá trị mặc định.

---

## Đợt 0 — F0: Nền chung

Mục tiêu: đặt hợp đồng (kiểu dữ liệu, kho lưu, đường đi của sự kiện, khung giao diện) để các nhánh sau chỉ việc điền vào. **Hành vi người dùng thấy không đổi**, trừ: cảnh báo gửi ngay sẽ đi qua hàng đợi (trễ tối đa ~1 phút).

### F0.1 Kiểu dữ liệu (`api/src/types.ts`)

- `CHANNEL_KINDS = ['teams', 'telegram', 'slack']`. Slack đã có kiểu nhưng chưa bật ở giao diện; nhánh E bật.
- `Channel` thêm (đều tuỳ chọn):
  - `detail?: 'full' | 'compact'` (E)
  - `schedule?: ChannelSchedule` (D)
  - `pausedUntil?: string` (D)
  - `failCount?: number` (C)
  - `autoPausedAt?: string` (C)
- `ChannelSchedule`:
  - `quietFrom`, `quietTo` (giờ VN, 0–23; mặc định 22 → 7 nếu `quietHours`)
  - `skipWeekends?: boolean`
  - `digestHour?: number` (mặc định 8)
  - `digestDays?: 'daily' | 'weekdays' | 'monday'`
  - `milestoneLeadDays?: number[]` (mặc định `[1]`)
- `PERSONAL_EVENTS`:
  - `update_due_soon`
  - `late_update_mine`
  - `assigned_to_me`
  - `my_item_due`
  - `need_help`
  - `health_changed`
  - `watched_red`
  - `watched_high_issue`
  - `escalation`
- `NotifyPrefs`:
  - `{ userId, events: PersonalEvent[], telegramChatId?, telegramChatTitle?, telegram: boolean, watch: string[], schedule?: ChannelSchedule, pausedUntil?, lang?, updatedAt }`
  - Hộp thư web luôn bật.
- `InboxEntry`: `{ userId, id, at, title, lines, link?, projectId?, event, readAt? }`.
- `OutboxEntry`:
  - `{ id, dueAt, target: { channelId } | { userId, via: 'inbox' | 'telegram' }, event: string, dedupeKey?, message: Message, attempts, lastError? }`
- `DeliveryLog`: `{ channelId, at, id, ok, title, error? }`.
- `AUDIT_ACTIONS` thêm:
  - `channel_create`
  - `channel_update`
  - `channel_delete`
  - `channel_transfer`
  - `channel_auto_pause`

### F0.2 Kho lưu (`store.ts`, `memory.ts`, `dynamo.ts`)

Làm đầy đủ cho cả Memory và Dynamo, có test cơ bản.

| Phương thức | Khoá DynamoDB | TTL |
|---|---|---|
| `getNotifyPrefs(userId)`, `putNotifyPrefs`, `listNotifyPrefs()` | `NOTIFY` / `<userId>` | — |
| `addInbox`, `listInbox(userId, limit, before?)`, `markInboxRead(userId, ids \| 'all')`, `countUnread(userId)` | `INBOX#<userId>` / `<at>#<id>` | 60 ngày |
| `enqueue(entry)`, `listDue(now, limit)`, `putOutbox`, `deleteOutbox` | `OUTBOX` / `<dueAt>#<id>` | 7 ngày |
| `addDeliveryLog`, `listDeliveryLog(channelId, limit)` | `DELIVERY#<channelId>` / `<at>#<id>` | 30 ngày |

### F0.3 Đường đi của sự kiện (`api/src/notify/`)

Tách `alerts.ts` hiện tại thành các file nhỏ, mỗi file một nhánh sở hữu:

| File | Nội dung | Nhánh sửa sau |
|---|---|---|
| `events.ts` | Kiểu `NotifyEvent` và hàm tạo sự kiện. Gửi ngay: `update_posted`, `item_saved` (kèm bản trước). Theo giờ: thu thập trễ, quá hạn, mốc như hiện nay | D (thu thập theo giờ), A (sự kiện cá nhân) |
| `render.ts` | Dựng `Message` (chuyển nguyên các hàm message hiện có) | E (rút gọn), D (tóm tắt tuần) |
| `routeChannels.ts` | Chọn kênh nhóm cho mỗi sự kiện: phạm vi, loại tin, bật/tắt, **`canViewProject(người tạo, dự án)`** | F (quyền), D (lịch) |
| `routePersonal.ts` | Chọn người nhận cá nhân. F0 để `return []` | A |
| `policy.ts` | `isQuiet(schedule, now)`, `digestDue(schedule, now)`, `isPaused(x, now)`. F0 giữ đúng hành vi hiện tại | D |
| `deliver.ts` | `flushOutbox(deps, now)`: lấy tin đến hạn, gửi qua driver, ghi `DeliveryLog`, cập nhật `lastSentAt/lastError`. F0 không thử lại (giữ như hiện nay) | C |
| `drivers.ts` | Bảng `kind → { send(target, msg) }`: teams, telegram, slack (F0 để báo "chưa hỗ trợ"), inbox | E (slack), C (lỗi Telegram) |
| `pipeline.ts` | `emit(deps, event)` → route → `enqueue`. `runHourly` → tạo sự kiện → route → enqueue → flush | hạn chế sửa |

- `routes/projects.ts` chỉ gọi `emit()`:
  - sau khi lưu cập nhật: `update_posted`, có trạng thái trước / sau;
  - sau khi tạo hoặc sửa mục: `item_saved`, có bản trước.

  Không nhánh nào phải sửa `projects.ts` vì thông báo.
- `cron.ts` thêm handler `flush` để gửi tin trong hàng đợi. Infra thêm rule EventBridge `rate(1 minute)` gọi handler này. Rule hằng giờ vẫn giữ.
- Đường dẫn `POST /channels` (gửi tin thử khi tạo) vẫn gửi **trực tiếp**, không qua hàng đợi.
- `auth.ts` thêm `can.viewProject(u, p)`. F0 trả `true` cho mọi người; F làm quy tắc thật.

### F0.4 API hợp đồng cho thông báo cá nhân

F0 làm đầy đủ phần lưu và đọc; A làm phần logic gửi.

| Method | Path | Ghi chú |
|---|---|---|
| GET / PUT | `/me/notify` | Đọc / lưu `NotifyPrefs` của chính mình. Mặc định theo vai trò (bảng ở nhánh A) |
| GET | `/me/inbox?before=` | 30 tin, kèm `unread`, `nextBefore` |
| POST | `/me/inbox/read` | `{ ids }` hoặc `{ all: true }` |
| POST | `/me/notify/telegram/link` | A làm. F0 trả 501 |
| POST | `/me/notify/telegram/confirm` | A làm. F0 trả 501 |
| DELETE | `/me/notify/telegram` | Gỡ Telegram cá nhân |
| POST | `/me/notify/test` | A làm. F0 trả 501 |

### F0.5 Khung web

- Tách `web/src/pages/Channels.tsx` thành thư mục `web/src/pages/channels/`:
  - `ChannelsPage.tsx`
  - `ChannelList.tsx`
  - `ChannelForm.tsx`
  - `KindFields.tsx` (Teams / Telegram; E thêm Slack)
  - `ScheduleFields.tsx` (hiện chỉ có ô giờ yên lặng; D mở rộng)
  - `ChannelExtras.tsx` (chỗ để C gắn nhật ký gửi và chuyển người phụ trách)
- Thêm route `/me/notify` trỏ tới `web/src/pages/MyNotify.tsx`. F0 tạo trang trống có tiêu đề; B làm nội dung.
- Thêm chỗ đặt chuông `<InboxBell />` (`web/src/components/InboxBell.tsx`) trên thanh trên. F0 chỉ hiện số chưa đọc; B làm danh sách.
- Tài liệu: chia mục Thông báo trong `DESIGN.md`, `Help.tsx`, `HelpJa.tsx` thành các tiểu mục: Kênh nhóm · Thông báo cá nhân · Lịch gửi · Độ tin cậy · Slack · Quyền xem.

**Xong khi:** mọi test cũ vẫn qua và không đổi hành vi. Có test mới cho kho lưu, hàng đợi (emit → enqueue → flush gửi đúng kênh) và các endpoint `/me/*`. `npm run synth` qua.

---

## Đợt 1 — các nhánh song song

### Bảng sở hữu file

| Nhánh | Được sửa (API) | Được sửa (web) |
|---|---|---|
| A Cá nhân — API | `notify/routePersonal.ts`, `notify/personal.ts` (mới), `routes/me.ts` (phần telegram, test), phần cá nhân trong `notify/events.ts` | — |
| B Cá nhân — Web | — | `pages/MyNotify.tsx`, `components/InboxBell.tsx`, `components/notify/*` (mới), nút ⭐ theo dõi ở `pages/ProjectDetail.tsx` (chỉ phần tiêu đề) |
| C Độ tin cậy | `notify/deliver.ts`, `notify/drivers.ts` (phần teams/telegram), `notify/telegram.ts`, `notify/teams.ts`, `routes/channels.ts` | `pages/channels/ChannelExtras.tsx`, `ChannelList.tsx` |
| D Lịch gửi | `notify/policy.ts`, phần theo giờ trong `notify/events.ts`, phần tóm tắt trong `notify/render.ts` | `pages/channels/ScheduleFields.tsx` |
| E Slack + chi tiết | `notify/slack.ts` (mới), dòng slack trong `notify/drivers.ts`, hàm `compact()` trong `notify/render.ts`, hàm kiểm tra URL Slack | `pages/channels/KindFields.tsx` |
| F Quyền OTHER | `auth.ts` (`viewProject`), `views.ts`, `routes/projects.ts` (các đường đọc), `routes/ai.ts`, `ai/ask.ts`, `ai/proposals.ts`, `notify/routeChannels.ts` (chỉ chỗ gọi quyền) | màn hình liên quan nếu cần (ẩn nút, thông báo trống) |

Chỗ chồng nhau duy nhất:
- `notify/render.ts`: D sửa tóm tắt, E thêm `compact()` ở cuối file.
- `notify/drivers.ts`: C sửa teams/telegram, E thêm slack.
- `notify/events.ts`: A thêm sự kiện cá nhân, D sửa phần theo giờ.

F0 đặt sẵn các khối `// track A`, `// track C`, `// track D`, `// track E` để mỗi nhánh viết vào khối của mình.

---

### A — Thông báo cá nhân (API)

**Người nhận mặc định:**

| Sự kiện | Ai nhận | Mặc định bật cho |
|---|---|---|
| `update_due_soon`: còn ≤ 4 giờ đến hạn cập nhật | PL (không có PL thì GL) | PL |
| `late_update_mine`: đã trễ, nhắc mỗi 24 giờ | PL | PL |
| `escalation`: trễ ≥ 2 lần chu kỳ báo GL, ≥ 4 lần báo PMO của dự án | GL, PMO | GL, PMO |
| `assigned_to_me`: được đặt làm người phụ trách mục (tạo hoặc đổi `owner`, trừ khi tự gán) | owner | mọi người |
| `my_item_due`: mục mình phụ trách đến hạn ngày mai / quá hạn (một lần mỗi ngày) | owner | mọi người |
| `need_help`: cập nhật có "cần hỗ trợ" | GL, PMO của dự án | GL, PMO |
| `health_changed`: đổi trạng thái tổng hợp theo cả hai chiều | GL, PL, người theo dõi | GL |
| `watched_red`, `watched_high_issue` | người theo dõi (`watch`) | người theo dõi |

**Việc cần làm:**
- **Bộ lọc khi gửi cá nhân:**
  - Không gửi cho chính người gây ra sự kiện.
  - Người nhận phải `can.viewProject`.
  - Tôn trọng `pausedUntil` / `schedule` qua `policy.ts`.
  - Tin luôn vào hộp thư; gửi thêm Telegram nếu `telegram: true` và đã liên kết.
- **Chống trùng:** khoá dạng `P#<userId>#<sự kiện>#<…>`, dùng `markSent` sẵn có.
- **Liên kết Telegram cá nhân:**
  - `link` tạo mã `PT-XXXXX` và trả link `https://t.me/<bot>?start=PT-XXXXX`.
  - `confirm` tìm tin `/start PT-XXXXX` qua `findChatByText`. Chỉ nhận chat riêng (`chat.type === 'private'`; cần bổ sung `type` vào `TelegramChat`), gửi tin thử, rồi lưu.
- **`POST /me/notify/test`:** gửi một tin thử vào hộp thư và Telegram.
- **Ngôn ngữ tin cá nhân:** theo `NotifyPrefs.lang`, mặc định theo ngôn ngữ lúc lưu.

**Xong khi:** có test cho mỗi sự kiện. Test có các trường hợp: không tự báo mình, OTHER không nhận tin dự án không xem được, tạm dừng / giờ yên lặng, chống trùng, và liên kết Telegram có lỗi rõ ràng.

### B — Thông báo cá nhân (Web)

- **Trang "Thông báo của tôi"** (`/me/notify`):
  - Mục **Nơi nhận**: hộp thư web luôn bật; Telegram có nút **Kết nối** (mở link `t.me`, rồi nút **Tôi đã bấm Start**), trạng thái, nút gỡ và nút **Gửi thử**.
  - Mục **Loại tin**: ô chọn theo bảng của A, mỗi dòng có mô tả ngắn "khi nào gửi".
  - Mục **Dự án theo dõi**: danh sách và nút bỏ theo dõi.
  - Mục **Lịch**: dùng lại `ScheduleFields` (giờ yên lặng, bỏ cuối tuần). **Tạm dừng đến ngày…**
- **Chuông 🔔:**
  - Số chưa đọc, làm mới mỗi 60 giây hoặc khi quay lại tab.
  - Danh sách thả xuống 30 tin có **Xem thêm**, **Đánh dấu đã đọc tất cả**.
  - Bấm một tin để mở link và đánh dấu đã đọc.
- **Nút ⭐ Theo dõi** ở tiêu đề trang dự án.
- **Trạng thái** luôn có biểu tượng và chữ. Giao diện hai ngôn ngữ.
- Có thể làm trước khi A merge: dùng API của F0. Các endpoint 501 thì hiện "chưa khả dụng".

**Xong khi:** typecheck qua. Chụp màn hình trang trên `npm run dev` (máy rộng và điện thoại). Hướng dẫn Việt / Nhật có tiểu mục "Thông báo cá nhân".

### C — Độ tin cậy gửi tin

- **Thử lại trong `flushOutbox`:**
  - Lỗi thì `dueAt` lùi dần 1 → 5 → 15 → 60 phút, tối đa 6 lần.
  - Lỗi 4xx vĩnh viễn (URL không còn, bot bị xoá khỏi nhóm) thì không thử lại.
- **Tự tạm dừng kênh:**
  - `failCount` ≥ 5 lần liên tiếp thì đặt `enabled = false`, `autoPausedAt`.
  - Báo người tạo kênh vào hộp thư cá nhân. Ghi audit `channel_auto_pause`.
  - Gửi thành công thì đặt lại `failCount = 0`.
- **Telegram:**
  - Lỗi `migrate_to_chat_id` (nhóm lên supergroup) thì cập nhật `telegramChatId` và gửi lại.
  - "bot was kicked" / "chat not found" thì báo lỗi rõ bằng hai ngôn ngữ.
- **Teams:** bỏ `*.webhook.office.com` khỏi danh sách cho phép. Kênh cũ đang dùng host này hiện cảnh báo "kiểu cũ, Microsoft đã ngừng — tạo Workflow mới".
- **Nhật ký gửi:** `GET /channels/:id/deliveries` trả 20 lần gửi gần nhất. Web hiện trong `ChannelExtras`.
- **Audit:** ghi khi tạo / sửa (phạm vi, loại tin, chuyển nhóm) / xoá kênh.
- **Chuyển người phụ trách:**
  - `POST /channels/:id/transfer { to }`: người tạo hoặc PMO / quản lý.
  - Người nhận phải có tài khoản đăng nhập (`Accounts.statuses`).
- **Kênh mồ côi:** người tạo không còn tài khoản hoặc là OTHER không xem được phạm vi thì hiện nhãn ▲ ở danh sách kênh của PMO.

**Xong khi:** có test cho thử lại, tự tạm dừng, migrate, chuyển người phụ trách, audit; không lộ URL / token trong nhật ký và lỗi.

### D — Lịch gửi & chống làm phiền

- `policy.ts` làm đầy đủ `ChannelSchedule`:
  - giờ yên lặng tuỳ chỉnh, kể cả qua đêm;
  - bỏ thứ 7 / CN cho tin theo giờ và tóm tắt;
  - giờ gửi tóm tắt; tóm tắt hằng ngày / ngày làm việc / sáng thứ 2;
  - `pausedUntil`.
- **Tóm tắt tuần** (`monday`): so với tuần trước: dự án đổi màu, mục đã đóng, mốc trong 7 ngày tới.
- **Báo trước mốc:** `milestoneLeadDays` (ví dụ `[1, 3, 7]`), chống trùng theo từng mốc × số ngày.
- **Gộp tin dồn dập:** khi enqueue, nếu kênh đã có tin cùng loại đang chờ trong 2 phút thì gộp vào một tin. Ví dụ "3 vấn đề Cao mới ở P03" thay cho 3 tin.
- **Chống nhấp nháy:** dự án đổi Đỏ → không Đỏ → Đỏ trong 6 giờ chỉ báo lần đầu.
- **Giao diện:** `ScheduleFields.tsx` có ô giờ yên lặng từ / đến, bỏ cuối tuần, giờ tóm tắt, kiểu tóm tắt, báo trước mốc, tạm dừng đến ngày. Kênh cũ hiện đúng giá trị mặc định.

**Xong khi:** có test theo giờ VN cho các ngưỡng (21:59 / 22:00, qua đêm, thứ 7, thứ 2 08:00), gộp tin, chống nhấp nháy, kênh cũ không có `schedule`.

### E — Slack + mức chi tiết tin

- **Slack:**
  - `kind: 'slack'`, `webhookUrl` là Incoming Webhook. Chỉ chấp nhận `https://hooks.slack.com/services/…`.
  - Che URL như Teams (`webhookUrlMasked`, không bao giờ trả phần sau `/services/T…/`).
- **`notify/slack.ts`:**
  - Dựng Block Kit từ `Message`: tiêu đề, các dòng (mrkdwn, chuyển `**x**` thành `*x*`, escape `& < >`), nút link.
  - Có `text` dự phòng cho thông báo trên điện thoại. Giới hạn 50 block và 3000 ký tự mỗi khối.
- **Tạo / sửa kênh Slack:** gửi tin thử như Teams. Web có hướng dẫn ngắn: tạo Slack App → Incoming Webhooks → chọn kênh → dán URL.
- **Mức chi tiết** `detail: 'compact'`: `compact(msg)` bỏ nội dung người dùng nhập (tóm tắt, cần hỗ trợ, ghi chú, tên mục). Chỉ giữ mã dự án, tên dự án, trạng thái, hạn, số lượng và link. Áp cho mọi loại kênh nhóm.
- **PMO đặt mức tối đa toàn hệ thống** `Settings.maxChannelDetail`: nếu là `compact` thì mọi kênh nhóm đều rút gọn.

**Xong khi:** có test dựng Block Kit (escape, cắt dài), kiểm tra URL, che URL, rút gọn không còn chuỗi người dùng nhập.

### F — Giới hạn quyền xem của OTHER

**Quy tắc** (đề xuất, xác nhận trước khi làm):
- OTHER chỉ xem dự án mình **tham gia**: PL / GL / PMO / người hỗ trợ (`isInvolved`) **hoặc** đang phụ trách ít nhất một mục của dự án.
- Các vai trò khác xem tất cả như hiện nay.

**Việc cần làm:**
- `can.viewProject(u, p, items?)`; hàm tiện `visibleProjects(u, snap)`.
- Áp cho `GET /dashboard`, `/projects`, `/projects/:id` (404 nếu không xem được), `/projects/:id/updates`, `/items`.
- Áp cho ngữ cảnh AI: `ai/ask.ts` chỉ gửi dự án xem được; `ai/proposals.ts` không đề xuất cho dự án không xem được.
- Bộ lọc thống kê theo GL.
- **Kênh nhóm** (`routeChannels.ts`): chỉ gửi tin của dự án mà **người tạo kênh** xem được, kiểm tra lúc gửi. Tin mẫu (`/channels/:id/test`) cũng vậy.
- Danh sách người dùng vẫn để mọi người thấy (cần để hiện tên).
- Trang public không đổi.
- Web: trang tổng quan / dự án của OTHER không còn lựa chọn "Tất cả" vô nghĩa. Thông báo trống ghi rõ "chỉ hiện dự án bạn tham gia".

**Xong khi:** có test cho mỗi đường đọc, AI và kênh. Test `public` hiện có vẫn qua.

---

## Đợt 2 (sau khi Đợt 1 merge)

- **G — Telegram hai chiều.** Chuyển bot sang webhook (`setWebhook` với `secret_token`). Đây là route **không cần đăng nhập** mới, phải cập nhật quy tắc trong `CLAUDE.md`. Vì `getUpdates` không dùng được khi đã đặt webhook, phải chuyển luôn cách liên kết bằng mã. Lệnh `/mine`, `/status P03`, `/late`. Nút trong tin: "Đóng mục", "Hoãn nhắc 1 ngày". Gửi ghi chú vào chat riêng thì qua `/ai/parse`, bot hỏi lại để xác nhận rồi mới ghi, dùng quyền của người đã liên kết.
- **H — Web Push:** service worker, khoá VAPID (bí mật, lưu ở `CONFIG/PUSH`), nơi nhận cá nhân thứ ba trong trang "Thông báo của tôi".
- **Z — Rà soát cuối:** đọc lại toàn bộ hướng dẫn Việt / Nhật và `DESIGN.md`. Chạy thử đầu-cuối trên `npm run dev` với dữ liệu mẫu. Kiểm tra chi phí DynamoDB và Lambda của rule mỗi phút.

## Lệnh giao việc cho từng phiên

Mỗi phiên nhận một câu lệnh dạng:

> Làm nhánh **<X>** trong `docs/plans/notifications.md`. Tạo nhánh từ `main` mới nhất. Chỉ sửa các file của nhánh <X> theo bảng sở hữu; tuân thủ "Quy tắc chung". Viết test trong `api/test/notify-<x>.test.ts`, chạy `npm test` và `npm run typecheck`, cập nhật tiểu mục tương ứng trong `docs/DESIGN.md` và `Help.tsx` / `HelpJa.tsx`, rồi mở PR.
