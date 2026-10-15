# project-tracker

Hệ thống theo dõi dự án thay cho file Excel. Hệ thống có:
- dashboard theo người đăng nhập;
- dashboard **public** về mức khẩn cấp và sự kiện;
- cảnh báo qua Teams;
- nhập liệu bằng AI.

Chạy serverless trên AWS, chi phí khoảng vài USD/tháng.

- Thiết kế, quy tắc và danh sách API: [docs/DESIGN.md](docs/DESIGN.md)
- Setup AWS và deploy: [docs/SETUP-AWS.md](docs/SETUP-AWS.md)

## Cấu trúc

```
api/     Lambda API (TypeScript, Hono) + quy tắc nghiệp vụ + test
infra/   AWS CDK: DynamoDB, Cognito, API Gateway, Lambda, S3 + CloudFront
web/     React app (Vite): dashboard, dự án, người dùng, cài đặt, trang public
```

## Chạy trên máy

Cần Node.js 22.

```bash
npm install
npm test          # test quy tắc và API
npm run dev       # API ở http://localhost:3001, dữ liệu mẫu từ file Excel
npm run dev:web   # (terminal khác) web ở http://localhost:5173
```

Khi chạy trên máy:
- Tin Teams / Telegram chỉ được in ra console của API, và bot Telegram là bot giả. Đặt `LOCAL_SEND=1` nếu muốn gửi thật.
- Dữ liệu nằm trong bộ nhớ, tắt server là mất.
- Không cần Cognito: màn hình đăng nhập cho chọn người dùng mẫu (Lan · PMO, Hùng · GL, An · PL…).
