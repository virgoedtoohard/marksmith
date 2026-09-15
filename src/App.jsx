import React, { useState, useMemo, useEffect } from "react";

// ============ DESIGN TOKENS ============
const paper = "#FAFAF7";
const ink = "#1F2333";
const inkSoft = "#4A4F63";
const muted = "#6B6960";
const rule = "#E4DED0";
const bronze = "#8B6B3F";
const bronzeSoft = "#C9A876";
const good = "#5C7A5F";
const warn = "#B5804A";
const bad = "#A85A4A";
const paperDeep = "#F1EDE1";

const fontsCSS = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');`;

// ============ BACKEND (Cloudflare Worker) ============
// Fill this in after you deploy the worker/ folder — see worker/README or
// the deployment instructions you were given. Example:
// "https://marksmith-proxy.yourname.workers.dev"
const WORKER_URL = "https://REPLACE-WITH-YOUR-WORKER-URL.workers.dev";

// ============ SETTINGS STORAGE ============
const STORAGE_KEY = "marksmith:apiKey"; // now holds a signed session token, not a raw Anthropic key
const ORG_KEY = "marksmith:org";
const MODEL_KEY = "marksmith:model";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const MODELS = [
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 (recommended)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (cheaper, faster)" },
  { id: "claude-opus-4-5-20250929", label: "Claude Opus 4.5 (highest quality, slower)" },
];

function loadApiKey() {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
}
function saveApiKey(v) {
  try { if (v) localStorage.setItem(STORAGE_KEY, v); else localStorage.removeItem(STORAGE_KEY); } catch {}
}
function loadOrgName() {
  try { return localStorage.getItem(ORG_KEY) || ""; } catch { return ""; }
}
function saveOrgName(v) {
  try { if (v) localStorage.setItem(ORG_KEY, v); else localStorage.removeItem(ORG_KEY); } catch {}
}
function loadModel() {
  try { return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
function saveModel(v) {
  try { localStorage.setItem(MODEL_KEY, v); } catch {}
}

// ============ HELPERS ============
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}
function cleanJSON(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

async function callClaude(apiKey, model, system, userContent, maxTokens = 2000) {
  if (!apiKey) throw new Error("You're not signed in. Open Settings and sign in with your organization's access code.");
  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    let msg = `API returned ${res.status}`;
    try {
      const err = await res.json();
      if (err.error?.message) msg += `: ${err.error.message}`;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ============ DEFAULT RUBRICS ============
const DEFAULT_RUBRIC = [
  { id: 1, name: "Academic Merit", description: "GPA, transcripts, coursework, academic honors.", maxPoints: 25 },
  { id: 2, name: "Financial Need", description: "Household income, dependents, evidence of need.", maxPoints: 20 },
  { id: 3, name: "Personal Statement", description: "Clarity of goals, motivation, authenticity.", maxPoints: 20 },
  { id: 4, name: "Leadership & Community", description: "Service, leadership roles, community impact.", maxPoints: 15 },
  { id: 5, name: "Extracurriculars", description: "Sports, clubs, projects, work experience.", maxPoints: 10 },
  { id: 6, name: "Writing Quality", description: "Grammar, structure, coherence of application.", maxPoints: 10 },
];

const RUBRIC_TEMPLATES = {
  Standard: DEFAULT_RUBRIC,
  "Need-based": [
    { id: 1, name: "Financial Need", description: "Household income, dependents, expenses documented.", maxPoints: 40 },
    { id: 2, name: "Academic Standing", description: "Passing grades and consistent attendance.", maxPoints: 20 },
    { id: 3, name: "Personal Circumstances", description: "Challenges the applicant is navigating.", maxPoints: 20 },
    { id: 4, name: "Commitment to Completion", description: "Plan and support to finish studies.", maxPoints: 20 },
  ],
  "Merit-only": [
    { id: 1, name: "Academic Excellence", description: "Grades, test scores, academic distinction.", maxPoints: 40 },
    { id: 2, name: "Intellectual Depth", description: "Independent projects, research, technical skill.", maxPoints: 25 },
    { id: 3, name: "Awards & Recognition", description: "Competitions, honors, publications.", maxPoints: 20 },
    { id: 4, name: "Written Argument", description: "Rigor and clarity of the personal statement.", maxPoints: 15 },
  ],
  Leadership: [
    { id: 1, name: "Leadership Experience", description: "Roles held, teams led, decisions made.", maxPoints: 30 },
    { id: 2, name: "Community Impact", description: "Concrete outcomes for others.", maxPoints: 25 },
    { id: 3, name: "Vision", description: "What the applicant intends to build.", maxPoints: 20 },
    { id: 4, name: "Academic Foundation", description: "Grades sufficient to succeed.", maxPoints: 15 },
    { id: 5, name: "Communication", description: "How they tell their story.", maxPoints: 10 },
  ],
};

// ============ LOGO ============
function Logo({ size = 40, color = bronze }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Marksmith">
      <path d="M32 50 L10 44 L10 20 L32 26 Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <path d="M32 50 L54 44 L54 20 L32 26 Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <line x1="32" y1="26" x2="32" y2="50" stroke={color} strokeWidth="1.8"/>
      <line x1="15" y1="30" x2="27" y2="33" stroke={color} strokeWidth="0.9" opacity="0.45"/>
      <line x1="15" y1="36" x2="27" y2="39" stroke={color} strokeWidth="0.9" opacity="0.45"/>
      <line x1="37" y1="33" x2="49" y2="30" stroke={color} strokeWidth="0.9" opacity="0.45"/>
      <line x1="37" y1="39" x2="49" y2="36" stroke={color} strokeWidth="0.9" opacity="0.45"/>
      <line x1="56" y1="6" x2="40" y2="22" stroke={color} strokeWidth="2.4" strokeLinecap="round"/>
      <path d="M40 22 L36 26 L42 24 Z" fill={color}/>
      <circle cx="37" cy="28" r="0.9" fill={color}/>
    </svg>
  );
}

// ============ SHARED COMPONENTS ============
function SectionLabel({ n, title, action }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: bronze, fontSize: 12, letterSpacing: "0.1em" }}>{n}</span>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      </div>
      {action}
    </div>
  );
}
function SubHeading({ children }) {
  return (
    <h3 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: muted, fontWeight: 500, margin: "0 0 12px", paddingBottom: 6, borderBottom: `1px solid ${rule}` }}>
      {children}
    </h3>
  );
}
const primaryBtn = (disabled) => ({
  background: disabled ? muted : ink, color: paper, border: "none",
  padding: "12px 24px", fontFamily: "'Inter', sans-serif", fontSize: 14,
  fontWeight: 500, letterSpacing: "0.02em", cursor: disabled ? "not-allowed" : "pointer",
  borderRadius: 2, transition: "background 200ms",
});
const ghostBtn = {
  background: "transparent", color: inkSoft, border: `1px solid ${rule}`,
  padding: "6px 12px", fontFamily: "'Inter', sans-serif", fontSize: 12,
  cursor: "pointer", borderRadius: 2,
};
const editInput = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px",
  border: `1px solid ${rule}`, borderRadius: 2, fontFamily: "'Inter', sans-serif",
  fontSize: 14, color: ink, background: paper, outline: "none",
};

