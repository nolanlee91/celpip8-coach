import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { HelpTip, useGuide } from "../components/Guide";
import { PRACTICE_HELP } from "../components/helpText";

type Entry = { to: string; icon: IconName; title: string; text: string; skill?: string };

function EntryList({ entries }: { entries: Entry[] }) {
  return (
    <ul className="hub-list">
      {entries.map((e) => (
        <li key={e.to}>
          <Link to={e.to} className={`hub-item ${e.skill ? `skill-${e.skill}` : ""}`}>
            <span className="hub-icon"><Icon name={e.icon} size={20} /></span>
            <span className="grow">
              <strong>{e.title}</strong>
              <span className="muted small">{e.text}</span>
            </span>
            <Icon name="chevron-right" className="hub-chevron" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Practice Mode entry point (the mobile "Luyện thi" tab). */
export function PracticeHubPage() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Luyện thi</h1>
          <p>Bài dạng thi chọn từ thư viện đã duyệt, theo part bạn yếu nhất.</p>
        </div>
      </div>
      <HelpTip id="practice" title="Luyện thi khác Học ở chỗ nào?">{PRACTICE_HELP}</HelpTip>
      <EntryList entries={[
        { to: "/reading", icon: "book-open", title: "Reading", text: "Part 1–4, có giải thích và bằng chứng trong bài", skill: "reading" },
        { to: "/listening", icon: "headphones", title: "Listening", text: "Part 1–6 với audio dựng sẵn, chỉ nghe một lần khi thi", skill: "listening" },
        { to: "/speaking", icon: "mic", title: "Speaking", text: "Task 1–8 có đếm giờ, ghi âm và bài mẫu", skill: "speaking" },
        { to: "/writing", icon: "pen-line", title: "Writing", text: "Email và khảo sát, đếm từ, bài mẫu Level 8", skill: "writing" },
        { to: "/mock", icon: "clipboard-check", title: "Thi thử", text: "Bốn kỹ năng, đúng thời gian thi thật" },
        { to: "/mistakes", icon: "notebook-pen", title: "Sổ lỗi", text: "Làm lại câu đã sai theo lịch ôn" },
      ]} />
    </div>
  );
}

/** Everything that does not get its own mobile tab. */
export function MorePage() {
  return (
    <div className="page">
      <div className="page-head"><h1>Thêm</h1></div>
      <EntryList entries={[
        { to: "/help", icon: "lightbulb", title: "Bắt đầu từ đâu?", text: "Cách học với ứng dụng, xem lại hướng dẫn bắt đầu" },
        { to: "/mistakes", icon: "notebook-pen", title: "Sổ lỗi", text: "Lỗi cần ôn hôm nay và hồ sơ điểm yếu" },
        { to: "/planner", icon: "calendar-days", title: "Kế hoạch tuần", text: "Giai đoạn học và kiểm tra cuối tuần" },
        { to: "/analytics", icon: "chart-line", title: "Thống kê", text: "Độ chính xác, thời gian học, tiến bộ theo tuần" },
        { to: "/settings", icon: "settings", title: "Cài đặt", text: "Điểm chính thức, thời gian mỗi ngày, AI" },
        { to: "/admin", icon: "wrench", title: "Quản trị nội dung", text: "Thư viện, bài học, audio, sinh nội dung" },
      ]} />
      <p className="muted small">Công cụ luyện tập không chính thức. Không liên kết với CELPIP hay Paragon Testing. Mọi điểm hiển thị là ước tính luyện tập.</p>
    </div>
  );
}

/** "Bắt đầu từ đâu?": the learning workflow in one screen, and a way to replay the welcome guide. */
export function HelpPage() {
  const g = useGuide();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Bắt đầu từ đâu?</h1>
          <p>Bạn không cần tự chọn học gì. Mở trang Hôm nay và bấm nút lớn ở trên cùng.</p>
        </div>
      </div>
      <div className="card">
        <ol className="workflow">
          <li><div><strong>Mở trang Hôm nay</strong><p>Nút lớn ở trên cùng là việc nên làm ngay, kèm lý do và thời gian. Bên dưới là phần còn lại của kế hoạch hôm nay.</p></div></li>
          <li><div><strong>Học một kỹ thuật</strong><p>Mỗi bài học có 6 bước: mục tiêu, khái niệm, ví dụ mẫu, luyện có gợi ý, tự làm bài kiểm tra, kết quả. Đạt từ 80% là nắm vững.</p></div></li>
          <li><div><strong>Áp dụng vào bài dạng thi</strong><p>Phần Luyện thi cho câu hỏi giống đề CELPIP thật. Làm xong, ứng dụng nói bạn nên học lại kỹ thuật nào hay làm tiếp.</p></div></li>
          <li><div><strong>Ôn đúng lúc</strong><p>Câu sai, từ vựng và bài đã học được nhắc ôn khi bạn sắp quên. Chỉ vài phút mỗi ngày.</p></div></li>
          <li><div><strong>Theo dõi tiến bộ</strong><p>Trang Hôm nay cho thấy tiến độ tới Level 8 và điểm còn yếu. Xem chi tiết ở Thống kê.</p></div></li>
        </ol>
      </div>
      <div className="row gap-s wrap">
        <button className="btn primary" onClick={g.openOnboarding}><Icon name="rotate-ccw" /> Xem lại hướng dẫn bắt đầu</button>
        <button className="btn" onClick={g.resetHelp}>Hiện lại các ghi chú hướng dẫn</button>
        <Link className="btn ghost" to="/">Về trang Hôm nay</Link>
      </div>
    </div>
  );
}
