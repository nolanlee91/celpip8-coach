// AI learning track: an 8-week plan to learn to design and run AI agent teams (Claude Code first,
// then Hugging Face agents), with free completion certificates. Static content shipped with the app;
// the learner's notes and checklist state live in Db.notebook (keyed by item id).
//
// Course links were checked against anthropic.skilljar.com, huggingface.co and coursera.org on 2026-11-10.
// Certificate rules change: each item says "kiểm tra lại" where we could not confirm them.

export interface AiResource { label: string; url: string }

export interface AiItem {
  id: string;
  kind: "course" | "reading" | "practice" | "exam";
  title: string;
  provider?: string;           // "Anthropic Academy", "Hugging Face", ...
  durationVi: string;          // rough time, e.g. "~2 giờ"
  certificateVi?: string;      // what you get and the condition
  links: AiResource[];
  whyVi: string;               // why this item is in the plan
  checklist: string[];         // concrete things to do; ticked state is saved
  selfCheck?: string[];        // questions to answer in your notes without asking AI
}

export interface AiWeek {
  week: number;
  title: string;
  goalVi: string;
  track: "A" | "B";            // A = AI coding team, B = agents running inside a business system
  items: AiItem[];
}

export const AI_TRACK_INTRO = {
  title: "AI Agents: tự thiết kế và điều hành team agent",
  levelVi: "Level 1 · AI Agent Engineering & Technical Leadership",
  summaryVi:
    "Mục tiêu sau 8 tuần: tự dựng được một team agent (viết code, review, test) mà không cần AI gợi ý từng bước, hiểu kiến trúc hệ thống mình đã làm, và nhắm tới 4–5 chứng chỉ hoàn thành miễn phí (là mục tiêu, không bảo đảm: kiểm tra điều kiện của từng khóa).",
  principlesVi: [
    "Mỗi lần chỉ học một khóa: học xong, làm bài thực hành, rồi mới sang khóa tiếp theo.",
    "Học A trước (team agent viết phần mềm), rồi mới tới B (agent vận hành trong KDE Core).",
    "Sau mỗi khóa phải tự làm một bài thực hành. AI chỉ được review, không làm hộ.",
    "Không học để nhớ cách viết code. Học để giải thích được vì sao thiết kế như vậy và kiểm chứng AI đã làm đúng.",
    "Agent chỉ đọc dữ liệu giả lập trong lúc học. Không cho agent quyền sửa giao dịch thật.",
  ],
  certNoteVi:
    "Chứng chỉ Anthropic Academy và Hugging Face là chứng chỉ hoàn thành khóa (miễn phí), không phải thi có giám sát. Giá trị lớn nhất là thứ bạn làm được và giải thích được.",
  nextLevelVi: {
    title: "Sau 8 tuần: Level 2 · System Design & Production AI Architecture (4–8 tuần)",
    text: "Biết tạo subagents chưa phải là AI Solutions Architect. Level 2 học thiết kế kiến trúc tổng thể, cân nhắc phương án kỹ thuật, bảo mật, chi phí và độ tin cậy khi đưa AI vào production. Sẽ soạn chi tiết khi xong Level 1.",
    courses: [
      {
        label: "Microsoft · Core AI Solution Design (Coursera)",
        url: "https://www.coursera.org/learn/core-ai-solution-design",
        noteVi: "Gần nhất với vai trò kiến trúc sư: RAG, evaluation, chọn fine-tuning/RAG/prompt, có capstone tài liệu kiến trúc. Nằm trong Coursera Plus (trả phí, có thể xin financial aid); lab cần Azure AI Search gói Basic trở lên, tức là tốn tiền Azure.",
      },
      {
        label: "IBM · Building AI Agents and Agentic Workflows (Coursera)",
        url: "https://www.coursera.org/specializations/building-ai-agents-and-agentic-workflows",
        noteVi: "3 khóa, khoảng 34 giờ: LangChain, LangGraph, CrewAI, AutoGen. Cần biết Python. Chứng chỉ IBM qua Coursera (trả phí). Dùng làm tài liệu tham khảo cho phần B, không bắt buộc.",
      },
    ],
  },
};

