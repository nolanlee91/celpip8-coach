# CELPIP 8 Coach

Ứng dụng web cá nhân, dùng AI (Google Gemini) để luyện CELPIP-General từ L6 / R5 / W7 / S6 lên **Level 8 ở cả 4 kỹ năng**.

> Đây là công cụ luyện tập **không chính thức**, không liên kết với CELPIP hay Paragon Testing. Mọi đề bài do AI tạo ra, và mọi mức điểm hiển thị đều là **ước tính luyện tập**, không thay thế điểm thi chính thức.

## Cài đặt & chạy

Yêu cầu: Node.js 20+ và trình duyệt **Microsoft Edge** hoặc **Chrome**. Hai trình duyệt này cần cho micro, nhận dạng giọng nói và giọng đọc tự nhiên.

```bash
cd celpip8-coach
npm install
copy .env.example .env      # rồi điền GEMINI_API_KEY=... (lấy tại https://aistudio.google.com/apikey)
npm run dev                 # mở http://localhost:5173
```

Chạy bản production (một cổng duy nhất):

```bash
npm run build
npm start                   # mở http://localhost:8787
```

## Deploy lên Railway

1. Trên Railway, chọn **New Project → Deploy from GitHub repo** rồi chọn repo này. Railway đọc `railway.json` để build (`npm run build`) và chạy (`npm start`).
2. Trong **Variables**, thêm các biến sau:
   - `GEMINI_API_KEY`: key Gemini của bạn.
   - `APP_PASSWORD`: **bắt buộc**. Mật khẩu vào app; ô tên đăng nhập nhập gì cũng được. Nếu thiếu, ai có link cũng dùng được Gemini key của bạn.
   - `DATA_DIR=/data`
   - `GEMINI_MODEL` (tùy chọn).
3. Bấm chuột phải vào service, chọn **Attach Volume** và đặt mount path `/data`. Thiếu Volume thì mọi tiến độ học sẽ mất sau mỗi lần deploy lại.
4. Trong **Settings → Networking**, chọn **Generate Domain**. Railway cấp HTTPS, mà micro (Speaking) bắt buộc phải chạy trên HTTPS.

## Các thành phần

| Thư mục | Nội dung |
|---|---|
| `server/` | Express API, gọi Gemini (mặc định `gemini-2.5-pro`, đổi bằng `GEMINI_MODEL`; đầu ra JSON có schema), lặp lại ngắt quãng (SM-2), phân tích điểm yếu, lập kế hoạch |
| `shared/spec.ts` | Cấu trúc bài thi (số part, số câu, thời gian) và danh mục loại lỗi. **Nên đối chiếu với celpip.ca** |
| `src/` | Giao diện React: Dashboard, Reading, Listening, Speaking, Writing, Sổ lỗi, Từ vựng, Kế hoạch, Thi thử, Thống kê, AI Tutor |
| `data/db.json` | Toàn bộ dữ liệu học, lưu trên máy bạn. Có nút xuất/nhập trong mục Cài đặt |
| `data/audio/` | Bản ghi âm Speaking |

## Những giới hạn cần biết

- **Listening:** âm thanh được tạo bằng giọng đọc của trình duyệt (Web Speech API). Edge có giọng "Natural" en-CA khá tự nhiên, nhưng vẫn không giống hệt ghi âm thật. Part 5 trong đề thật là video; ở đây chỉ có âm thanh.
- **Speaking:** AI chỉ nhận **bản chép lời**, vì speech-to-text chạy trong trình duyệt. Phát âm, ngữ điệu và độ trôi chảy của âm thanh **không được đánh giá**, và mọi trang kết quả đều ghi rõ điều này. Bạn nên tự nghe lại bản ghi âm.
- **Ước tính điểm:** với Reading/Listening, ước tính dùng quy tắc kinh nghiệm (độ khó × độ chính xác), không phải bảng quy đổi chính thức. Với Writing/Speaking, đó là band do AI ước tính.
- **Chi phí & hạn mức:** mỗi lần tạo đề hoặc chấm bài là một lần gọi Gemini API. Một bài thi thử tạo 20 phần đề (4 yêu cầu song song), sau đó chấm 10 bài Writing/Speaking. Với gói miễn phí, bạn có thể gặp lỗi 429 (vượt hạn mức); khi đó hãy chờ một lúc rồi thử lại, hoặc bật billing.
- **Model:** nếu Google ngừng hỗ trợ model mặc định, app sẽ báo lỗi 404. Lúc đó hãy đặt `GEMINI_MODEL` trong `.env` thành một model đang hoạt động.
