import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { LISTENING_PARTS, READING_PARTS, SPEAKING_TASKS, WRITING_TASKS, type Skill } from "../../shared/spec";

// What a newcomer meets on test day: the four skills in the order they are taken, every part with
// question count and timing (from shared/spec), and what each part asks in Vietnamese.

const PART_VI: Record<string, string> = {
  R1: "Đọc một email/thư cá nhân và trả lời câu hỏi, sau đó điền chỗ trống trong thư trả lời.",
  R2: "Đọc một sơ đồ (lịch, bảng giá, thực đơn, bản đồ) rồi điền chỗ trống trong một email cần dùng thông tin từ sơ đồ.",
  R3: "Đọc bài thông tin gồm 4 đoạn A–D; ghép mỗi câu với đoạn chứa thông tin đó, hoặc chọn E nếu không đoạn nào nói.",
  R4: "Đọc bài báo có nhiều quan điểm, trả lời câu hỏi rồi điền chỗ trống trong bình luận của một độc giả.",
  L1: "Hội thoại chia 3 đoạn về cách giải quyết một vấn đề; câu hỏi xuất hiện sau mỗi đoạn.",
  L2: "Hội thoại về một tình huống đời thường; câu hỏi sau khi nghe xong.",
  L3: "Một người cung cấp thông tin cho người kia (hướng dẫn, quy trình, chi tiết dịch vụ).",
  L4: "Một bản tin ngắn về sự kiện địa phương.",
  L5: "Thảo luận giữa 3 người trở lên. Thi thật là video; trong app chỉ có audio.",
  L6: "Một bài nói trình bày quan điểm về một vấn đề, thường kèm ý kiến trái chiều.",
  W1: "Viết email theo tình huống cho sẵn (khiếu nại, đề nghị, cảm ơn…), trả lời đủ các ý được yêu cầu.",
  W2: "Chọn một trong hai phương án của bản khảo sát và giải thích vì sao bạn chọn.",
  S1: "Cho lời khuyên cho một người đang gặp vấn đề.",
  S2: "Kể về một trải nghiệm cá nhân.",
  S3: "Mô tả một bức tranh: ai, ở đâu, đang làm gì.",
  S4: "Dựa vào bức tranh ở Task 3, dự đoán chuyện gì sẽ xảy ra tiếp theo.",
  S5: "Chọn một trong hai phương án, rồi thuyết phục người khác rằng lựa chọn của bạn tốt hơn phương án kia.",
  S6: "Xử lý một tình huống khó: chọn một trong hai cách và nói chuyện trực tiếp với người liên quan.",
  S7: "Nêu ý kiến đồng ý hay không với một chủ đề và đưa lý do.",
  S8: "Mô tả một đồ vật lạ trong tranh cho người không nhìn thấy nó.",
};

const fmt = (sec: number) => (sec % 60 === 0 ? `${sec / 60} phút` : `${sec} giây`);

interface Row { id: string; name: string; meta: string }
interface Section {
  skill: Skill; icon: IconName; title: string; time: string; summary: string; to: string;
  rows: Row[]; tips: string[];
}