const AA = "Anthropic Academy";
const HF = "Hugging Face";

export const AI_WEEKS: AiWeek[] = [
  {
    week: 1, track: "A", title: "Claude Code bài bản",
    goalVi: "Dùng Claude Code có quy trình, và hiểu chính hệ thống KDE Core của mình.",
    items: [
      {
        id: "ai-w1-cc-action", kind: "course", provider: AA, title: "Claude Code in Action", durationVi: "~2–3 giờ",
        certificateVi: "Chứng chỉ hoàn thành miễn phí trên Anthropic Academy.",
        links: [
          { label: "Anthropic Academy", url: "https://anthropic.skilljar.com/claude-code-in-action" },
          { label: "Claude Code 101 (nếu cần nền tảng)", url: "https://anthropic.skilljar.com/claude-code-101" },
        ],
        whyVi: "Bạn đã dùng Claude Code thực tế; khóa này lấp chỗ hổng về CLAUDE.md, quyền hạn, hooks và quy trình Explore → Plan → Code → Commit.",
        checklist: ["Đăng ký Anthropic Academy", "Học hết các bài", "Nhận chứng chỉ", "Ghi 5 điều mới học được vào vở"],
        selfCheck: ["CLAUDE.md dùng để làm gì, nên viết gì và không nên viết gì?", "Khi nào nên bắt Claude lập kế hoạch trước khi sửa code?"],
      },
      {
        id: "ai-w1-discovery", kind: "practice", title: "Thực hành: Architecture Discovery KDE Core", durationVi: "~2 giờ",
        links: [],
        whyVi: "Trước khi xây thêm, phải hiểu hệ thống đang chạy. Prompt bắt AI chỉ đọc, dẫn file thật và hỏi lại bạn.",
        checklist: [
          "Mở repo KDE Core trong Claude Code, dán prompt Architecture Discovery (xem bên dưới)",
          "Tự trả lời 10 câu hỏi AI đặt ra, ghi vào vở",
          "Tự vẽ lại sơ đồ: frontend → API → database → hosting",
          "Liệt kê 5 API endpoint quan trọng nhất: làm gì, ai được gọi",
          "Ghi lại các bảng database chính và quan hệ giữa chúng",
          "Ghi lại cách đăng nhập (authentication) và phân quyền theo vai trò (RBAC)",
          "Ghi lại Git workflow hiện tại: nhánh, commit, deploy ra sao",
          "Tự viết lại CLAUDE.md cho KDE Core (không nhờ AI viết)",
        ],
        selfCheck: [
          "Dữ liệu một shipment đi từ màn hình tới database qua những bước nào?",
          "Hệ thống xác thực người dùng ở đâu, ai được làm gì?",
          "Nếu một nhân viên kho cố gọi API sửa COD, hệ thống chặn ở đâu?",
        ],
      },
    ],
  },
  {
    week: 2, track: "A", title: "Subagents: tự dựng team",
    goalVi: "Tự tạo agent có vai trò và quyền hạn riêng, giao việc song song.",
    items: [
      {
        id: "ai-w2-subagents", kind: "course", provider: AA, title: "Introduction to subagents", durationVi: "~30 phút",
        certificateVi: "Chứng chỉ hoàn thành miễn phí trên Anthropic Academy.",
        links: [{ label: "Anthropic Academy", url: "https://anthropic.skilljar.com/introduction-to-subagents" }],
        whyVi: "Đây là khóa dạy đúng chỗ bạn đang thiếu: chia việc cho nhiều agent, viết mô tả công việc, giới hạn công cụ.",
        checklist: ["Học hết khóa", "Nhận chứng chỉ"],
        selfCheck: ["Việc nào nên giao cho subagent, việc nào nên tự làm trong cuộc trò chuyện chính?", "Vì sao agent kiểm tra phải tách khỏi agent viết?"],
      },
      {
        id: "ai-w2-team", kind: "practice", title: "Thực hành: tạo 3 agent architect, reviewer, tester", durationVi: "~2–3 giờ",
        links: [{ label: "Tài liệu subagents", url: "https://docs.claude.com/en/docs/claude-code/sub-agents" }],
        whyVi: "Tự tay viết file agent là cách duy nhất để hết phụ thuộc vào gợi ý của AI.",
        checklist: [
          "Tạo .claude/agents/architect.md: chỉ đọc, đề xuất thiết kế",
          "Tạo .claude/agents/reviewer.md: chỉ đọc + chạy test, không sửa file",
          "Tạo .claude/agents/tester.md: viết và chạy test",
          "Giao 1 việc nhỏ cho từng agent, ghi lại kết quả và lỗi gặp phải",
          "Gửi Claude 3 file agent để review",
        ],
        selfCheck: ["Mỗi agent được dùng những tool nào và vì sao?"],
      },
    ],
  },
  {
    week: 3, track: "A", title: "Skills, hooks và MCP",
    goalVi: "Đóng gói quy trình lặp lại thành skill, tự động kiểm tra bằng hook, kết nối dữ liệu bằng MCP.",
    items: [
      {
        id: "ai-w3-skills", kind: "course", provider: AA, title: "Introduction to agent skills", durationVi: "~1 giờ",
        certificateVi: "Chứng chỉ hoàn thành miễn phí trên Anthropic Academy.",
        links: [{ label: "Anthropic Academy", url: "https://anthropic.skilljar.com/introduction-to-agent-skills" }],
        whyVi: "Skill biến quy trình bạn hay làm (báo cáo tuần, review đơn) thành thứ agent dùng lại được.",
        checklist: ["Học hết khóa", "Nhận chứng chỉ"],
      },
      {
        id: "ai-w3-mcp", kind: "course", provider: AA, title: "Introduction to Model Context Protocol", durationVi: "~2 giờ",
        certificateVi: "Chứng chỉ hoàn thành miễn phí trên Anthropic Academy.",
        links: [{ label: "Anthropic Academy", url: "https://anthropic.skilljar.com/introduction-to-model-context-protocol" }],
        whyVi: "MCP là cách nối agent với Gmail, Drive, database. Cần cho phần B sau này.",
        checklist: ["Học hết khóa", "Nhận chứng chỉ"],
        selfCheck: ["MCP server khác tool viết trong code ở chỗ nào?"],
      },
      {
        id: "ai-w3-practice", kind: "practice", title: "Thực hành: 1 skill + 1 hook cho KDE Core", durationVi: "~2 giờ",
        links: [{ label: "Tài liệu hooks", url: "https://docs.claude.com/en/docs/claude-code/hooks" }],
        whyVi: "Hook là cách bắt lỗi tự động, không phải tin lời agent.",
        checklist: ["Viết 1 skill (ví dụ: báo cáo công việc tuần)", "Viết 1 hook chạy test trước khi commit", "Thử cố tình làm test fail, xem hook có chặn không"],
      },
    ],
  },
  {
    week: 4, track: "A", title: "Bài kiểm tra A: tự điều hành team",
    goalVi: "Tự giao một tính năng thật cho team agent, không hỏi AI cách làm.",
    items: [
      {
        id: "ai-w4-sdlc", kind: "reading", provider: "Anthropic", title: "Đọc: The AI-Native SDLC Playbook", durationVi: "~1–2 giờ",
        certificateVi: "Bài viết + PDF, không có chứng chỉ.",
        links: [{ label: "Đọc trên claude.com", url: "https://claude.com/blog/the-ai-native-sdlc-playbook" }],
        whyVi: "Anthropic mô tả vòng đời phát triển phần mềm khi AI viết phần lớn code: Plan, Design, Build, Test, Deploy, Maintain. Mỗi giai đoạn để lại một tài liệu cho giai đoạn sau đọc. Đọc trước Technical Lead Challenge để dùng đúng khung này.",
        checklist: ["Đọc hết bài (hoặc PDF)", "Tóm tắt 6 giai đoạn vào vở, mỗi giai đoạn 1–2 dòng", "Ghi lại: KDE Core đang thiếu tài liệu ở giai đoạn nào?"],
        selfCheck: ["Khi viết code không còn là việc chậm nhất, thì việc gì chậm nhất trong quy trình của bạn?"],
      },
      {
        id: "ai-w4-capstone-a", kind: "exam", title: "Technical Lead Challenge: KDE Core", durationVi: "~4–5 giờ",
        links: [],
        whyVi: "Làm được cả 6 việc mà không cần AI hướng dẫn từng bước là bằng chứng bạn đã chuyển từ người dùng AI coding sang người điều hành quy trình phát triển bằng agent.",
        checklist: [
          "Tự phân tích một yêu cầu chức năng mới trong KDE Core",
          "Tự xác định cần những agent nào và vì sao",
          "Viết hướng dẫn và giới hạn quyền cho từng agent",
          "Phân công agent thực hiện công việc",
          "Tổ chức code review và automated test (bắt được ít nhất 1 lỗi)",
          "Kiểm tra kết quả và giải thích các quyết định kiến trúc trong vở",
        ],
        selfCheck: ["Nếu làm lại, bạn sẽ chia việc khác đi thế nào?", "Chỗ nào bạn vẫn phải hỏi AI? Đó là kiến thức cần học tiếp."],
      },
    ],
  },
  {
    week: 5, track: "B", title: "Agent hoạt động thế nào",
    goalVi: "Hiểu vòng lặp agent: suy nghĩ → gọi tool → xem kết quả → lặp lại.",
    items: [
      {
        id: "ai-w5-hf-agents", kind: "course", provider: HF, title: "Hugging Face AI Agents Course (Unit 1)", durationVi: "~4–6 giờ",
        certificateVi: "Chứng chỉ Fundamentals miễn phí khi đạt ≥ 80% quiz Unit 1 (kiểm tra lại trên trang khóa).",
        links: [{ label: "Hugging Face", url: "https://huggingface.co/learn/agents-course" }],
        whyVi: "Phần A dạy dùng agent có sẵn; phần này dạy agent được tạo ra từ đâu.",
        checklist: ["Tạo tài khoản Hugging Face", "Học Unit 1", "Làm quiz Unit 1 đạt ≥ 80%", "Nhận chứng chỉ Fundamentals"],
        selfCheck: ["Tool calling là gì? Agent quyết định gọi tool nào dựa trên đâu?"],
      },
    ],
  },
  {
    week: 6, track: "B", title: "Agent đầu tiên cho KDE",
    goalVi: "Viết 1 agent với 2 tool chỉ đọc, chạy trên dữ liệu giả lập.",
    items: [
      {
        id: "ai-w6-agent", kind: "practice", title: "Thực hành: agent tra đơn + tra COD (chỉ đọc)", durationVi: "~4 giờ",
        links: [{ label: "Hugging Face Agents Course", url: "https://huggingface.co/learn/agents-course" }],
        whyVi: "Bắt đầu nhỏ: 1 agent, 2 tool. Chạy ổn rồi mới tách thành nhiều agent.",
        checklist: [
          "Tạo dữ liệu giả lập: 20 shipment, 20 dòng COD",
          "Tool 1: tra trạng thái đơn. Tool 2: tra đối soát COD",
          "Agent trả lời kèm nguồn dữ liệu và chỗ chưa xác minh",
          "Ghi log mọi lần gọi tool",
          "Đánh giá tool-call accuracy: agent có gọi đúng tool, đúng tham số không (≥ 10 câu hỏi mẫu)",
          "Kiểm tra xử lý lỗi: mã đơn sai, tool trả lỗi, dữ liệu thiếu",
          "Kiểm tra quyền: yêu cầu sửa/hoàn tiền phải bị từ chối hoặc chuyển người duyệt",
        ],
        selfCheck: ["Nếu người dùng yêu cầu agent hoàn tiền, agent phải làm gì?", "Agent sai ở loại câu hỏi nào nhiều nhất? Vì sao?"],
      },
    ],
  },
  {
    week: 7, track: "B", title: "Context engineering",
    goalVi: "Cho agent đúng thông tin, đúng lúc. Lấy chứng chỉ thứ hai của Hugging Face.",
    items: [
      {
        id: "ai-w7-context", kind: "course", provider: HF, title: "Hugging Face Context Course (Unit 1–2)", durationVi: "~5 giờ",
        certificateVi: "Chứng chỉ Context Fundamentals miễn phí khi đạt ≥ 70% quiz Unit 1–2 (kiểm tra lại trên trang khóa).",
        links: [{ label: "Hugging Face", url: "https://huggingface.co/learn/context-course" }],
        whyVi: "Khóa có ví dụ trực tiếp cho Claude Code và Codex: CLAUDE.md, skills, subagents ở mức sâu hơn.",
        checklist: ["Học Unit 1–2", "Làm quiz đạt ≥ 70%", "Nhận chứng chỉ", "Cập nhật lại CLAUDE.md của KDE Core theo điều học được"],
      },
      {
        id: "ai-w7-api", kind: "course", provider: AA, title: "Building with the Claude API", durationVi: "~6–8 giờ (học dần)",
        certificateVi: "Chứng chỉ hoàn thành miễn phí trên Anthropic Academy.",
        links: [{ label: "Anthropic Academy", url: "https://anthropic.skilljar.com/claude-with-the-anthropic-api" }],
        whyVi: "Cần khi muốn gắn agent vào chính hệ thống KDE Core thay vì chạy trong Claude Code.",
        checklist: ["Học phần tool use", "Học phần đánh giá (evaluation)", "Nhận chứng chỉ (có thể để sang tuần 8+)"],
      },
    ],
  },
  {
    week: 8, track: "B", title: "Kiến trúc và portfolio",
    goalVi: "Chứng minh bằng tài liệu và test rằng bạn thiết kế và kiểm soát được hệ thống.",
    items: [
      {
        id: "ai-w8-portfolio", kind: "practice", title: "Thực hành: C4 diagram, ADR, chi phí, 30 test case", durationVi: "~6 giờ",
        links: [
          { label: "C4 model", url: "https://c4model.com" },
          { label: "AI Fluency (Coursera, tùy chọn)", url: "https://www.coursera.org/learn/ai-fluency-framework-foundations" },
        ],
        whyVi: "Thứ thuyết phục nhà tuyển dụng nhất: bạn giải thích và bảo vệ được kiến trúc, có số liệu test.",
        checklist: [
          "Vẽ C4 Context + Container diagram cho KDE Core",
          "Viết ít nhất 3 ADR: vì sao chọn phương án A thay vì B (database, hosting, cách tổ chức agent)",
          "Viết 30 test case cho agent tuần 6, đo tỉ lệ trả lời đúng",
          "0 hành động vượt quyền trong test",
          "Đo chi phí: token và tiền cho mỗi câu hỏi, ước tính chi phí một tháng",
          "Đo độ trễ (latency) trung bình và chậm nhất",
          "Có logging và retry khi tool/API lỗi tạm thời",
          "Viết 1 trang: team agent gồm ai, quyền hạn, ai duyệt",
        ],
        selfCheck: ["Nếu phải giải thích KDE Core cho CTO trong 5 phút, bạn nói gì?", "Nếu số câu hỏi tăng 10 lần, chi phí và độ trễ thay đổi thế nào?"],
      },
    ],
  },
];

export const DISCOVERY_PROMPT = `Act as a Senior Software Architect and technical mentor.

Analyze the KDE Core repository in read-only mode.
Do not modify files.

1. Identify frontend, backend, database, APIs,
   authentication, hosting and integrations.
2. Explain the complete shipment data flow.
3. Produce C4-style architecture diagrams.
4. Identify security risks and technical debt.
5. List the main API endpoints, the database
   tables and relations, how authentication and
   role-based access (RBAC) work, and the Git
   workflow (branches, commits, deploy).
6. Explain 10 key architectural decisions
   and their trade-offs.
7. Ask me 10 questions to test my understanding.

Cite actual file paths.
Separate verified facts from assumptions.
Explain concepts for a beginner in architecture.`;

export const AI_ITEMS: AiItem[] = AI_WEEKS.flatMap((w) => w.items);
export const aiItemById = (id: string) => AI_ITEMS.find((i) => i.id === id);
