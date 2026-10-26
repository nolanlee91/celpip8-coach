import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";

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
