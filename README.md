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
web/     React app (giai đoạn 2)
```

## Chạy trên máy

Cần Node.js 22.

```bash
npm install
npm test          # test quy tắc và API
npm run dev       # API ở http://localhost:3001, dữ liệu mẫu từ file Excel
curl localhost:3001/public
curl -H 'x-dev-user: lan@example.com' localhost:3001/dashboard
```

Khi chạy trên máy, dữ liệu nằm trong bộ nhớ và đăng nhập bằng header `x-dev-user`.
