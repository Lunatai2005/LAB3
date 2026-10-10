# Lab 3 — E-commerce Microservices, Kafka và Saga

Hệ thống thương mại điện tử gồm API Gateway và bốn microservice, xây dựng bằng Node.js 22, Express 5, TypeScript, Prisma 7, PostgreSQL, KafkaJS, Apache Kafka và Docker Compose.

README này đi lần lượt theo 8 nội dung chấm. Các request Postman dùng URL và dữ liệu trực tiếp, **không cần tạo Postman Environment**.

## Chuẩn bị

```powershell
Copy-Item .env.example .env
npm install
npm run typecheck
```

Máy cần có Docker Desktop, Docker Compose v2, Node.js và Postman. Không commit `.env` vì file này chứa mật khẩu, JWT secret và internal API key.

## 1. Giải thích các protocol (proto) và cấu trúc dự án

### 1.1 Các protocol/contract đang sử dụng

Project hiện tại **không sử dụng gRPC và không có file Protocol Buffers `.proto`**. Từ “proto” trong phạm vi source này được hiểu là các giao thức/contract trao đổi dữ liệu sau:

| Contract | Công nghệ | Mục đích |
|---|---|---|
| Public API | REST/HTTP + JSON | Postman gọi API Gateway |
| Internal API | REST/HTTP + JSON | Order lấy product snapshot và membership/discount |
| Event contract | Kafka + JSON | Saga bất đồng bộ giữa các service |
| Persistence contract | Prisma schema | Mỗi service quản lý database riêng |

Nếu yêu cầu của giảng viên bắt buộc đúng file `.proto` và gRPC thì phiên bản này chưa đáp ứng phần đó; không nên gọi JSON contract là Protocol Buffers. Runtime thực tế có hai kiểu giao tiếp:

**Đồng bộ qua HTTP**

- Gateway chuyển `/api/v1/auth/*` sang Auth Service.
- Gateway chuyển `/api/v1/products/*` sang Catalog.
- Gateway chuyển `/api/v1/orders/*` sang Order.
- Gateway chuyển `/api/v1/shipments/*` sang Shipping.
- Order gọi `GET /internal/users/:id/discount` để lấy score/discount.
- Order gọi `POST /internal/products/snapshot` để lấy tên và giá sản phẩm.
- Internal API yêu cầu header `x-internal-api-key` và không được public qua Gateway.

**Bất đồng bộ qua Kafka**

Mọi event dùng chung envelope trong `shared/kafka.ts`:

```json
{
  "id": "UUID duy nhất của event",
  "type": "order.created",
  "occurredAt": "2026-10-09T10:00:00.000Z",
  "data": {
    "orderId": 1,
    "userId": 2,
    "items": [{ "productId": 1, "quantity": 1 }]
  }
}
```

`id` dùng chống xử lý trùng; `type` trùng tên topic; `occurredAt` là thời điểm phát; `data` là payload nghiệp vụ. Message dùng `orderId` làm key để các sự kiện cùng đơn vào cùng partition và giữ thứ tự.

### 1.2 Cấu trúc project

```text
lab3/
├── docker/postgres/
│   └── init-databases.sql         # Tạo 4 database khi volume khởi tạo
├── services/
│   ├── api-gateway/               # Một cổng public, reverse proxy
│   ├── auth/                      # User, JWT, score, membership
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   ├── catalog/                   # Product, tồn kho, reservation
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   ├── order/                     # Order, OrderLine, tính discount
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   └── shipping/                  # Shipment
│       ├── prisma/schema.prisma
│       └── src/
├── shared/
│   ├── auth.ts                    # Xác thực/phân quyền JWT
│   ├── kafka.ts                   # Event envelope, producer, consumer
│   ├── http.ts                    # Async/error handler
│   └── service-app.ts             # Khởi tạo Express service
├── compose.yaml                   # Ghép toàn bộ hạ tầng và service
├── Dockerfile                     # Build image Node.js dùng chung
└── package.json                   # Scripts và dependencies
```

Mỗi service sở hữu database riêng:

- `auth_db`: User, thông tin xác thực và score.
- `catalog_db`: Product, tồn kho và Reservation.
- `order_db`: Order, OrderLine và snapshot giá/discount.
- `shipping_db`: Shipment.

Không có foreign key xuyên service. Bảng `ProcessedEvent` ở consumer lưu `eventId` đã xử lý để việc Kafka gửi lại message không trừ kho, cộng điểm hoặc tạo shipment hai lần.

