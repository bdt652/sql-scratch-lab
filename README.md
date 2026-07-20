# SQLite Scratch Lab

[![Deploy GitHub Pages](https://github.com/bdt652/sql-scratch-lab/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/bdt652/sql-scratch-lab/actions/workflows/deploy-pages.yml)

Một SQLite studio chạy hoàn toàn trong trình duyệt, kết hợp **SQL Editor** với giao diện **kéo thả kiểu Scratch**. Dự án dùng HTML, CSS và JavaScript thuần; SQLite được thực thi thật bằng WebAssembly.

## Bản chạy trực tuyến

<https://bdt652.github.io/sql-scratch-lab/>

## Chức năng

- Tạo, mở, đổi tên và xóa nhiều SQLite database.
- Tự lưu từng database vào IndexedDB của trình duyệt.
- Nhập file `.sqlite`, `.sqlite3`, `.db` và xuất lại file SQLite chuẩn.
- Chạy nhiều câu lệnh trong một lần, hoặc chỉ chạy đoạn SQL đang được chọn.
- Hỗ trợ hệ lệnh SQLite: DDL, DML, SELECT, JOIN, GROUP BY, transaction, view, index, trigger và PRAGMA.
- Lớp tương thích giáo dục hỗ trợ `CREATE DATABASE`, `USE`, `SHOW DATABASES` và `DROP DATABASE` ngay trong editor.
- Có mẫu khởi tạo Quản lý học sinh đầy đủ bảng `Lop`, `HocSinh`, khóa chính, khóa ngoài và `DiemTB`.
- Mẫu câu lệnh có thể nạp và sửa trực tiếp trong editor.
- Cây schema hiển thị table, view, index, trigger, cột, khóa chính và khóa ngoại.
- Xem trước 100 dòng của table/view và chèn nhanh tên bảng hoặc cột vào editor.
- Hiển thị nhiều tập kết quả, giá trị `NULL`, BLOB, số dòng thay đổi và thời gian thực thi.
- Tải từng tập kết quả thành CSV.
- Lưu lịch sử câu lệnh riêng cho từng database.
- Kéo, thả, đổi thứ tự hoặc bấm các khối `SELECT`, `FROM`, `WHERE`, `AND`, `OR`, `ORDER BY`, `LIMIT`.
- Khối kéo thả dùng schema thật của database đang mở và chạy bằng cùng bộ máy SQLite.
- Hỗ trợ chuột, cảm ứng, bàn phím và giao diện responsive.

## Dữ liệu được lưu ở đâu?

Database được lưu cục bộ trong **IndexedDB của chính trình duyệt và thiết bị đang dùng**. Website không gửi database lên máy chủ. Vì dữ liệu không tự đồng bộ giữa các trình duyệt hoặc thiết bị, hãy dùng nút **Xuất file** để sao lưu khi cần.

SQLite nguyên bản không có câu lệnh `CREATE DATABASE`. Ứng dụng cung cấp một lớp tương thích: `CREATE DATABASE TenCSDL;` tạo một file SQLite mới và tự chuyển sang database đó. Bạn cũng có thể dùng nút **Mới** trên header.

## Chạy dự án cục bộ

WebAssembly cần được phục vụ qua HTTP. Tại thư mục dự án, chạy:

```bash
python3 -m http.server 8080
```

Sau đó mở <http://localhost:8080>. Không cần cài package hoặc build dự án.

## Cấu trúc

```text
sql-scratch-lab/
├── index.html                 # Cấu trúc giao diện
├── styles.css                 # Thiết kế responsive
├── database.js                # SQLite, IndexedDB và quản lý database
├── block-builder.js           # Trình tạo SELECT bằng khối kéo thả
├── app.js                     # Điều phối editor, schema, lịch sử và kết quả
├── vendor/
│   ├── sql-wasm.js            # sql.js 1.14.1
│   ├── sql-wasm.wasm          # SQLite WebAssembly
│   └── sql.js-LICENSE.txt
└── .github/workflows/
    └── deploy-pages.yml       # Tự động triển khai GitHub Pages
```

## Triển khai

Workflow GitHub Actions tự động triển khai toàn bộ website lên GitHub Pages mỗi khi nhánh `main` có thay đổi.

## Thư viện

Dự án phân phối kèm [sql.js](https://github.com/sql-js/sql.js) 1.14.1 theo giấy phép MIT; nội dung giấy phép nằm trong `vendor/sql.js-LICENSE.txt`.