// ============ KEY BANNER ============
function KeyBanner({ onNav }) {
  return (
    <div style={{ background: paperDeep, borderLeft: `3px solid ${warn}`, padding: "12px 20px", marginBottom: 24, fontSize: 14, color: inkSoft, borderRadius: 2 }}>
      You're not signed in. <button onClick={() => onNav("settings")} style={{ background: "none", border: "none", color: bronze, borderBottom: `1px solid ${bronze}`, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit" }}>Open Settings</button> to sign in with your organization's access code before running a review.
    </div>
  );
}

// ============ NAV ============
function Nav({ current, onNav, hasKey }) {
  const items = [
    { id: "home", label: "Home" },
    { id: "review", label: "Review" },
    { id: "compare", label: "Compare" },
    { id: "rubric", label: "Rubric" },
    { id: "feedback", label: "Feedback" },
    { id: "about", label: "About" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <header style={{ borderBottom: `1px solid ${rule}`, background: paper, position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <button onClick={() => onNav("home")} style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
          <Logo size={32}/>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 500, color: ink, letterSpacing: "-0.01em" }}>Marksmith</span>
        </button>
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          {items.map((it) => {
            const active = current === it.id;
            const isSettings = it.id === "settings";
            return (
              <button key={it.id} onClick={() => onNav(it.id)} style={{
                background: active ? paperDeep : "transparent",
                color: active ? ink : inkSoft,
                border: "none", padding: "8px 14px", cursor: "pointer",
                fontFamily: "'Inter', sans-serif", fontSize: 13,
                fontWeight: active ? 600 : 400, borderRadius: 2,
                borderBottom: active ? `1.5px solid ${bronze}` : "1.5px solid transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {it.label}
                {isSettings && !hasKey && <span title="Not signed in" style={{ width: 6, height: 6, borderRadius: "50%", background: warn, display: "inline-block" }}/>}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

// ============ HOME ============
function Home({ onNav, reviewCount, rubric, hasKey }) {
  const totalPts = rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0);
  const tools = [
    { id: "review", n: "I", title: "Review", desc: "Read one scholarship application. Get key facts, clarifying questions, and a scorecard.", cta: "Review an application" },
    { id: "compare", n: "II", title: "Compare", desc: "Score multiple applications against the same rubric. See them ranked side by side.", cta: "Compare a batch" },
    { id: "rubric", n: "III", title: "Rubric", desc: "Build the scoring criteria that fit your scholarship. Start from a preset or write your own.", cta: "Shape a rubric" },
    { id: "feedback", n: "IV", title: "Feedback", desc: "Draft a letter to the applicant based on the review — award, waitlist, or decline.", cta: "Draft a letter" },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 32px 80px" }}>
      {!hasKey && <KeyBanner onNav={onNav}/>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 60, alignItems: "start" }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.18em", color: bronze, textTransform: "uppercase", marginBottom: 10 }}>
            The Reviewer's Desk
          </div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 88, lineHeight: 0.95, margin: 0, fontWeight: 500, letterSpacing: "-0.03em", color: ink }}>
            Marksmith
          </h1>
          <p style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 22, color: inkSoft, marginTop: 20, marginBottom: 0, lineHeight: 1.4, maxWidth: 520 }}>
            Read scholarship applications like a whole review board — faster.
          </p>
          <p style={{ fontSize: 15, color: muted, lineHeight: 1.65, marginTop: 20, maxWidth: 520 }}>
            Paste or upload an application. Marksmith summarizes who's applying, raises the questions a careful reviewer would ask, and scores every section against your rubric. Four tools work off the same desk.
          </p>
          <div style={{ marginTop: 32, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => onNav("review")} style={primaryBtn(false)}>Start a review</button>
            <button onClick={() => onNav("rubric")} style={ghostBtn}>Shape your rubric first</button>
          </div>
        </div>
        <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 28, borderRadius: 2 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <Logo size={72}/>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <Stat n={rubric.length} label="Criteria"/>
            <Stat n={totalPts} label="Points possible"/>
            <Stat n={reviewCount} label="Reviews this session"/>
            <Stat n={"4"} label="Tools on the desk"/>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 80 }}>
        <SubHeading>The desk — four tools</SubHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 20 }}>
          {tools.map((t) => (
            <button key={t.id} onClick={() => onNav(t.id)} style={{
              background: "#fff", border: `1px solid ${rule}`, padding: 24,
              textAlign: "left", cursor: "pointer", borderRadius: 2,
              transition: "border-color 200ms", fontFamily: "'Inter', sans-serif",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = bronze; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = rule; }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 44, fontWeight: 500, color: bronze, lineHeight: 1 }}>{t.n}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Tool {t.n}</div>
              </div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, marginTop: 14, color: ink }}>{t.title}</div>
              <p style={{ fontSize: 14, color: muted, lineHeight: 1.6, marginTop: 8, marginBottom: 18 }}>{t.desc}</p>
              <span style={{ borderBottom: `1px solid ${bronze}`, color: bronze, fontSize: 13, fontWeight: 500 }}>{t.cta} →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 34, color: ink, lineHeight: 1, fontWeight: 500 }}>{n}</div>
      <div style={{ fontSize: 11, color: muted, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 6 }}>{label}</div>
    </div>
  );
}