## 2. CLI: compose và liệt kê container đúng thiết kế

### Bước 1 — Kiểm tra cấu hình và chạy

```powershell
docker compose config --quiet
docker compose up --build -d
```

Nếu cổng `3000` bị project khác sử dụng:

```powershell
$env:GATEWAY_PORT = "3100"
docker compose up --build -d
```

Khi đó thay `localhost:3000` bằng `localhost:3100` trong các request bên dưới.

### Bước 2 — Liệt kê container

```powershell
docker compose ps -a
```

Thiết kế đúng có 9 container/service:

| Service | Trạng thái mong đợi | Vai trò |
|---|---|---|
| `postgres` | `Up (healthy)` | Chứa 4 database |
| `kafka` | `Up (healthy)` | Kafka broker + controller KRaft |
| `kafka-init` | `Exited (0)` | Tạo topic một lần |
| `migrate` | `Exited (0)` | `db push` và seed một lần |
| `auth` | `Up (healthy)` | Customer, JWT, membership |
| `catalog` | `Up (healthy)` | Product và inventory |
| `order` | `Up (healthy)` | Order và Saga |
| `shipping` | `Up (healthy)` | Shipment |
| `gateway` | `Up (healthy)` | Public API tại cổng 3000 |

`Exited (0)` của `kafka-init` và `migrate` là đúng vì đây là job chạy một lần, không phải lỗi.

### Bước 3 — System health check

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready | ConvertTo-Json -Depth 5
```

Kết quả `/health/ready` cần có `status: "ready"` và bốn service đều `true`.

```json
{
  "status": "ready",
  "services": {
    "auth": true,
    "catalog": true,
    "order": true,
    "shipping": true
  }
}
```

Nếu lỗi:

```powershell
docker compose logs --tail=100 postgres kafka migrate auth catalog order shipping gateway
```

## 3. Kiểm tra và giải thích hệ thống Kafka

### 3.1 Kiến trúc Kafka

Kafka chạy single-node theo chế độ **KRaft**, nên một container đóng cả vai trò broker và controller, không cần ZooKeeper.

- Container giao tiếp với Kafka qua `kafka:19092`.
- Máy host dùng `localhost:9092`.
- Mỗi topic có 3 partition và replication factor 1.
- Producer bật idempotent, `acks = -1`, `maxInFlightRequests = 1`.
- Consumer được chia theo group để mỗi event chỉ do một instance trong group xử lý.

Luồng Saga:

```text
Order tạo PENDING
  └─ order.created
       └─ Catalog kiểm tra và giữ kho
            ├─ inventory.reserved
            │    └─ Order → CONFIRMED → order.confirmed
            │                         ├─ Auth Service cộng score
            │                         └─ Shipping tạo shipment
            └─ inventory.rejected
                 └─ Order → CANCELLED → order.cancelled
                                          └─ Catalog hoàn kho nếu cần
```

### 3.2 Kiểm tra broker và topic

```powershell
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh `
  --bootstrap-server localhost:19092 --list
```

Bảy topic nghiệp vụ phải xuất hiện:

```text
inventory.rejected
inventory.reserved
order.cancelled
order.confirmed
order.created
shipment.cancelled
shipment.created
```

`__consumer_offsets` là topic nội bộ Kafka, xuất hiện là bình thường.

Xem cấu hình topic `order.created`:

```powershell
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh `
  --bootstrap-server localhost:19092 `
  --describe --topic order.created
```

Kết quả cần cho thấy `PartitionCount: 3`, `ReplicationFactor: 1` và leader hợp lệ.

### 3.3 Kiểm tra consumer group

```powershell
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh `
  --bootstrap-server localhost:19092 --list
```

Các group mong đợi:

```text
catalog-inventory
order-saga
shipping-saga
auth-loyalty
```

Kiểm tra offset/lag:

```powershell
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh `
  --bootstrap-server localhost:19092 `
  --describe --group order-saga
