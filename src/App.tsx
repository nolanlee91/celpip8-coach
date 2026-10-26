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
import { EvaluationPage, ReviewPage } from "./pages/Review";

const NAV = [
  { to: "/", label: "Dashboard", icon: "🏠" },
  { to: "/planner", label: "Kế hoạch", icon: "🗓" },
  { to: "/reading", label: "Reading", icon: "📖" },
  { to: "/listening", label: "Listening", icon: "🎧" },
  { to: "/speaking", label: "Speaking", icon: "🎙" },
  { to: "/writing", label: "Writing", icon: "✍️" },
  { to: "/mistakes", label: "Sổ lỗi", icon: "🧠" },
  { to: "/vocabulary", label: "Từ vựng", icon: "📚" },
  { to: "/mock", label: "Thi thử", icon: "📝" },
  { to: "/analytics", label: "Thống kê", icon: "📈" },
  { to: "/settings", label: "Cài đặt", icon: "⚙️" },
];

export function App() {
  const status = useStatus();
  return (
    <BrowserRouter>
      <TutorProvider>
        <div className="app">
          <nav className="sidebar">
            <div className="brand">CELPIP <span>8</span> Coach</div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                <span className="nav-icon">{n.icon}</span><span className="nav-label">{n.label}</span>
              </NavLink>
            ))}
            <div className="sidebar-foot">Công cụ luyện tập không chính thức · không liên kết với CELPIP/Paragon</div>
          </nav>
          <main className="main">
            {status && !status.aiConfigured && (
              <div className="banner">⚠︎ Chưa cấu hình <code>GEMINI_API_KEY</code> — các tính năng AI (tạo đề, chấm bài, tutor) chưa hoạt động. Xem README.</div>
            )}
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/planner" element={<PlannerPage />} />
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
            </Routes>
          </main>
        </div>
      </TutorProvider>
    </BrowserRouter>
  );
}
