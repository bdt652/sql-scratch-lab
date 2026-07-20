# SQL Scratch Lab

[![Deploy GitHub Pages](https://github.com/bdt652/sql-scratch-lab/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/bdt652/sql-scratch-lab/actions/workflows/deploy-pages.yml)

Một website học SQL bằng cách kéo thả các khối lệnh trực quan, được xây dựng hoàn toàn bằng **HTML, CSS và JavaScript thuần**.

## Bản chạy trực tuyến

Sau khi GitHub Pages được bật, dự án có tại:

<https://bdt652.github.io/sql-scratch-lab/>

## Tính năng

- Kéo thả hoặc bấm để thêm các khối `SELECT`, `FROM`, `WHERE`, `AND`, `OR`, `ORDER BY`, `LIMIT`.
- Tạo và tô màu câu SQL theo thời gian thực.
- Kiểm tra thứ tự, cú pháp và hướng dẫn sửa lỗi.
- Chạy truy vấn ngay trên hai bảng dữ liệu mẫu trong trình duyệt.
- Hiển thị kết quả truy vấn dưới dạng bảng.
- Giao diện responsive, hỗ trợ bàn phím và tự lưu vùng làm việc.
- Không cần cài package, framework hay cơ sở dữ liệu.

## Chạy dự án

Cách đơn giản nhất là mở trực tiếp file `index.html` bằng trình duyệt.

Hoặc chạy một web server cục bộ:

```bash
python3 -m http.server 8080
```

Sau đó truy cập <http://localhost:8080>.

## Triển khai

Workflow `.github/workflows/deploy-pages.yml` tự động triển khai website lên GitHub Pages mỗi khi nhánh `main` có thay đổi.

## Cấu trúc

```text
sql-scratch-lab/
├── index.html   # Cấu trúc giao diện
├── styles.css   # Thiết kế responsive và các khối lệnh
├── app.js       # Kéo thả, tạo SQL và thực thi truy vấn
└── README.md
```

## Lưu ý

Bộ thực thi trong dự án mô phỏng một phần SQL trên dữ liệu JavaScript để người mới có thể học ngay mà không cần thiết lập máy chủ. Đây không phải là một hệ quản trị cơ sở dữ liệu hoàn chỉnh.

## Hướng phát triển

- Thêm khối `JOIN`, `GROUP BY` và các hàm tổng hợp.
- Cho phép người học tự tạo bảng và nhập dữ liệu.
- Dùng SQLite/WebAssembly để chạy nhiều câu SQL hơn.