```

Khi hệ thống xử lý xong, `LAG` thường về `0`.

## Chuẩn bị token cho các testcase

Không dùng Postman Environment. Tạo request đăng ký:

```http
POST http://localhost:3000/api/v1/auth/register
Content-Type: application/json
```

```json
{
  "username": "customer01",
  "fullName": "Nguyen Van A",
  "password": "Customer@123"
}
```

Nếu `customer01` đã tồn tại, đổi sang tên khác hoặc đăng nhập:

```http
POST http://localhost:3000/api/v1/auth/login
Content-Type: application/json
```

```json
{
  "username": "customer01",
  "password": "Customer@123"
}
```

Sao chép nguyên giá trị `data.accessToken` trong response, không lấy dấu ngoặc kép. Giá trị này được gọi là **CUSTOMER_TOKEN**. Trong Postman chọn Authorization → `Bearer Token` và dán token vào ô Token; không nhập thêm chữ `Bearer` trong ô này.

## 4. TC-PRO-01: lấy danh sách Product

### Request

```http
GET http://localhost:3000/api/v1/products?page=1&limit=20
```

Không cần token. Có thể nhập thêm `search=Laptop` để tìm kiếm:

```http
GET http://localhost:3000/api/v1/products?page=1&limit=20&search=Laptop
```

### Kết quả mong đợi

- HTTP `200 OK`.
- `success = true`.
- `data` là mảng sản phẩm.
- Mỗi sản phẩm có `id`, `name`, `price`, `quantity`, `createdAt`.
- `meta` có `page`, `limit`, `search`, `total`.

Ví dụ rút gọn:

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Laptop MVP",
      "price": "1599.00",
      "quantity": 10
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 2 }
}
```

Giải thích: Gateway chuyển request sang Catalog service; Catalog dùng Prisma đọc `catalog_db`. Đây là public endpoint nên không có token vẫn thành công.

## 5. TC-CUS-04: lấy thông tin Membership

### Request

```http
GET http://localhost:3000/api/v1/auth/me
Authorization: Bearer <CUSTOMER_TOKEN>
```

Trong Postman, dán CUSTOMER_TOKEN đã sao chép vào Authorization → Bearer Token.

### Kết quả mong đợi

```json
{
  "success": true,
  "data": {
    "id": 2,
    "username": "customer01",
    "fullName": "Nguyen Van A",
    "role": "CUSTOMER",
    "score": 0,
    "membership": {
      "tier": "BASIC",
      "percent": 0
    }
  }
}
```

Membership không phải bảng riêng. Auth Service tính `tier` và `percent` từ `User.score`:

| Score | Membership | Discount |
|---:|---|---:|
| 0–99 | BASIC | 0% |
| 100–499 | SILVER | 5% |
| 500–999 | GOLD | 10% |
| từ 1000 | DIAMOND | 15% |

## 6. TC-CUS-05: truy vấn Customer không có token

Dùng lại request `/auth/me`, nhưng trong Postman chọn Authorization → `No Auth` và bảo đảm không có header `Authorization`.

```http
GET http://localhost:3000/api/v1/auth/me
```

Kết quả mong đợi: HTTP `401 Unauthorized`.

```json
{
  "success": false,
  "error": "Thiếu access token"
}
```

Giải thích: Gateway chuyển request đến Auth Service, sau đó middleware `authenticate` từ chối trước khi truy vấn user.

## 7. TC-ORD-04: tính discount theo score

Để kiểm tra rõ nhánh SILVER mà không phải tạo nhiều đơn, đặt score của customer thành `100` bằng CLI.

### Bước 1 — Tìm customer và cập nhật score

```powershell
docker compose exec postgres psql -U ecommerce -d auth_db
```

Trong `psql`:

```sql
SELECT id, username, score FROM "User" WHERE username = 'customer01';
UPDATE "User" SET score = 100 WHERE username = 'customer01';
SELECT id, username, score FROM "User" WHERE username = 'customer01';
\q
```

Gọi lại TC-CUS-04. Kết quả phải có `score = 100`, `tier = SILVER`, `percent = 5`.

### Bước 2 — Lấy ID sản phẩm

Gọi TC-PRO-01 và ghi lại `id` của `Laptop MVP`. Ví dụ bên dưới dùng `productId = 1`; thay bằng ID thật nếu khác.

### Bước 3 — Tạo đơn để kiểm tra phép tính

```http
POST http://localhost:3000/api/v1/orders
Authorization: Bearer <CUSTOMER_TOKEN>
Content-Type: application/json
```

```json
{
  "items": [
    { "productId": 1, "quantity": 1 }
  ]
}
```

Với giá Laptop là `1599.00` và score snapshot `100`:

