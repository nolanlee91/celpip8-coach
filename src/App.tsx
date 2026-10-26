import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { TutorProvider } from "./components/Tutor";
import { useStatus } from "./components/Practice";
import { DashboardPage } from "./pages/Dashboard";
import { ReadingPage } from "./pages/Reading";
import { ListeningPage } from "./pages/Listening";
import { WritingPage } from "./pages/Writing";
import { SpeakingPage } from "./pages/Speaking";
import { MistakesPage } from "./pages/Mistakes";
import { VocabularyPage } from "./pages/Vocabulary";
import { PlannerPage } from "./pages/Planner";
import { MockPage } from "./pages/Mock";
import { AnalyticsPage } from "./pages/Analytics";
import { SettingsPage } from "./pages/Settings";
import { EvaluationPage, ReviewPage, SubmissionPage } from "./pages/Review";
import { AdminPage } from "./pages/Admin";
import { LearnPage } from "./pages/Learn";
import { LessonPage } from "./pages/Lesson";

const NAV: ({ section: string; to?: undefined } | { to: string; label: string; icon: string; section?: undefined })[] = [
  { section: "Học — Learn" },
  { to: "/", label: "Hôm nay", icon: "🏠" },
  { to: "/learn", label: "Lộ trình học", icon: "🎓" },
  { to: "/planner", label: "Kế hoạch", icon: "🗓" },
  { section: "Luyện thi — Practice" },
  { to: "/reading", label: "Reading", icon: "📖" },
  { to: "/listening", label: "Listening", icon: "🎧" },
  { to: "/speaking", label: "Speaking", icon: "🎙" },
  { to: "/writing", label: "Writing", icon: "✍️" },
  { to: "/mistakes", label: "Sổ lỗi", icon: "🧠" },
  { to: "/vocabulary", label: "Từ vựng", icon: "📚" },
  { to: "/mock", label: "Thi thử", icon: "📝" },
  { section: "Khác" },
  { to: "/analytics", label: "Thống kê", icon: "📈" },
  { to: "/settings", label: "Cài đặt", icon: "⚙️" },
  { to: "/admin", label: "Quản trị", icon: "🛠" },
];

export function App() {
  const status = useStatus();
  return (
    <BrowserRouter>
      <TutorProvider>
        <div className="app">
          <nav className="sidebar">
            <div className="brand">CELPIP <span>8</span> Coach</div>
            {NAV.map((n) => n.to === undefined ? <div key={n.section} className="nav-section">{n.section}</div> : (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <span className="nav-icon">{n.icon}</span><span className="nav-label">{n.label}</span>
              </NavLink>
            ))}
            <div className="sidebar-foot">Công cụ luyện tập không chính thức · không liên kết với CELPIP/Paragon</div>
          </nav>
          <main className="main">
            {status && !status.aiConfigured && (
              <div className="banner subtle">ℹ︎ Chưa cấu hình Gemini — mọi bài luyện vẫn dùng được (thư viện soạn sẵn). Chỉ nhận xét Writing/Speaking bằng AI, Tutor và công cụ quản trị cần <code>GEMINI_API_KEY</code>.</div>
            )}
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/learn" element={<LearnPage />} />
              <Route path="/learn/:id" element={<LessonPage />} />
              <Route path="/reading" element={<ReadingPage />} />
              <Route path="/listening" element={<ListeningPage />} />
              <Route path="/speaking" element={<SpeakingPage />} />
              <Route path="/writing" element={<WritingPage />} />
              <Route path="/mistakes" element={<MistakesPage />} />
              <Route path="/vocabulary" element={<VocabularyPage />} />
              <Route path="/mock" element={<MockPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/review/:id" element={<ReviewPage />} />
              <Route path="/evaluation/:id" element={<EvaluationPage />} />
              <Route path="/submission/:id" element={<SubmissionPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </main>
        </div>
      </TutorProvider>
    </BrowserRouter>
  );
}
