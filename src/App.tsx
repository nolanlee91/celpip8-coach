import { lazy, Suspense, useEffect, useState } from "react";
import { Loading } from "./components/ui";
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
// Analytics carries the chart library; load it only when the page is opened.
const AnalyticsPage = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.AnalyticsPage })));
import { SettingsPage } from "./pages/Settings";
import { EvaluationPage, ReviewPage, SubmissionPage } from "./pages/Review";
import { AdminPage } from "./pages/Admin";
import { LearnPage } from "./pages/Learn";
import { LessonPage } from "./pages/Lesson";
import { HelpPage, MorePage, PracticeHubPage } from "./pages/Hubs";
import { ExamStructurePage } from "./pages/ExamStructure";
import { GuideProvider } from "./components/Guide";
import { WordLookup } from "./components/WordLookup";
import { useTheme } from "./lib/theme";
import { AiItemPage, AiTrackPage } from "./pages/AiTrack";
import { NotebookPage } from "./pages/NotebookPage";

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
    { to: "/notebook", label: "Vở ghi", icon: "notebook" },
  ] },
  { section: "AI", items: [
    { to: "/ai", label: "Lộ trình AI Agents", icon: "bot" },
  ] },
  { section: "Khác", items: [
    { to: "/help", label: "Bắt đầu từ đâu?", icon: "lightbulb" },
    { to: "/exam", label: "Cấu trúc bài thi", icon: "list-checks" },
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
  { to: "/ai", label: "AI", icon: "bot", match: ["/ai"] },
  { to: "/more", label: "Thêm", icon: "ellipsis", match: ["/more", "/notebook", "/help", "/exam", "/mistakes", "/planner", "/analytics", "/settings", "/admin"] },
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

/** One tap flips between light and dark; "Theo máy" stays in Settings. */
function ThemeToggle() {
  const { effective, setTheme } = useTheme();
  const next = effective === "dark" ? "light" : "dark";
  const label = next === "light" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <button className="icon-btn theme-toggle" aria-label={label} title={label} onClick={() => setTheme(next)}>
      <Icon name={effective === "dark" ? "sun" : "moon"} size={20} />
    </button>
  );
}

function TopBar() {
  const tutor = useTutor();
  return (
    <header className="topbar">
      <Link to="/" className="brand" style={{ textDecoration: "none" }}>CELPIP <span>8</span></Link>
      <div className="topbar-actions">
        <ThemeToggle />
        <button className="icon-btn" aria-label="Mở AI Tutor" onClick={tutor.open}><Icon name="message-circle" size={22} /></button>
      </div>
    </header>
  );
}

const isAt = (pathname: string, to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));

/**
 * Desktop navigation across the top, so pages get the full width. Each group opens on hover,
 * on click (touch laptops) and from the keyboard (Enter/Space, Esc closes).
 */
function DeskBar() {
  const { pathname } = useLocation();
  const tutor = useTutor();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [pathname]);
  const leave = () => (document.activeElement as HTMLElement | null)?.blur();
  return (
    <header className="deskbar">
      <Link to="/" className="brand">CELPIP <span>8</span> <small>Coach</small></Link>
      <nav className="desknav" aria-label="Điều hướng">
        <NavLink to="/" end className={({ isActive }) => `desk-link ${isActive ? "active" : ""}`}>Hôm nay</NavLink>
        {NAV.map((g) => {
          const items = g.items.filter((n) => n.to !== "/");
          if (items.length === 1) {
            const n = items[0];
            return <NavLink key={g.section} to={n.to} className={({ isActive }) => `desk-link ${isActive ? "active" : ""}`}>{g.section}</NavLink>;
          }
          const here = items.some((n) => isAt(pathname, n.to));
          return (
            <div key={g.section} className={`desk-group ${open === g.section ? "open" : ""}`}
              onMouseLeave={() => setOpen((o) => (o === g.section ? null : o))}
              onKeyDown={(e) => { if (e.key === "Escape") { setOpen(null); leave(); } }}>
              <button className={`desk-link ${here ? "active" : ""}`} aria-expanded={open === g.section} aria-haspopup="true"
                onClick={() => setOpen((o) => (o === g.section ? null : g.section))}>
                {g.section}<Icon name="chevron-down" size={15} />
              </button>
              <div className="desk-menu">
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} className={({ isActive }) => `desk-item ${isActive ? "active" : ""}`} onClick={leave}>
                    <Icon name={n.icon} />{n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="desk-actions">
        <ThemeToggle />
        <button className="btn small desk-tutor" onClick={tutor.open}><Icon name="message-circle" size={16} /> Hỏi AI Tutor</button>
      </div>
    </header>
  );
}

export function App() {
  const status = useStatus();
  return (
    <BrowserRouter>
      <TutorProvider>
        <GuideProvider>
        <div className="app">
          <a className="skip-link" href="#main">Bỏ qua tới nội dung chính</a>
          <TopBar />
          <DeskBar />
          <main className="main" id="main" tabIndex={-1}>
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
              <Route path="/ai" element={<AiTrackPage />} />
              <Route path="/ai/:id" element={<AiItemPage />} />
              <Route path="/notebook" element={<NotebookPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/exam" element={<ExamStructurePage />} />
              <Route path="/reading" element={<ReadingPage />} />
              <Route path="/listening" element={<ListeningPage />} />
              <Route path="/speaking" element={<SpeakingPage />} />
              <Route path="/writing" element={<WritingPage />} />
              <Route path="/mistakes" element={<MistakesPage />} />
              <Route path="/vocabulary" element={<VocabularyPage />} />
              <Route path="/mock" element={<MockPage />} />
              <Route path="/analytics" element={<Suspense fallback={<Loading />}><AnalyticsPage /></Suspense>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/review/:id" element={<ReviewPage />} />
              <Route path="/evaluation/:id" element={<EvaluationPage />} />
              <Route path="/submission/:id" element={<SubmissionPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
            <p className="app-foot">Công cụ luyện tập không chính thức. Không liên kết với CELPIP hay Paragon Testing.</p>
          </main>
          <TabBar />
          <WordLookup />
        </div>
        </GuideProvider>
      </TutorProvider>
    </BrowserRouter>
  );
}
