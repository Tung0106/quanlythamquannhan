# Hệ thống Đăng ký & Tổng hợp Thân nhân Thăm Quân nhân (Cloudflare Workers + D1)

Phiên bản viết riêng cho **Cloudflare Workers + D1 Database** (miễn phí 100%, chạy 24/7 không ngủ, có sẵn tên miền `https://...workers.dev`).

## Các bước cài đặt & deploy lên Cloudflare

### Bước 1: Tạo D1 Database miễn phí trên Cloudflare
1. Vào `https://dash.cloudflare.com` → menu bên trái chọn **Storage & Databases** → **D1 SQL Database**.
2. Bấm **Create** → đặt tên **`thamquannhan-db`** → bấm **Create**.
3. Copy mã **Database ID** vừa tạo (dạng `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
4. Mở file `wrangler.jsonc`, thay dòng `PASTE_YOUR_D1_DATABASE_ID_HERE` bằng mã **Database ID** đó.

### Bước 2: Đẩy toàn bộ thư mục này lên GitHub (`Tung0106/quanlythamquannhan`)
Đưa toàn bộ các file trong thư mục `quan-ly-tham-quan-nhan-cloudflare` (`package.json`, `wrangler.jsonc`, `schema.sql`, `src/`, `public/`) lên repository GitHub của bạn.

### Bước 3: Điền thông số trên màn hình "Set up your application" của Cloudflare
- **Project name**: `quanlythamquannhan`
- **Build command**: `npm install`
- **Deploy command**: `npx wrangler deploy`
- **Preview command**: `npx wrangler preview`
- Sau đó bấm nút **Deploy**.

### Bước 4: Cài đặt tài khoản & In mã QR
- Sau khi Deploy xong, bấm nút **Visit** để mở web của bạn (link `https://quanlythamquannhan.<ten-cua-ban>.workers.dev/`).
- Vào đường dẫn `/login` (hoặc bấm **Cán bộ đăng nhập**).
- Đăng nhập lần đầu: `trucban` / `QuanDoi@2026`.
- Hệ thống sẽ **tự động tạo các bảng trong D1 Database** ngay ở lần truy cập đầu tiên.
- Vào tab **Cài đặt & Tài khoản** để đổi mật khẩu / tên đăng nhập ngay, và vào tab **Mã QR Dán Cổng** để in Poster A4 dán cổng.