const SECTIONS: Section[] = [
  {
    skill: "listening", icon: "headphones", title: "Listening", time: "≈ 47–55 phút", to: "/listening",
    summary: `1 câu luyện thử + 6 part, ${LISTENING_PARTS.reduce((n, p) => n + p.questions, 0)} câu trắc nghiệm.`,
    rows: LISTENING_PARTS.map((p) => ({ id: p.id, name: p.name, meta: `${p.questions} câu` })),
    tips: ["Mỗi đoạn audio chỉ phát một lần, không tua lại được.", "Câu hỏi thường hiện sau khi nghe xong, nên ghi chú trong lúc nghe.", "Không quay lại được part đã làm xong."],
  },
  {
    skill: "reading", icon: "book-open", title: "Reading", time: "≈ 55–60 phút", to: "/reading",
    summary: `1 câu luyện thử + 4 part, ${READING_PARTS.reduce((n, p) => n + p.questions, 0)} câu trắc nghiệm.`,
    rows: READING_PARTS.map((p) => ({ id: p.id, name: p.name, meta: `${p.questions} câu · ~${p.minutes} phút` })),
    tips: ["Mỗi part có đồng hồ riêng; hết giờ là tự chuyển part.", "Đọc câu hỏi trước rồi dò thông tin trong bài để tiết kiệm thời gian."],
  },
  {
    skill: "writing", icon: "pen-line", title: "Writing", time: "≈ 53–60 phút", to: "/writing",
    summary: "2 task viết trên máy tính, có bộ đếm từ.",
    rows: WRITING_TASKS.map((t) => ({ id: t.id, name: t.name, meta: `${t.minutes} phút · ${t.minWords}–${t.maxWords} từ` })),
    tips: ["Không có kiểm tra chính tả; dành 2–3 phút cuối để soát lỗi.", "Trả lời đủ mọi ý trong đề quan trọng hơn viết dài."],
  },
  {
    skill: "speaking", icon: "mic", title: "Speaking", time: "≈ 15–20 phút", to: "/speaking",
    summary: "1 câu luyện thử + 8 task, nói vào micro trên tai nghe, máy tự ghi âm.",
    rows: SPEAKING_TASKS.map((t) => ({
      id: t.id, name: t.name,
      meta: `${t.selectSec ? `chọn ${fmt(t.selectSec)} · ` : ""}chuẩn bị ${fmt(t.prepSec)} · nói ${fmt(t.speakSec)}`,
    })),
    tips: ["Hết giờ chuẩn bị là máy tự ghi âm, không có nút bắt đầu.", "Nói đến gần hết giờ; dừng quá sớm thường bị điểm thấp hơn.", "Mọi người trong phòng thi nói cùng lúc, hãy tập nói khi có tiếng ồn."],
  },
];

export function ExamStructurePage() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cấu trúc bài thi</h1>
          <p>CELPIP-General thi trên máy tính, làm hết 4 kỹ năng trong một buổi, khoảng 3 giờ, theo đúng thứ tự dưới đây.</p>
        </div>
      </div>

      <div className="exam-flow">
        {SECTIONS.map((s, i) => (
          <a key={s.skill} href={`#exam-${s.skill}`} className={`exam-step skill-${s.skill}`}>
            <span className="exam-step-n">{i + 1}</span>
            <span><strong>{s.title}</strong><span className="muted small">{s.time}</span></span>
          </a>
        ))}
      </div>

      {SECTIONS.map((s, i) => (
        <section key={s.skill} id={`exam-${s.skill}`} className={`card exam-skill skill-${s.skill}`}>
          <div className="exam-skill-head">
            <span className="hub-icon"><Icon name={s.icon} size={20} /></span>
            <div className="grow">
              <h2>{i + 1}. {s.title} <span className="muted small">{s.time}</span></h2>
              <p className="muted">{s.summary}</p>
            </div>
          </div>
          <ol className="exam-parts">
            {s.rows.map((r) => (
              <li key={r.id}>
                <div className="exam-part-top">
                  <strong>{r.id[0] === "S" || r.id[0] === "W" ? "Task" : "Part"} {r.id.slice(1)}: {r.name}</strong>
                  <span className="badge">{r.meta}</span>
                </div>
                <p>{PART_VI[r.id]}</p>
              </li>
            ))}
          </ol>
          <ul className="exam-tips">
            {s.tips.map((t, j) => <li key={j}><Icon name="lightbulb" /> {t}</li>)}
          </ul>
          <Link className="btn small" to={s.to}>Luyện {s.title} <Icon name="chevron-right" /></Link>
        </section>
      ))}

      <section className="card">
        <h2>Chấm điểm</h2>
        <ul>
          <li>Mỗi kỹ năng có điểm riêng theo thang <strong>CELPIP Level 1–12</strong> (M = dưới mức tối thiểu). Không có điểm tổng.</li>
          <li>Level CELPIP tương ứng với CLB: Level 8 ≈ CLB 8, Level 9 ≈ CLB 9.</li>
          <li>Listening và Reading chấm theo số câu đúng; Writing và Speaking do giám khảo chấm theo nội dung, từ vựng, độ mạch lạc và mức độ đáp ứng yêu cầu đề.</li>
        </ul>
        <div className="row gap-s wrap">
          <Link className="btn primary" to="/mock"><Icon name="clipboard-check" /> Làm thử một bài thi đầy đủ</Link>
        </div>
      </section>

      <p className="muted small">Thời gian là ước tính để luyện tập. Kiểm tra lại thông tin chính thức trên celpip.ca trước ngày thi.</p>
    </div>
  );
}