// ============ TOOL I: REVIEW ============
function ReviewTool({ apiKey, model, rubric, onSaveReview, onNav }) {
  const [applicationText, setApplicationText] = useState("");
  const [pdfBase64, setPdfBase64] = useState(null);
  const [pdfName, setPdfName] = useState("");
  const [applicantLabel, setApplicantLabel] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const totalMax = useMemo(() => rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0), [rubric]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") return setError("Please upload a PDF, or paste the text instead.");
    try {
      const b64 = await fileToBase64(file);
      setPdfBase64(b64); setPdfName(file.name); setApplicationText(""); setError(null);
    } catch (err) { setError(err.message); }
  }

  async function analyze() {
    if (!apiKey) return setError("Add an API key in Settings first.");
    if (!pdfBase64 && !applicationText.trim()) return setError("Paste an application or upload a PDF first.");
    if (rubric.length === 0) return setError("Add criteria in the Rubric tool.");
    setAnalyzing(true); setError(null); setResult(null);

    const rubricText = rubric.map((c) => `- "${c.name}" (max ${c.maxPoints} pts): ${c.description}`).join("\n");
    const system = `You are an experienced scholarship reviewer. Read the application and score it against the rubric.

RUBRIC:
${rubricText}
Total possible: ${totalMax} points.

Rules:
- Score based only on evidence in the application. Missing evidence = low score + a clarifying question.
- Be honest. Do not inflate scores to be kind.

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "applicant": { "name": "string or 'Not stated'", "summary": "2-3 sentences" },
  "keyFacts": ["short bullet", "..."],
  "questions": ["clarifying question", "..."],
  "scores": [{ "criterion": "exact rubric name", "points": number, "maxPoints": number, "reasoning": "1-2 sentences" }],
  "totalPoints": number,
  "totalMax": ${totalMax},
  "overallImpression": "1-2 sentences"
}`;

    const userContent = pdfBase64
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: "Please review this scholarship application against the rubric." },
        ]
      : `Please review this scholarship application against the rubric:\n\n${applicationText}`;

    try {
      const text = await callClaude(apiKey, model, system, userContent, 2000);
      const parsed = JSON.parse(cleanJSON(text));
      const withLabel = { ...parsed, label: applicantLabel || parsed.applicant?.name || "Untitled review", timestamp: new Date().toISOString() };
      setResult(withLabel);
      onSaveReview(withLabel);
    } catch (err) { setError(err.message || "Something went wrong. Try again."); }
    finally { setAnalyzing(false); }
  }

  function reset() {
    setResult(null); setError(null); setApplicationText("");
    setPdfBase64(null); setPdfName(""); setApplicantLabel("");
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Tool I" title="Review" desc="Read one application. Get facts, questions, and a scorecard."/>
      {!apiKey && <div style={{ marginTop: 24 }}><KeyBanner onNav={onNav}/></div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 40, marginTop: 40 }}>
        <section>
          <SectionLabel n="01" title="The Application"/>
          <input value={applicantLabel} onChange={(e) => setApplicantLabel(e.target.value)}
            placeholder="Optional label (e.g. 'Jane Doe — nursing')"
            style={{ ...editInput, marginBottom: 12, background: "#fff" }}/>
          <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2 }}>
            {pdfBase64 ? (
              <div style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>PDF loaded</div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, marginTop: 4 }}>{pdfName}</div>
                </div>
                <button onClick={() => { setPdfBase64(null); setPdfName(""); }} style={ghostBtn}>Remove</button>
              </div>
            ) : (
              <textarea value={applicationText} onChange={(e) => setApplicationText(e.target.value)}
                placeholder="Paste the applicant's essay, form responses, or full application here…"
                style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none",
                  padding: 20, minHeight: 240, resize: "vertical", background: "transparent",
                  fontFamily: "'Inter', sans-serif", fontSize: 14, color: ink, lineHeight: 1.6 }}/>
            )}
            <div style={{ borderTop: `1px solid ${rule}`, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: paperDeep }}>
              <label style={{ cursor: "pointer", fontSize: 13, color: inkSoft }}>
                <input type="file" accept="application/pdf" onChange={handleFile} style={{ display: "none" }}/>
                <span style={{ borderBottom: `1px solid ${bronze}`, color: bronze, fontWeight: 500 }}>Upload PDF instead</span>
              </label>
              <span style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace" }}>
                {pdfBase64 ? "PDF" : `${applicationText.length} chars`}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 24, padding: 16, background: paperDeep, borderRadius: 2, fontSize: 13, color: inkSoft }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: muted, marginBottom: 6 }}>Using rubric</div>
            {rubric.length} criteria · {totalMax} points possible
          </div>
          <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={analyze} disabled={analyzing || !apiKey} style={primaryBtn(analyzing || !apiKey)}>
              {analyzing ? "Reading…" : "Read & score"}
            </button>
            {result && <button onClick={reset} style={ghostBtn}>Start over</button>}
            {error && <span style={{ color: warn, fontSize: 13 }}>{error}</span>}
          </div>
        </section>

        <section>
          <SectionLabel n="02" title="The Review"/>
          {!result && !analyzing && (
            <div style={{ border: `1px dashed ${rule}`, padding: "60px 24px", textAlign: "center", color: muted, borderRadius: 2 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: inkSoft, marginBottom: 8 }}>Awaiting application</div>
              The scorecard will appear here.
            </div>
          )}
          {analyzing && (
            <div style={{ border: `1px solid ${rule}`, padding: "60px 24px", textAlign: "center", background: "#fff" }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 20, color: ink }}>Reading…</div>
              <div style={{ marginTop: 8, fontSize: 13, color: muted }}>Scoring against {rubric.length} criteria.</div>
            </div>
          )}
          {result && <ReviewOutput result={result}/>}
        </section>
      </div>
    </div>
  );
}

