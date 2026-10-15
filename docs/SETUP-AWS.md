# Hướng dẫn setup AWS và deploy

Làm **một lần**. Sau đó mỗi lần merge vào `main`, GitHub Actions tự deploy.
Không cần cài gì trên máy: mọi lệnh chạy trong **AWS CloudShell** (biểu tượng `>_` trên thanh trên cùng của AWS Console).

Region khuyến nghị: `ap-southeast-1` (Singapore). Chọn region này ở góc phải trên của Console trước khi mở CloudShell.

## 1. Bootstrap CDK

Trong CloudShell:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx --yes aws-cdk@2 bootstrap aws://$ACCOUNT/ap-southeast-1
```

## 2. Tạo role cho GitHub Actions (OIDC, không dùng access key)

```bash
curl -sO https://raw.githubusercontent.com/muilb/project-tracker/main/infra/bootstrap/github-oidc.yaml
aws cloudformation deploy \
  --template-file github-oidc.yaml \
  --stack-name project-tracker-github \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-stacks --stack-name project-tracker-github \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
```

- Lệnh cuối in ra **Role ARN**, dạng `arn:aws:iam::123456789012:role/project-tracker-github-deploy`.
- Nếu báo lỗi provider `token.actions.githubusercontent.com` đã tồn tại, chạy lại lệnh `deploy` và thêm `--parameter-overrides CreateOidcProvider=false`.
- Role này chỉ được phép assume các role `cdk-*` do bước 1 tạo ra, và chỉ khi chạy từ nhánh `main` của repo.

## 3. Khai báo biến trong GitHub

Vào repo → **Settings → Secrets and variables → Actions → tab Variables → New repository variable**:

| Tên | Giá trị |
|---|---|
| `AWS_ROLE_ARN` | Role ARN ở bước 2 |
| `AWS_REGION` | `ap-southeast-1` |
| `ADMIN_EMAILS` | Vai trò cấp khi **đăng nhập lần đầu**, cách nhau bằng dấu phẩy: `email` (mặc định PMO) hoặc `email:VAI_TRÒ` |

Đây là **variables**, không phải secrets: không có giá trị nào là bí mật.

Ví dụ `ADMIN_EMAILS`:

```
lan@cty.vn,sep@cty.vn:MNG,minh@cty.vn:SUBMNG,hung@cty.vn:GL
```

Các vai trò hợp lệ: `PL`, `GL`, `PMO`, `SUBMNG`, `MNG`, `OTHER`.
- Ai không có trong danh sách sẽ là `PL` khi đăng nhập lần đầu.
- Biến này chỉ áp dụng lúc **tạo tài khoản**. Người đã đăng nhập rồi thì PMO hoặc MNG đổi vai trò bằng `PATCH /users/<email>`, hoặc trên màn hình Người dùng từ giai đoạn 2.
- Ghi sai tên vai trò thì **deploy sẽ thất bại** và báo lỗi trong log. Bản đang chạy không bị ảnh hưởng.

## 4. Deploy

- Merge PR vào `main`, hoặc vào tab **Actions → Deploy → Run workflow**.
- Khi job chạy xong, mở log bước `npm run deploy` để xem các output:
  - `WebUrl`: địa chỉ web. Trang public nằm ở `WebUrl/public`.
  - `ApiUrl`: địa chỉ API. Thử mở `ApiUrl/health` và `ApiUrl/public`.
  - `TableName`: tên bảng DynamoDB.

## 5. (Tuỳ chọn) Nạp dữ liệu mẫu từ Excel

Chỉ dùng cho môi trường thử nghiệm. Script chỉ chạy khi bảng đang trống. Trong CloudShell:

```bash
git clone https://github.com/muilb/project-tracker && cd project-tracker
npm ci
npm run seed -- --table <TableName>
```

Người dùng mẫu có email `@example.com`, nên không đăng nhập bằng các tài khoản này được. Dữ liệu mẫu chỉ để xem dashboard.

## Chi phí

Với vài chục người dùng, chi phí ước tính khoảng $3–8/tháng; phần lớn nằm trong free tier.
Nên tạo cảnh báo: **Billing → Budgets → Create budget**, mức $15/tháng.

## Gỡ bỏ

```bash
npx --yes aws-cdk@2 destroy ProjectTracker-prod
```

Bảng DynamoDB và User Pool được giữ lại (`RETAIN`) để tránh mất dữ liệu. Muốn xoá hẳn thì xoá tay trong Console.

## Người dùng không nhận được email xác nhận

Mail công ty, nhất là Microsoft 365, hay chặn hoặc cách ly thư của Cognito gửi từ `no-reply@verificationemail.com`.

- **Cách thường dùng:** PMO / MNG vào trang **Người dùng → Chờ duyệt** và bấm **Duyệt**. Người đó đăng nhập được ngay bằng mật khẩu đã đặt lúc đăng ký.
- **Nếu muốn email tới được:** nhờ IT kiểm tra quarantine / message trace, rồi cho phép người gửi `verificationemail.com`.
- **Kiểm tra Cognito đã gửi thư chưa:** vào CloudTrail → Event history, lọc theo nguồn `cognito-idp.amazonaws.com`. Sự kiện `SignUp` hoặc `ResendConfirmationCode` báo thành công nghĩa là Cognito đã gửi thư đi.

## Nhận thông báo qua Telegram

1. **PMO / quản lý cài bot (một lần):**
   - Trong Telegram, chat với **@BotFather** → gửi `/newbot` → đặt tên và username (kết thúc bằng `bot`).
   - Copy **token** mà BotFather gửi lại.
   - Trên web: **Cài đặt → Bot Telegram**, dán token và bấm **Lưu bot**.
2. **Mỗi nhóm muốn nhận tin:**
   - Thêm bot vào nhóm Telegram.
   - Trên web: **Kênh thông báo → Đăng ký kênh → Telegram**. Copy dòng `/connect@… PT-…` mà web hiện ra, gửi vào nhóm, rồi bấm **Kết nối & gửi tin thử**.

Lưu ý:
- Mã kết nối phải được gửi trong vòng 24 giờ trước khi bấm Kết nối.
- Nếu nhóm thường được nâng cấp thành *supergroup*, ID nhóm sẽ đổi. Khi đó xoá kênh và kết nối lại.

