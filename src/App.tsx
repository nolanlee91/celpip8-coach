import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { TutorProvider, useTutor } from "./components/Tutor";
import { useStatus } from "./components/Practice";
import { Icon, type IconName } from "./components/Icon";
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
import { MorePage, PracticeHubPage } from "./pages/Hubs";

type NavItem = { to: string; label: string; icon: IconName };

const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Học", items: [
    { to: "/", label: "Hôm nay", icon: "house" },
    { to: "/learn", label: "Lộ trình học", icon: "graduation-cap" },
    { to: "/planner", label: "Kế hoạch tuần", icon: "calendar-days" },
  ] },
  { section: "Luyện thi", items: [
    { to: "/reading", label: "Reading", icon: "book-open" },
    { to: "/listening", label: "Listening", icon: "headphones" },
    { to: "/speaking", label: "Speaking", icon: "mic" },
    { to: "/writing", label: "Writing", icon: "pen-line" },
    { to: "/mock", label: "Thi thử", icon: "clipboard-check" },
  ] },
  { section: "Ôn tập", items: [
    { to: "/mistakes", label: "Sổ lỗi", icon: "notebook-pen" },
    { to: "/vocabulary", label: "Từ vựng", icon: "library" },
  ] },
  { section: "Khác", items: [
    { to: "/analytics", label: "Thống kê", icon: "chart-line" },
    { to: "/settings", label: "Cài đặt", icon: "settings" },
    { to: "/admin", label: "Quản trị nội dung", icon: "wrench" },
  ] },
];

// Mobile bottom tabs: the five places a learner goes most. Everything else is one tap away under "Thêm".
const TABS: { to: string; label: string; icon: IconName; match: string[] }[] = [
  { to: "/", label: "Hôm nay", icon: "house", match: ["/"] },
  { to: "/learn", label: "Lộ trình", icon: "graduation-cap", match: ["/learn"] },
  { to: "/practice", label: "Luyện thi", icon: "dumbbell", match: ["/practice", "/reading", "/listening", "/speaking", "/writing", "/mock", "/review", "/evaluation", "/submission"] },
  { to: "/vocabulary", label: "Từ vựng", icon: "library", match: ["/vocabulary"] },
  { to: "/more", label: "Thêm", icon: "ellipsis", match: ["/more", "/mistakes", "/planner", "/analytics", "/settings", "/admin"] },
];

function TabBar() {
  const { pathname } = useLocation();
  const active = (t: (typeof TABS)[number]) => t.match.some((m) => (m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(`${m}/`)));
  return (
    <nav className="tabbar" aria-label="Điều hướng chính">
      {TABS.map((t) => (
        <Link key={t.to} to={t.to} className={`tab ${active(t) ? "active" : ""}`} aria-current={active(t) ? "page" : undefined}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function TopBar() {
  const tutor = useTutor();
  return (
    <header className="topbar">
      <Link to="/" className="brand" style={{ textDecoration: "none" }}>CELPIP <span>8</span></Link>
      <button className="icon-btn" aria-label="Mở AI Tutor" onClick={tutor.open}><Icon name="message-circle" size={22} /></button>
    </header>
  );
}

export function App() {
  const status = useStatus();
  return (
    <BrowserRouter>
      <TutorProvider>
        <div className="app">
          <TopBar />
          <nav className="sidebar" aria-label="Điều hướng">
            <div className="brand">CELPIP <span>8</span> <small>Coach</small></div>
            {NAV.map((g) => (
              <div key={g.section}>
                <div className="nav-section">{g.section}</div>
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                    <Icon name={n.icon} />
                    <span className="nav-label">{n.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
            <div className="sidebar-foot">Công cụ luyện tập không chính thức. Không liên kết với CELPIP hay Paragon Testing.</div>
          </nav>
          <main className="main">
            {status && !status.aiConfigured && (
              <div className="banner subtle">Chưa có Gemini key: mọi bài học và bài luyện vẫn dùng được. Chỉ AI Tutor và nhận xét Writing/Speaking bằng AI cần <code>GEMINI_API_KEY</code>.</div>
            )}
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/learn" element={<LearnPage />} />
              <Route path="/learn/:id" element={<LessonPage />} />
              <Route path="/practice" element={<PracticeHubPage />} />
              <Route path="/more" element={<MorePage />} />
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
          <TabBar />
        </div>
      </TutorProvider>
    </BrowserRouter>
  );
}