function ReviewOutput({ result }) {
  const pct = result.totalMax > 0 ? Math.round((result.totalPoints / result.totalMax) * 100) : 0;
  return (
    <div>
      <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: "24px 28px", borderRadius: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: muted, letterSpacing: "0.14em", textTransform: "uppercase" }}>Final Score</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 68, lineHeight: 1, color: ink, fontWeight: 500, letterSpacing: "-0.02em" }}>{result.totalPoints}</span>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 28, color: muted }}>/ {result.totalMax}</span>
            </div>
          </div>
          <div style={{ border: `1.5px solid ${bronze}`, color: bronze, padding: "6px 14px", borderRadius: 2, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.14em", transform: "rotate(-2deg)", textTransform: "uppercase" }}>
            {pct}% · Reviewed
          </div>
        </div>
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${rule}` }}>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: muted, letterSpacing: "0.14em", textTransform: "uppercase" }}>Applicant</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, marginTop: 4 }}>{result.applicant?.name || "Not stated"}</div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: inkSoft, margin: "8px 0 0" }}>{result.applicant?.summary}</p>
        </div>
      </div>

      {result.keyFacts?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SubHeading>What we found</SubHeading>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {result.keyFacts.map((f, i) => (
              <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i < result.keyFacts.length - 1 ? `1px solid ${rule}` : "none", fontSize: 14, color: inkSoft }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: bronzeSoft, fontSize: 11, marginTop: 3 }}>—</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.questions?.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <SubHeading>Questions for the applicant</SubHeading>
          <ol style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
            {result.questions.map((q, i) => (
              <li key={i} style={{ display: "flex", gap: 14, padding: "10px 0", borderBottom: `1px solid ${rule}` }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: bronze, minWidth: 24, marginTop: 3 }}>Q{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontFamily: "'Fraunces', serif", fontSize: 16, lineHeight: 1.4, color: ink }}>{q}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <SubHeading>Scorecard</SubHeading>
        <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2 }}>
          {result.scores?.map((s, i) => {
            const p = s.maxPoints > 0 ? s.points / s.maxPoints : 0;
            const barColor = p >= 0.75 ? good : p >= 0.5 ? bronze : warn;
            return (
              <div key={i} style={{ padding: "16px 20px", borderTop: i === 0 ? "none" : `1px solid ${rule}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16 }}>{s.criterion}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: ink, whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 700 }}>{s.points}</span>
                    <span style={{ color: muted }}> / {s.maxPoints}</span>
                  </div>
                </div>
                <div style={{ height: 3, background: paperDeep, marginTop: 10, borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ width: `${p * 100}%`, height: "100%", background: barColor, transition: "width 400ms ease" }}/>
                </div>
                <p style={{ fontSize: 13, color: muted, margin: "10px 0 0", lineHeight: 1.6 }}>{s.reasoning}</p>
              </div>
            );
          })}
        </div>
      </div>

      {result.overallImpression && (
        <div style={{ marginTop: 28, padding: "20px 24px", background: paperDeep, borderLeft: `3px solid ${bronze}`, borderRadius: 2 }}>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: muted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Overall impression</div>
          <p style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontStyle: "italic", lineHeight: 1.5, color: ink, margin: 0 }}>"{result.overallImpression}"</p>
        </div>
      )}
    </div>
  );
}