```text
subtotal          = 1599.00
discountPercent   = 5
discountAmount    = round(1599.00 × 5 / 100) = 79.95
total             = 1599.00 - 79.95 = 1519.05
```

Response HTTP `202 Accepted` phải chứa các giá trị:

```json
{
  "status": "PENDING",
  "subtotal": "1599.00",
  "discountPercent": 5,
  "discountAmount": "79.95",
  "total": "1519.05",
  "scoreSnapshot": 100
}
```

Order lưu `scoreSnapshot` và discount ngay lúc tạo; score tăng sau đó không làm thay đổi đơn cũ. Phép tính dùng cents và làm tròn để tránh sai số số thực.

## 8. TC-ORD-05: tạo Order và phát sự kiện

### Bước 1 — Mở consumer quan sát event

Mở Terminal 1 trước khi gửi request:

```powershell
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh `
  --bootstrap-server localhost:19092 `
  --topic order.created `
  --property print.key=true `
  --property key.separator=" | "
```

Lệnh chờ message mới. Sau khi quan sát xong, nhấn `Ctrl+C` để thoát.

### Bước 2 — Tạo Order trong Postman

Ở Terminal/Postman thứ hai, gửi:

```http
POST http://localhost:3000/api/v1/orders
Authorization: Bearer <CUSTOMER_TOKEN>
Content-Type: application/json
```

```json
{
  "items": [
    { "productId": 1, "quantity": 1 }
  ]
}
```

Kết quả ban đầu là HTTP `202 Accepted`, `status = PENDING`, vì giữ kho và xác nhận chạy bất đồng bộ. Ghi lại `data.id` làm **ORDER_ID**.

Terminal 1 phải hiện event `order.created` tương tự:

```json
{"id":"...","type":"order.created","occurredAt":"...","data":{"orderId":2,"userId":2,"items":[{"productId":1,"quantity":1}]}}
```

### Bước 3 — Kiểm tra Saga hoàn tất

Chờ khoảng 2 giây rồi thay `2` bằng ORDER_ID thật:

```http
GET http://localhost:3000/api/v1/orders/2
Authorization: Bearer <CUSTOMER_TOKEN>
```

Kết quả thành công:

- Order chuyển `PENDING` → `CONFIRMED`.
- Catalog giảm tồn kho đúng quantity.
- Topic `inventory.reserved` và `order.confirmed` nhận event.
- Auth Service cộng `max(1, floor(total / 10))` điểm.
- Shipping tạo một shipment cho order.

Kiểm tra toàn chuỗi bằng CLI:

```powershell
docker compose logs --since=5m order catalog auth shipping kafka

docker compose exec postgres psql -U ecommerce -d order_db `
  -c 'SELECT id, status, subtotal, "discountPercent", "discountAmount", total, "scoreSnapshot" FROM "Order" ORDER BY id DESC LIMIT 5;'

docker compose exec postgres psql -U ecommerce -d shipping_db `
  -c 'SELECT id, "orderId", status, "createdAt" FROM "Shipment" ORDER BY id DESC LIMIT 5;'
```

Đăng nhập admin để xem shipment qua API:

```http
POST http://localhost:3000/api/v1/auth/login
Content-Type: application/json
```

```json
{ "username": "admin", "password": "Admin@123" }
```

Sao chép access token admin, sau đó gọi:

```http
GET http://localhost:3000/api/v1/shipments
Authorization: Bearer <ADMIN_TOKEN>
```

## Tổng kết kết quả chấm

| STT | Nội dung | Minh chứng chính |
|---:|---|---|
| 1 | Protocol và cấu trúc | Mục 1, REST/Internal/Kafka contracts, cây source |
| 2 | Compose/container | `docker compose ps -a`, đủ 9 service |
| 3 | Kafka | 7 topic, 4 consumer group, Saga/lag |
| 4 | TC-PRO-01 | Product API trả HTTP 200 |
| 5 | TC-CUS-04 | `/auth/me` trả score và membership |
| 6 | TC-CUS-05 | Không token trả HTTP 401 |
| 7 | TC-ORD-04 | Score 100 → SILVER 5%, total 1519.05 |
| 8 | TC-ORD-05 | HTTP 202, `order.created`, Order CONFIRMED, Shipment |

## Dừng hệ thống

Giữ dữ liệu:

```powershell
docker compose down
```

Chỉ khi muốn xóa toàn bộ database và Kafka data để demo lại từ đầu:

```powershell
docker compose down --volumes
```