// ============ TOOL II: COMPARE ============
function CompareTool({ apiKey, model, rubric, onSaveReview, onNav }) {
  const [applicants, setApplicants] = useState([{ id: 1, label: "", text: "" }]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const totalMax = useMemo(() => rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0), [rubric]);

  function addApplicant() { setApplicants((a) => [...a, { id: Math.max(0, ...a.map((x) => x.id)) + 1, label: "", text: "" }]); }
  function removeApplicant(id) { setApplicants((a) => a.filter((x) => x.id !== id)); }
  function updateApplicant(id, patch) { setApplicants((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x))); }

  async function runAll() {
    if (!apiKey) return setError("Add an API key in Settings first.");
    const valid = applicants.filter((a) => a.text.trim().length > 30);
    if (valid.length < 2) return setError("Add at least two applications (30+ chars each).");
    if (rubric.length === 0) return setError("Add criteria in the Rubric tool first.");
    setRunning(true); setError(null); setResults([]); setProgress(0);

    const rubricText = rubric.map((c) => `- "${c.name}" (max ${c.maxPoints} pts): ${c.description}`).join("\n");
    const system = `You are an experienced scholarship reviewer. Score this application against the rubric.

RUBRIC:
${rubricText}
Total possible: ${totalMax} points.

Rules:
- Score based only on evidence. Missing evidence = low score.
- Be honest.

Respond with ONLY valid JSON:
{
  "applicant": { "name": "string or 'Not stated'", "summary": "2-3 sentences" },
  "keyFacts": ["bullet", "..."],
  "questions": ["question", "..."],
  "scores": [{ "criterion": "exact rubric name", "points": number, "maxPoints": number, "reasoning": "1-2 sentences" }],
  "totalPoints": number,
  "totalMax": ${totalMax},
  "overallImpression": "1-2 sentences"
}`;

    const out = [];
    for (let i = 0; i < valid.length; i++) {
      const a = valid[i];
      try {
        const text = await callClaude(apiKey, model, system, `Please review this scholarship application:\n\n${a.text}`, 2000);
        const parsed = JSON.parse(cleanJSON(text));
        const withLabel = { ...parsed, label: a.label || parsed.applicant?.name || `Applicant ${i + 1}`, timestamp: new Date().toISOString() };
        out.push(withLabel);
        onSaveReview(withLabel);
      } catch (err) {
        out.push({ label: a.label || `Applicant ${i + 1}`, error: err.message, totalPoints: 0, totalMax });
      }
      setProgress(i + 1);
      setResults([...out]);
    }
    setRunning(false);
  }

  const ranked = [...results].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Tool II" title="Compare" desc="Score multiple applications. See them ranked side by side."/>
      {!apiKey && <div style={{ marginTop: 24 }}><KeyBanner onNav={onNav}/></div>}

      <div style={{ marginTop: 40 }}>
        <SectionLabel n="01" title="Applications" action={<button onClick={addApplicant} style={ghostBtn}>+ Add applicant</button>}/>
        <div style={{ display: "grid", gap: 16 }}>
          {applicants.map((a, i) => (
            <div key={a.id} style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2 }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${rule}`, background: paperDeep, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: bronze, fontSize: 12 }}>#{String(i + 1).padStart(2, "0")}</span>
                  <input value={a.label} onChange={(e) => updateApplicant(a.id, { label: e.target.value })}
                    placeholder="Applicant label (optional)"
                    style={{ ...editInput, flex: 1, background: "#fff" }}/>
                </div>
                {applicants.length > 1 && <button onClick={() => removeApplicant(a.id)} style={{ ...ghostBtn, color: warn }}>Remove</button>}
              </div>
              <textarea value={a.text} onChange={(e) => updateApplicant(a.id, { text: e.target.value })}
                placeholder="Paste this applicant's essay or full application…"
                style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none",
                  padding: 16, minHeight: 140, resize: "vertical", background: "transparent",
                  fontFamily: "'Inter', sans-serif", fontSize: 14, color: ink, lineHeight: 1.6 }}/>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={runAll} disabled={running || !apiKey} style={primaryBtn(running || !apiKey)}>
            {running ? `Reading… ${progress} / ${applicants.filter((a) => a.text.trim().length > 30).length}` : "Score all"}
          </button>
          {error && <span style={{ color: warn, fontSize: 13 }}>{error}</span>}
          <span style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto" }}>
            Rubric: {rubric.length} criteria · {totalMax} pts
          </span>
        </div>
      </div>

      {results.length > 0 && (
        <div style={{ marginTop: 60 }}>
          <SectionLabel n="02" title="Leaderboard"/>
          <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2 }}>
            {ranked.map((r, i) => {
              const pct = r.totalMax > 0 ? Math.round(((r.totalPoints || 0) / r.totalMax) * 100) : 0;
              return (
                <div key={i} style={{ padding: "20px 24px", borderTop: i === 0 ? "none" : `1px solid ${rule}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "40px 1fr auto", gap: 20, alignItems: "center" }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 32, color: i === 0 ? bronze : muted, fontWeight: 500 }}>
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: ink }}>{r.label}</div>
                      {r.error ? (
                        <div style={{ fontSize: 13, color: warn, marginTop: 4 }}>Error: {r.error}</div>
                      ) : (
                        <div style={{ fontSize: 13, color: muted, marginTop: 4, lineHeight: 1.5 }}>{r.applicant?.summary}</div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, color: ink, fontWeight: 500, lineHeight: 1 }}>
                        {r.totalPoints || 0}<span style={{ color: muted, fontSize: 18 }}>/{r.totalMax}</span>
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: bronze, marginTop: 6, letterSpacing: "0.1em" }}>{pct}%</div>
                    </div>
                  </div>
                  {!r.error && (
                    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: `repeat(${r.scores?.length || 1}, 1fr)`, gap: 4 }}>
                      {r.scores?.map((s, j) => {
                        const p = s.maxPoints > 0 ? s.points / s.maxPoints : 0;
                        return (
                          <div key={j} title={`${s.criterion}: ${s.points}/${s.maxPoints}`}>
                            <div style={{ height: 4, background: paperDeep, borderRadius: 1, overflow: "hidden" }}>
                              <div style={{ width: `${p * 100}%`, height: "100%", background: p >= 0.75 ? good : p >= 0.5 ? bronze : warn }}/>
                            </div>
                            <div style={{ fontSize: 10, color: muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.criterion}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ TOOL III: RUBRIC ============
function RubricBuilder({ rubric, setRubric }) {
  const totalMax = useMemo(() => rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0), [rubric]);

  function updateCriterion(id, patch) { setRubric((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))); }
  function removeCriterion(id) { setRubric((cs) => cs.filter((c) => c.id !== id)); }
  function addCriterion() {
    const newId = Math.max(0, ...rubric.map((c) => c.id)) + 1;
    setRubric((cs) => [...cs, { id: newId, name: "New criterion", description: "What this measures.", maxPoints: 10 }]);
  }
  function loadTemplate(name) {
    if (window.confirm(`Replace the current rubric with the "${name}" template?`)) {
      setRubric(RUBRIC_TEMPLATES[name].map((c) => ({ ...c })));
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Tool III" title="Rubric" desc="Shape the scoring criteria that fit your scholarship."/>

      <div style={{ marginTop: 40 }}>
        <SectionLabel n="01" title="Presets" action={<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: muted, letterSpacing: "0.1em" }}>Start from a template</span>}/>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {Object.entries(RUBRIC_TEMPLATES).map(([name, criteria]) => {
            const tot = criteria.reduce((s, c) => s + c.maxPoints, 0);
            return (
              <button key={name} onClick={() => loadTemplate(name)} style={{
                background: "#fff", border: `1px solid ${rule}`, padding: 16, textAlign: "left",
                cursor: "pointer", borderRadius: 2, fontFamily: "'Inter', sans-serif",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = bronze; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = rule; }}
              >
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: ink }}>{name}</div>
                <div style={{ fontSize: 12, color: muted, marginTop: 6, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em" }}>
                  {criteria.length} criteria · {tot} pts
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 48 }}>
        <SectionLabel n="02" title="Current rubric" action={
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: bronze }}>
            {totalMax}<span style={{ color: muted, fontSize: 14 }}> pts total</span>
          </div>
        }/>
        <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2 }}>
          {rubric.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: muted, fontSize: 14 }}>
              No criteria yet. Add one below or load a preset above.
            </div>
          )}
          {rubric.map((c, i) => (
            <div key={c.id} style={{ padding: "16px 20px", borderTop: i === 0 ? "none" : `1px solid ${rule}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 80px", gap: 12, alignItems: "start" }}>
                <div>
                  <input value={c.name} onChange={(e) => updateCriterion(c.id, { name: e.target.value })}
                    style={{ ...editInput, fontFamily: "'Fraunces', serif", fontSize: 17 }}/>
                  <textarea value={c.description} onChange={(e) => updateCriterion(c.id, { description: e.target.value })}
                    style={{ ...editInput, marginTop: 6, fontSize: 13, color: muted, minHeight: 44, resize: "vertical" }}/>
                </div>
                <input type="number" min="0" value={c.maxPoints} onChange={(e) => updateCriterion(c.id, { maxPoints: Number(e.target.value) })}
                  style={{ ...editInput, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}/>
                <button onClick={() => removeCriterion(c.id)} style={{ ...ghostBtn, color: warn, alignSelf: "start" }}>Remove</button>
              </div>
            </div>
          ))}
          <div style={{ padding: 12, borderTop: `1px solid ${rule}`, background: paperDeep, textAlign: "center" }}>
            <button onClick={addCriterion} style={ghostBtn}>+ Add criterion</button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: muted, marginTop: 12, fontStyle: "italic" }}>
          Changes save in this session. Your rubric is used automatically by Review and Compare.
        </p>
      </div>
    </div>
  );
}

// ============ TOOL IV: FEEDBACK ============
function FeedbackComposer({ apiKey, model, savedReviews, onNav }) {
  const [selectedIdx, setSelectedIdx] = useState(savedReviews.length > 0 ? 0 : -1);
  const [decision, setDecision] = useState("awarded");
  const [tone, setTone] = useState("warm");
  const [scholarshipName, setScholarshipName] = useState("");
  const [signerName, setSignerName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [letter, setLetter] = useState("");
  const [error, setError] = useState(null);
  const selected = selectedIdx >= 0 && selectedIdx < savedReviews.length ? savedReviews[selectedIdx] : null;

  async function generate() {
    if (!apiKey) return setError("Add an API key in Settings first.");
    if (!selected) return setError("Select a reviewed application first.");
    setGenerating(true); setError(null); setLetter("");

    const scoresText = selected.scores?.map((s) => `- ${s.criterion}: ${s.points}/${s.maxPoints} — ${s.reasoning}`).join("\n") || "";
    const decisionText = { awarded: "The applicant is being AWARDED the scholarship.", waitlist: "The applicant is being placed on the WAITLIST.", declined: "The applicant is NOT being selected for the scholarship." }[decision];
    const toneText = { warm: "warm and personal, while professional", neutral: "neutral and clear, professional", formal: "formal and institutional" }[tone];

    const system = `You draft letters from scholarship review committees to applicants.

Write a letter that is ${toneText}. Keep it to 3-4 short paragraphs. Do NOT include numeric scores in the letter. Reference specific strengths (and, where appropriate, growth areas) drawn from the review, so it doesn't feel generic.

If the decision is "declined", be respectful — acknowledge effort, name genuine strengths, note that many strong applicants weren't selected, and encourage. Never be dismissive.
If "waitlist", be honest about what waitlist means and next steps.
If "awarded", be genuinely congratulatory.

Sign the letter with the signer name provided. Include a subject line at the top formatted as: SUBJECT: <line>

Respond with the subject line followed by the letter body. No preamble.`;

    const userMsg = `Scholarship: ${scholarshipName || "[Scholarship name]"}
Signer: ${signerName || "The Review Committee"}
Decision: ${decisionText}

Applicant name: ${selected.applicant?.name || selected.label}
Applicant summary: ${selected.applicant?.summary || ""}

Review scores:
${scoresText}

Overall reviewer impression: ${selected.overallImpression || ""}

Key facts from the application:
${(selected.keyFacts || []).map((f) => `- ${f}`).join("\n")}`;

    try {
      const text = await callClaude(apiKey, model, system, userMsg, 1500);
      setLetter(text.trim());
    } catch (err) { setError(err.message); }
    finally { setGenerating(false); }
  }

  const decisions = [
    { id: "awarded", label: "Awarded", color: good },
    { id: "waitlist", label: "Waitlist", color: bronze },
    { id: "declined", label: "Not selected", color: bad },
  ];
  const tones = [{ id: "warm", label: "Warm" }, { id: "neutral", label: "Neutral" }, { id: "formal", label: "Formal" }];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Tool IV" title="Feedback" desc="Draft the letter that goes to the applicant."/>
      {!apiKey && <div style={{ marginTop: 24 }}><KeyBanner onNav={onNav}/></div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 40, marginTop: 40 }}>
        <section>
          <SectionLabel n="01" title="Setup"/>
          <SubHeading>Reviewed application</SubHeading>
          {savedReviews.length === 0 ? (
            <div style={{ border: `1px dashed ${rule}`, padding: 20, borderRadius: 2, color: muted, fontSize: 14, marginBottom: 20 }}>
              No reviews yet this session. Head to <strong style={{ color: ink }}>Review</strong> or <strong style={{ color: ink }}>Compare</strong> first — the results will show up here.
            </div>
          ) : (
            <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2, marginBottom: 20, maxHeight: 200, overflowY: "auto" }}>
              {savedReviews.map((r, i) => (
                <button key={i} onClick={() => setSelectedIdx(i)} style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "12px 16px", background: selectedIdx === i ? paperDeep : "transparent",
                  border: "none", borderTop: i === 0 ? "none" : `1px solid ${rule}`,
                  cursor: "pointer", fontFamily: "'Inter', sans-serif",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: ink }}>{r.label}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: bronze }}>{r.totalPoints}/{r.totalMax}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <SubHeading>Scholarship & signer</SubHeading>
          <input value={scholarshipName} onChange={(e) => setScholarshipName(e.target.value)}
            placeholder="Scholarship name (e.g. 'Calm Street Bursary 2026')"
            style={{ ...editInput, marginBottom: 8, background: "#fff" }}/>
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)}
            placeholder="Signer (e.g. 'Virgo, Review Committee')"
            style={{ ...editInput, background: "#fff", marginBottom: 24 }}/>

          <SubHeading>Decision</SubHeading>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            {decisions.map((d) => (
              <button key={d.id} onClick={() => setDecision(d.id)} style={{
                background: decision === d.id ? d.color : "transparent",
                color: decision === d.id ? paper : d.color,
                border: `1px solid ${d.color}`, padding: "8px 14px",
                fontFamily: "'Inter', sans-serif", fontSize: 13,
                cursor: "pointer", borderRadius: 2,
              }}>{d.label}</button>
            ))}
          </div>

          <SubHeading>Tone</SubHeading>
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            {tones.map((t) => (
              <button key={t.id} onClick={() => setTone(t.id)} style={{
                background: tone === t.id ? ink : "transparent",
                color: tone === t.id ? paper : inkSoft,
                border: `1px solid ${tone === t.id ? ink : rule}`,
                padding: "8px 14px", fontFamily: "'Inter', sans-serif", fontSize: 13,
                cursor: "pointer", borderRadius: 2,
              }}>{t.label}</button>
            ))}
          </div>

          <button onClick={generate} disabled={generating || !selected || !apiKey} style={primaryBtn(generating || !selected || !apiKey)}>
            {generating ? "Drafting…" : "Draft the letter"}
          </button>
          {error && <div style={{ color: warn, fontSize: 13, marginTop: 12 }}>{error}</div>}
        </section>

        <section>
          <SectionLabel n="02" title="The Letter" action={
            letter && <button onClick={() => navigator.clipboard.writeText(letter)} style={ghostBtn}>Copy</button>
          }/>
          {!letter && !generating && (
            <div style={{ border: `1px dashed ${rule}`, padding: "60px 24px", textAlign: "center", color: muted, borderRadius: 2 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: inkSoft, marginBottom: 8 }}>No letter yet</div>
              Pick a review, choose a decision and tone, then draft.
            </div>
          )}
          {generating && (
            <div style={{ border: `1px solid ${rule}`, padding: "60px 24px", textAlign: "center", background: "#fff" }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 20, color: ink }}>Composing…</div>
            </div>
          )}
          {letter && (
            <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: "32px 36px", borderRadius: 2, whiteSpace: "pre-wrap", fontFamily: "'Fraunces', serif", fontSize: 16, lineHeight: 1.7, color: ink }}>
              {letter}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ============ SETTINGS ============
function Settings({ apiKey, setApiKey, orgName, setOrgName, model, setModel }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState(null);

  async function signIn() {
    setError("");
    if (!code.trim() || !password) { setError("Enter your organization's access code and password."); return; }
    setSigningIn(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
      setApiKey(data.token);
      setOrgName(data.org || code.trim());
      setUsage({ used: data.used, limit: data.monthlyLimit });
      setPassword("");
    } catch (e) {
      setError(e.message || "Could not sign in. Check the access code and password, or try again shortly.");
    } finally {
      setSigningIn(false);
    }
  }
  function signOut() {
    if (window.confirm("Sign out of Marksmith on this browser?")) {
      setApiKey(""); setOrgName("");
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Settings" title="Sign in" desc="Marksmith runs on the Claude API through your organization's account. Sign in with the access code and password your administrator gave you."/>

      <div style={{ marginTop: 40 }}>
        <SubHeading>Organization access</SubHeading>
        {apiKey ? (
          <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 20, borderRadius: 2 }}>
            <div style={{ fontSize: 14, color: inkSoft }}>Signed in as <strong style={{ color: ink }}>{orgName || "your organization"}</strong>.</div>
            {usage && <div style={{ marginTop: 8, fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace" }}>Usage this month: {usage.used}{usage.limit ? ` / ${usage.limit}` : ""}</div>}
            <div style={{ marginTop: 16 }}>
              <button onClick={signOut} style={{ ...ghostBtn, color: warn }}>Sign out</button>
            </div>
          </div>
        ) : (
          <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 20, borderRadius: 2 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code"
                style={{ ...editInput, background: paper, fontSize: 14 }}/>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
                onKeyDown={(e) => e.key === "Enter" && signIn()}
                style={{ ...editInput, background: paper, fontSize: 14 }}/>
            </div>
            {error && <div style={{ marginTop: 10, fontSize: 13, color: bad }}>{error}</div>}
            <div style={{ marginTop: 16 }}>
              <button onClick={signIn} disabled={signingIn} style={primaryBtn(signingIn)}>{signingIn ? "Signing in…" : "Sign in"}</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, padding: 16, background: paperDeep, borderLeft: `3px solid ${bronze}`, borderRadius: 2, fontSize: 13, color: inkSoft, lineHeight: 1.6 }}>
          <strong style={{ color: ink }}>Don't have an access code?</strong> Contact the person who set up Marksmith for your organization — they issue codes and can set usage limits per organization.
        </div>
      </div>

      <div style={{ marginTop: 48 }}>
        <SubHeading>Model</SubHeading>
        <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2 }}>
          {MODELS.map((m, i) => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderTop: i === 0 ? "none" : `1px solid ${rule}`, cursor: "pointer" }}>
              <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={(e) => setModel(e.target.value)}/>
              <div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16 }}>{m.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: muted, letterSpacing: "0.06em", marginTop: 2 }}>{m.id}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ ABOUT ============
function About() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "60px 32px 80px" }}>
      <PageHeader eyebrow="About" title="How Marksmith works" desc=""/>
      <div style={{ marginTop: 40, fontFamily: "'Fraunces', serif", fontSize: 20, lineHeight: 1.55, color: ink }}>
        <p>Marksmith is a reviewer's desk for scholarship applications. It reads what you paste or upload, extracts the facts, raises the questions a careful reviewer would raise, and scores every section against a rubric that <em>you</em> shape.</p>
      </div>
      <div style={{ marginTop: 40, display: "grid", gap: 32 }}>
        <AboutStep n="I" title="Start with a rubric" body="Load one of the four presets — Standard, Need-based, Merit-only, Leadership — or write your own criteria. Every criterion gets a name, a description, and a maximum point value."/>
        <AboutStep n="II" title="Review one, or compare many" body="Use the Review tool for a single application. Use Compare to score several against the same rubric and see them ranked, with a mini-scorecard for each. Both tools accept pasted text or a PDF upload."/>
        <AboutStep n="III" title="Read the scorecard honestly" body="Missing evidence scores low and turns into a question — that's the point. If an application is thin, you'll see it."/>
        <AboutStep n="IV" title="Draft the reply" body="When you're ready to write to the applicant, Feedback pulls the review you did and drafts a letter — award, waitlist, or decline — in the tone you pick. Scores stay off the letter."/>
      </div>
      <div style={{ marginTop: 48, padding: 24, background: paperDeep, borderLeft: `3px solid ${bronze}`, borderRadius: 2, fontSize: 14, color: inkSoft, lineHeight: 1.7 }}>
        <strong style={{ color: ink }}>Note.</strong> Marksmith is a first-pass reader. It doesn't replace a human review; it gets the boring parts out of the way. Reviews live in the current window only. Your sign-in session is stored locally in this browser.
      </div>
    </div>
  );
}
function AboutStep({ n, title, body }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 20 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 40, color: bronze, lineHeight: 1, fontWeight: 500 }}>{n}</div>
      <div>
        <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 22, margin: 0, color: ink, fontWeight: 500 }}>{title}</h3>
        <p style={{ fontSize: 15, color: muted, lineHeight: 1.65, marginTop: 8, marginBottom: 0 }}>{body}</p>
      </div>
    </div>
  );
}

// ============ PAGE HEADER ============
function PageHeader({ eyebrow, title, desc }) {
  return (
    <div style={{ borderBottom: `1px solid ${rule}`, paddingBottom: 24 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.16em", color: bronze, textTransform: "uppercase" }}>{eyebrow}</div>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 52, fontWeight: 500, margin: "8px 0 0", letterSpacing: "-0.02em", color: ink, lineHeight: 1 }}>{title}</h1>
      {desc && <p style={{ fontSize: 15, color: muted, marginTop: 12, marginBottom: 0, maxWidth: 600 }}>{desc}</p>}
    </div>
  );
}

// ============ FOOTER ============
function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${rule}`, marginTop: 40, padding: "24px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Logo size={20}/>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 14, color: inkSoft }}>Marksmith</span>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          The reviewer's desk · v1
        </div>
      </div>
    </footer>
  );
}

// ============ APP ============
export default function App() {
  const [page, setPage] = useState("home");
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC);
  const [savedReviews, setSavedReviews] = useState([]);
  const [apiKey, setApiKeyState] = useState(loadApiKey());
  const [orgName, setOrgNameState] = useState(loadOrgName());
  const [model, setModelState] = useState(loadModel());

  function setApiKey(v) { setApiKeyState(v); saveApiKey(v); }
  function setOrgName(v) { setOrgNameState(v); saveOrgName(v); }
  function setModel(v) { setModelState(v); saveModel(v); }
  function handleSaveReview(r) { setSavedReviews((all) => [...all, r]); }

  const hasKey = !!apiKey;

  return (
    <div style={{ background: paper, minHeight: "100vh", color: ink, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{fontsCSS}</style>
      <Nav current={page} onNav={setPage} hasKey={hasKey}/>
      {page === "home" && <Home onNav={setPage} reviewCount={savedReviews.length} rubric={rubric} hasKey={hasKey}/>}
      {page === "review" && <ReviewTool apiKey={apiKey} model={model} rubric={rubric} onSaveReview={handleSaveReview} onNav={setPage}/>}
      {page === "compare" && <CompareTool apiKey={apiKey} model={model} rubric={rubric} onSaveReview={handleSaveReview} onNav={setPage}/>}
      {page === "rubric" && <RubricBuilder rubric={rubric} setRubric={setRubric}/>}
      {page === "feedback" && <FeedbackComposer apiKey={apiKey} model={model} savedReviews={savedReviews} onNav={setPage}/>}
      {page === "settings" && <Settings apiKey={apiKey} setApiKey={setApiKey} orgName={orgName} setOrgName={setOrgName} model={model} setModel={setModel}/>}
      {page === "about" && <About/>}
      <Footer/>
    </div>
  );
}
