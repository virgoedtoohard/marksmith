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

// ============ ROUTING ============
// Every page has a real URL (#home, #review, #compare, …) so nav links are
// genuine <a href> tags: normal click navigates in place, and ctrl/cmd-click,
// middle-click, or "open in new tab" all work the way a browser expects.
const PAGE_IDS = ["home", "review", "compare", "rubric", "feedback", "records", "about", "settings"];
function pageFromHash() {
  if (typeof window === "undefined") return "home";
  const h = window.location.hash.replace(/^#\/?/, "");
  return PAGE_IDS.includes(h) ? h : "home";
}

// ============ BACKEND (Cloudflare Worker) ============
// Fill this in after you deploy the worker/ folder — see worker/README or
// the deployment instructions you were given. Example:
// "https://marksmith-proxy.yourname.workers.dev"
const WORKER_URL = "https://marksmith-proxy.virgoedtoohard.workers.dev";

// ============ SETTINGS STORAGE ============
const STORAGE_KEY = "marksmith:apiKey"; // now holds a signed session token, not a raw Anthropic key
const ORG_KEY = "marksmith:org";
// The model is fixed by the site, not chosen by organizations — update this
// constant when a better default becomes available. Everything in the app
// calls Claude through this single value.
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

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
const RUBRIC_KEY = "marksmith:rubric";
function loadRubric() {
  try {
    const raw = localStorage.getItem(RUBRIC_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RUBRIC;
  } catch { return DEFAULT_RUBRIC; }
}
function saveRubric(v) {
  try { localStorage.setItem(RUBRIC_KEY, JSON.stringify(v)); } catch {}
}

// ============ RECORDS STORAGE ============
// Every scored application (from Review or Compare) is kept here — score,
// status, and the original application — so it survives closing the tab.
const RECORDS_KEY = "marksmith:records";
function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
// Drops the original file (keeping every score, status, letter, and the
// pasted-text copy when there is one) from all but the most recent records —
// used when a records payload is too big for local storage or for the sync
// request to the Worker.
function stripOldFileBlocks(records, keepRecent = 20) {
  return records.map((r, i) =>
    i < records.length - keepRecent && r.application?.fileBlock
      ? { ...r, application: { ...r.application, fileBlock: null, note: "Original file no longer stored (space limit)." } }
      : r
  );
}
function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Likely storage quota exceeded (uploaded PDFs/photos add up fast as base64).
    // Retry once with older file attachments dropped, keeping scores/text intact.
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(stripOldFileBlocks(records)));
    } catch { /* give up silently — the review itself was already shown to the user */ }
  }
}
function newRecordId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ============ RECORDS SYNC (per organization, via the Worker) ============
// Records used to live only in whichever browser created them. Now every
// mutation pushes just the ONE record it touched to the Worker (which stores
// it under its own key, per organization) instead of replacing one shared
// blob for the whole org — so several reviewers signed in with the same
// access code at the same time can each add or update a different
// application without racing to overwrite each other's latest change.
// While signed in, the app also polls for records other reviewers added or
// changed, so everyone converges without needing to sign out and back in.
const MAX_RECORD_SYNC_BYTES = 20 * 1024 * 1024;
const RECORDS_POLL_MS = 20000;
async function fetchRemoteRecords(apiKey) {
  const res = await fetch(`${WORKER_URL}/api/records`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Could not load records from the server (${res.status})`);
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.records) ? data.records : [];
}
// If a single record (usually one with an attached PDF/photo) is too big to
// sync, drop just its file — the score, text, status, history, and letters
// still sync; the original file stays only on the browser that has it.
function shrinkRecordForSync(record) {
  try {
    if (new TextEncoder().encode(JSON.stringify(record)).length <= MAX_RECORD_SYNC_BYTES) return record;
  } catch { return record; }
  if (!record.application?.fileBlock) return record;
  return { ...record, application: { ...record.application, fileBlock: null, note: "Original file too large to sync — kept only on the browser that uploaded it." } };
}
async function pushRemoteRecord(apiKey, record) {
  try {
    await fetch(`${WORKER_URL}/api/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ record: shrinkRecordForSync(record) }),
    });
  } catch {
    // Offline or the Worker is unreachable — this browser's own copy (in
    // localStorage) is already saved regardless; the next poll or edit
    // retries the sync.
  }
}
async function deleteRemoteRecord(apiKey, id) {
  try {
    await fetch(`${WORKER_URL}/api/records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // best-effort, same as above.
  }
}
// Combines this browser's records with the organization's server copy,
// keeping whichever version of each record was edited most recently.
function mergeRecords(local, remote) {
  const byId = new Map();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const existing = byId.get(r.id);
    if (!existing) { byId.set(r.id, r); continue; }
    const existingTime = new Date(existing.updatedAt || existing.timestamp || 0).getTime();
    const incomingTime = new Date(r.updatedAt || r.timestamp || 0).getTime();
    if (incomingTime >= existingTime) byId.set(r.id, r);
  }
  return Array.from(byId.values());
}
function makeRecord({ parsed, label, application, rubricSnapshot, source }) {
  const now = new Date().toISOString();
  return {
    id: newRecordId(),
    ...parsed,
    label,
    application,
    rubricSnapshot,
    source,
    status: "pending",
    reviewerNote: "",
    timestamp: now,
    updatedAt: now,
    history: [],
    letters: [],
  };
}
const STATUS_OPTIONS = [
  { id: "pending", label: "Pending", color: muted },
  { id: "shortlisted", label: "Shortlisted", color: bronze },
  { id: "awarded", label: "Awarded", color: good },
  { id: "waitlisted", label: "Waitlisted", color: warn },
  { id: "declined", label: "Declined", color: bad },
];
function statusMeta(id) { return STATUS_OPTIONS.find((s) => s.id === id) || STATUS_OPTIONS[0]; }
const DECISION_LABELS = { awarded: "Awarded", waitlist: "Waitlist", declined: "Not selected" };
const TONE_LABELS = { warm: "Warm", neutral: "Neutral", formal: "Formal" };

// ============ RECORDS EXPORT (CSV + bulk application download) ============
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function exportRecordsCSV(records) {
  const headers = ["Label", "Status", "Score", "Max", "Percent", "Source", "Date", "Reviewer note"];
  const rows = records.map((r) => {
    const pct = r.totalMax > 0 ? Math.round(((r.totalPoints || 0) / r.totalMax) * 100) : "";
    return [
      r.label, statusMeta(r.status || "pending").label, r.totalPoints ?? "", r.totalMax ?? "", pct,
      r.source === "compare" ? "Compare" : "Review", new Date(r.timestamp).toLocaleString(), r.reviewerNote || "",
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `marksmith-records-${new Date().toISOString().slice(0, 10)}.csv`);
}
function safeFileName(s) {
  return (s || "application").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().slice(0, 60) || "application";
}
// Loaded on demand — not bundled — so a plain export/CSV site never pays for it.
let jszipPromise = null;
function loadJSZip() {
  if (!jszipPromise) {
    jszipPromise = import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then((m) => m.default || m);
  }
  return jszipPromise;
}
async function downloadApplicationsZip(records) {
  const withFiles = records.filter((r) => r.application && (r.application.fileBlock || r.application.text));
  if (withFiles.length === 0) throw new Error("None of these records have a stored application to download.");
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const usedNames = new Set();
  withFiles.forEach((r) => {
    const base = safeFileName(r.label);
    let name = base, n = 1;
    while (usedNames.has(name)) { name = `${base}-${++n}`; }
    usedNames.add(name);
    const { fileBlock, fileName, text } = r.application;
    if (fileBlock?.type === "document") {
      zip.file(`${name}.pdf`, fileBlock.source.data, { base64: true });
    } else if (fileBlock?.type === "image") {
      const ext = (fileBlock.source.media_type || "").split("/")[1]?.split("+")[0] || "jpg";
      zip.file(`${name}.${ext}`, fileBlock.source.data, { base64: true });
    } else if (text) {
      zip.file(`${name}.txt`, text);
    }
  });
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `marksmith-applications-${new Date().toISOString().slice(0, 10)}.zip`);
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

// ============ FILE HANDLING (PDF / photo / text) ============
function isPdfFile(file) { return file.type === "application/pdf"; }
function isImageFile(file) { return /^image\//.test(file.type); }

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsText(file);
  });
}

// Returns a Claude content block for PDFs/images, or null for anything else
// (caller should fall back to readFileAsText for plain text/markdown files).
async function fileToContentBlock(file) {
  if (isPdfFile(file)) {
    const b64 = await fileToBase64(file);
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
  }
  if (isImageFile(file)) {
    const b64 = await fileToBase64(file);
    return { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: b64 } };
  }
  return null;
}

const FILE_ACCEPT = "application/pdf,image/*,text/plain,text/markdown,.txt,.md";

// Shared: turn Claude's rubric JSON into the {id, name, description, maxPoints} shape.
function parseRubricCriteria(raw, notFoundMessage) {
  const parsed = JSON.parse(cleanJSON(raw));
  const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  if (criteria.length === 0) throw new Error(notFoundMessage);
  return criteria.map((c, i) => ({
    id: i + 1,
    name: c.name || `Criterion ${i + 1}`,
    description: c.description || "",
    maxPoints: Number(c.maxPoints) || 0,
  }));
}

// Reads a rubric document (PDF, photo, or text) and asks Claude to turn it
// into structured criteria the rest of the tool can score against.
async function extractRubricFromFile(file, apiKey) {
  const instruction = "This file contains a scoring rubric used to review applications (e.g. for a scholarship or grant). Read it carefully and convert it into structured scoring criteria.";
  const system = `You convert rubric documents into structured JSON for a review tool.

Rules:
- Use the exact or closest criterion names from the source document.
- Write a one-sentence description of what each criterion measures, based on the source.
- If the source gives explicit point values per criterion, use those exactly.
- If it doesn't give explicit points, assign sensible maxPoints per criterion so the total sums to 100, weighted by how much emphasis the source gives each one.
- Do not invent criteria that aren't in the source. Do not merge unrelated criteria together.

Respond with ONLY valid JSON, no markdown, no preamble:
{ "criteria": [{ "name": "string", "description": "string", "maxPoints": number }] }`;

  const block = await fileToContentBlock(file);
  const userContent = block
    ? [block, { type: "text", text: instruction }]
    : `${instruction}\n\nRUBRIC DOCUMENT:\n\n${await readFileAsText(file)}`;

  const raw = await callClaude(apiKey, DEFAULT_MODEL, system, userContent, 1500);
  return parseRubricCriteria(raw, "Could not find any scoring criteria in that file.");
}

// Turns a plain-language description into the same structured rubric shape,
// for reviewers who'd rather describe what they want than upload a document.
async function generateRubricFromDescription(description, apiKey) {
  const system = `You create structured scoring rubrics for a review tool, based on a plain-language description from the person building it.

Rules:
- Turn the description into distinct, non-overlapping scoring criteria.
- Write a one-sentence description of what each criterion measures.
- If the description gives explicit weights or point values, use those.
- If it doesn't, assign sensible maxPoints per criterion so the total sums to 100, weighted by how much emphasis the description gives each one.
- Produce between 2 and 8 criteria. Do not invent criteria unrelated to the description.

Respond with ONLY valid JSON, no markdown, no preamble:
{ "criteria": [{ "name": "string", "description": "string", "maxPoints": number }] }`;

  const raw = await callClaude(apiKey, DEFAULT_MODEL, system, `Build a rubric from this description:\n\n${description}`, 1200);
  return parseRubricCriteria(raw, "Could not turn that description into criteria — try adding a bit more detail.");
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
    { id: "records", label: "Records" },
    { id: "about", label: "About" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <header style={{ borderBottom: `1px solid ${rule}`, background: paper, position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <a href="#home" style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", textDecoration: "none", cursor: "pointer", padding: 0 }}>
          <Logo size={32}/>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 500, color: ink, letterSpacing: "-0.01em" }}>Marksmith</span>
        </a>
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          {items.map((it) => {
            const active = current === it.id;
            const isSettings = it.id === "settings";
            return (
              <a key={it.id} href={`#${it.id}`} style={{
                background: active ? paperDeep : "transparent",
                color: active ? ink : inkSoft,
                textDecoration: "none", padding: "8px 14px", cursor: "pointer",
                fontFamily: "'Inter', sans-serif", fontSize: 13,
                fontWeight: active ? 600 : 400, borderRadius: 2,
                borderBottom: active ? `1.5px solid ${bronze}` : "1.5px solid transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {it.label}
                {isSettings && !hasKey && <span title="Not signed in" style={{ width: 6, height: 6, borderRadius: "50%", background: warn, display: "inline-block" }}/>}
              </a>
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
            <Stat n={reviewCount} label="Reviews recorded"/>
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
function ReviewTool({ apiKey, rubric, onSaveReview, onNav }) {
  const [applicationText, setApplicationText] = useState("");
  const [fileBlock, setFileBlock] = useState(null);
  const [fileName, setFileName] = useState("");
  const [applicantLabel, setApplicantLabel] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const totalMax = useMemo(() => rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0), [rubric]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const block = await fileToContentBlock(file);
      if (!block) return setError("That file type isn't a PDF or photo — paste the text instead.");
      setFileBlock(block); setFileName(file.name); setApplicationText(""); setError(null);
    } catch (err) { setError(err.message); }
  }

  async function analyze() {
    if (!apiKey) return setError("You're not signed in. Open Settings first.");
    if (!fileBlock && !applicationText.trim()) return setError("Paste an application, or upload a PDF/photo, first.");
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

    const userContent = fileBlock
      ? [fileBlock, { type: "text", text: "Please review this scholarship application against the rubric." }]
      : `Please review this scholarship application against the rubric:\n\n${applicationText}`;

    try {
      const text = await callClaude(apiKey, DEFAULT_MODEL, system, userContent, 2000);
      const parsed = JSON.parse(cleanJSON(text));
      const record = makeRecord({
        parsed,
        label: applicantLabel || parsed.applicant?.name || "Untitled review",
        application: { text: applicationText, fileBlock, fileName },
        rubricSnapshot: rubric,
        source: "review",
      });
      setResult(record);
      onSaveReview(record);
    } catch (err) { setError(err.message || "Something went wrong. Try again."); }
    finally { setAnalyzing(false); }
  }

  function reset() {
    setResult(null); setError(null); setApplicationText("");
    setFileBlock(null); setFileName(""); setApplicantLabel("");
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
            {fileBlock ? (
              <div style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>{fileBlock.type === "document" ? "PDF loaded" : "Photo loaded"}</div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, marginTop: 4 }}>{fileName}</div>
                </div>
                <button onClick={() => { setFileBlock(null); setFileName(""); }} style={ghostBtn}>Remove</button>
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
                <input type="file" accept={FILE_ACCEPT} onChange={handleFile} style={{ display: "none" }}/>
                <span style={{ borderBottom: `1px solid ${bronze}`, color: bronze, fontWeight: 500 }}>Upload PDF or photo instead</span>
              </label>
              <span style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace" }}>
                {fileBlock ? (fileBlock.type === "document" ? "PDF" : "Photo") : `${applicationText.length} chars`}
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
function CompareTool({ apiKey, rubric, onSaveReview, onNav }) {
  const [applicants, setApplicants] = useState([{ id: 1, label: "", text: "", fileBlock: null, fileName: "" }]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const [rubricMode, setRubricMode] = useState("site"); // "site" | "custom"
  const [customRubric, setCustomRubric] = useState([]);
  const [customRubricFileName, setCustomRubricFileName] = useState("");
  const [customRubricLoading, setCustomRubricLoading] = useState(false);
  const [customRubricError, setCustomRubricError] = useState(null);

  const activeRubric = rubricMode === "custom" && customRubric.length > 0 ? customRubric : rubric;
  const totalMax = useMemo(() => activeRubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0), [activeRubric]);

  function addApplicant() { setApplicants((a) => [...a, { id: Math.max(0, ...a.map((x) => x.id)) + 1, label: "", text: "", fileBlock: null, fileName: "" }]); }
  function removeApplicant(id) { setApplicants((a) => a.filter((x) => x.id !== id)); }
  function updateApplicant(id, patch) { setApplicants((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x))); }

  async function handleApplicantFile(id, file) {
    try {
      const block = await fileToContentBlock(file);
      if (block) updateApplicant(id, { fileBlock: block, fileName: file.name, text: "" });
      else updateApplicant(id, { text: await readFileAsText(file), fileBlock: null, fileName: file.name });
    } catch (err) {
      setError(err.message || "Could not read that file.");
    }
  }

  async function handleBulkFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    let nextId = Math.max(0, ...applicants.map((x) => x.id)) + 1;
    const newOnes = [];
    for (const file of files) {
      const entry = { id: nextId++, label: file.name.replace(/\.[^.]+$/, ""), text: "", fileBlock: null, fileName: file.name };
      try {
        const block = await fileToContentBlock(file);
        if (block) entry.fileBlock = block;
        else entry.text = await readFileAsText(file);
      } catch { /* leave entry empty; user can fix it inline */ }
      newOnes.push(entry);
    }
    setApplicants((a) => {
      const isBlank = a.length === 1 && !a[0].text && !a[0].fileBlock && !a[0].label;
      return [...(isBlank ? [] : a), ...newOnes];
    });
  }

  async function handleCustomRubricFile(file) {
    if (!apiKey) return setCustomRubricError("You're not signed in. Open Settings first.");
    setCustomRubricLoading(true); setCustomRubricError(null);
    try {
      const criteria = await extractRubricFromFile(file, apiKey);
      setCustomRubric(criteria);
      setCustomRubricFileName(file.name);
    } catch (err) {
      setCustomRubricError(err.message || "Could not read that rubric file.");
    } finally {
      setCustomRubricLoading(false);
    }
  }

  async function runAll() {
    if (!apiKey) return setError("You're not signed in. Open Settings first.");
    const valid = applicants.filter((a) => a.fileBlock || a.text.trim().length > 30);
    if (valid.length < 2) return setError("Add at least two applications — paste 30+ characters, or upload a file, for each.");
    if (activeRubric.length === 0) return setError(rubricMode === "custom" ? "Upload a custom rubric first." : "Add criteria in the Rubric tool first.");
    setRunning(true); setError(null); setResults([]); setProgress(0);

    const rubricText = activeRubric.map((c) => `- "${c.name}" (max ${c.maxPoints} pts): ${c.description}`).join("\n");
    const system = `You are an experienced scholarship reviewer. Score this application against the rubric.

RUBRIC:
${rubricText}
Total possible: ${totalMax} points.

Rules:
- Score based only on evidence. Missing evidence = low score.
- Be honest and objective — apply the same standard to every application so rankings are comparable.

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
        const userContent = a.fileBlock
          ? [a.fileBlock, { type: "text", text: "Please review this scholarship application:" }]
          : `Please review this scholarship application:\n\n${a.text}`;
        const text = await callClaude(apiKey, DEFAULT_MODEL, system, userContent, 2000);
        const parsed = JSON.parse(cleanJSON(text));
        const record = makeRecord({
          parsed,
          label: a.label || parsed.applicant?.name || `Applicant ${i + 1}`,
          application: { text: a.text, fileBlock: a.fileBlock, fileName: a.fileName },
          rubricSnapshot: activeRubric,
          source: "compare",
        });
        out.push(record);
        onSaveReview(record);
      } catch (err) {
        out.push({ label: a.label || `Applicant ${i + 1}`, error: err.message, totalPoints: 0, totalMax });
      }
      setProgress(i + 1);
      setResults([...out]);
    }
    setRunning(false);
  }

  const ranked = [...results].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  const validCount = applicants.filter((a) => a.fileBlock || a.text.trim().length > 30).length;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Tool II" title="Compare" desc="Score multiple applications. See them ranked side by side."/>
      {!apiKey && <div style={{ marginTop: 24 }}><KeyBanner onNav={onNav}/></div>}

      <div style={{ marginTop: 40 }}>
        <SectionLabel n="01" title="Rubric"/>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setRubricMode("site")} style={{ ...ghostBtn, background: rubricMode === "site" ? paperDeep : "transparent", fontWeight: rubricMode === "site" ? 600 : 400 }}>Site rubric</button>
          <button onClick={() => setRubricMode("custom")} style={{ ...ghostBtn, background: rubricMode === "custom" ? paperDeep : "transparent", fontWeight: rubricMode === "custom" ? 600 : 400 }}>Custom rubric for this batch</button>
        </div>
        {rubricMode === "site" ? (
          <div style={{ fontSize: 13, color: muted }}>{rubric.length} criteria · {rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0)} pts — from the Rubric tool.</div>
        ) : (
          <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 20, borderRadius: 2 }}>
            <p style={{ fontSize: 13, color: inkSoft, margin: "0 0 14px", lineHeight: 1.6 }}>
              Upload a rubric just for this batch — a PDF, a photo, or a text file. It won't change the site's default rubric.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ ...ghostBtn, display: "inline-block", cursor: apiKey && !customRubricLoading ? "pointer" : "not-allowed", opacity: apiKey && !customRubricLoading ? 1 : 0.5 }}>
                <input type="file" accept={FILE_ACCEPT} disabled={!apiKey || customRubricLoading}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleCustomRubricFile(f); }}
                  style={{ display: "none" }}/>
                {customRubricLoading ? "Reading…" : customRubric.length ? "Replace rubric file" : "Choose a rubric file"}
              </label>
              {customRubricFileName && !customRubricLoading && <span style={{ fontSize: 13, color: muted }}>{customRubricFileName}</span>}
              {customRubricError && <span style={{ color: warn, fontSize: 13 }}>{customRubricError}</span>}
            </div>
            {customRubric.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${rule}` }}>
                <div style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {customRubric.length} criteria parsed · {totalMax} pts
                </div>
                {customRubric.map((c) => (
                  <div key={c.id} style={{ fontSize: 13, color: inkSoft, padding: "4px 0" }}>
                    <strong style={{ color: ink }}>{c.name}</strong> — {c.description} <span style={{ color: bronze }}>({c.maxPoints} pts)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 48 }}>
        <SectionLabel n="02" title="Applications" action={
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ ...ghostBtn, display: "inline-block", cursor: "pointer" }}>
              <input type="file" multiple accept={FILE_ACCEPT}
                onChange={(e) => { handleBulkFiles(e.target.files); e.target.value = ""; }}
                style={{ display: "none" }}/>
              Upload multiple files
            </label>
            <button onClick={addApplicant} style={ghostBtn}>+ Add applicant</button>
          </div>
        }/>
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
              {a.fileBlock ? (
                <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, color: inkSoft }}>{a.fileBlock.type === "document" ? "PDF" : "Photo"} loaded: {a.fileName}</div>
                  <button onClick={() => updateApplicant(a.id, { fileBlock: null, fileName: "" })} style={ghostBtn}>Remove file</button>
                </div>
              ) : (
                <textarea value={a.text} onChange={(e) => updateApplicant(a.id, { text: e.target.value })}
                  placeholder="Paste this applicant's essay or full application…"
                  style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none",
                    padding: 16, minHeight: 140, resize: "vertical", background: "transparent",
                    fontFamily: "'Inter', sans-serif", fontSize: 14, color: ink, lineHeight: 1.6 }}/>
              )}
              <div style={{ borderTop: `1px solid ${rule}`, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: paperDeep }}>
                <label style={{ cursor: "pointer", fontSize: 13, color: inkSoft }}>
                  <input type="file" accept={FILE_ACCEPT}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleApplicantFile(a.id, f); }}
                    style={{ display: "none" }}/>
                  <span style={{ borderBottom: `1px solid ${bronze}`, color: bronze, fontWeight: 500 }}>{a.fileBlock ? "Replace file" : "Upload file instead"}</span>
                </label>
                <span style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace" }}>
                  {a.fileBlock ? (a.fileBlock.type === "document" ? "PDF" : "Photo") : `${a.text.length} chars`}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={runAll} disabled={running || !apiKey} style={primaryBtn(running || !apiKey)}>
            {running ? `Reading… ${progress} / ${validCount}` : "Score all"}
          </button>
          {error && <span style={{ color: warn, fontSize: 13 }}>{error}</span>}
          <span style={{ fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto" }}>
            Rubric: {activeRubric.length} criteria · {totalMax} pts {rubricMode === "custom" ? "(custom)" : ""}
          </span>
        </div>
      </div>

      {results.length > 0 && (
        <div style={{ marginTop: 60 }}>
          <SectionLabel n="03" title="Leaderboard"/>
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
function RubricBuilder({ rubric, setRubric, apiKey, onNav }) {
  const totalMax = useMemo(() => rubric.reduce((s, c) => s + Number(c.maxPoints || 0), 0), [rubric]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [description, setDescription] = useState("");
  const [describing, setDescribing] = useState(false);
  const [describeError, setDescribeError] = useState(null);

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
  async function handleImportFile(file) {
    if (!apiKey) { setImportError("You're not signed in. Open Settings first."); return; }
    setImporting(true); setImportError(null);
    try {
      const criteria = await extractRubricFromFile(file, apiKey);
      if (window.confirm(`Replace the current rubric with ${criteria.length} criteria parsed from "${file.name}"?`)) {
        setRubric(criteria);
      }
    } catch (err) {
      setImportError(err.message || "Could not read that file.");
    } finally {
      setImporting(false);
    }
  }
  async function handleDescribe() {
    if (!apiKey) { setDescribeError("You're not signed in. Open Settings first."); return; }
    if (!description.trim()) { setDescribeError("Describe what you'd like the rubric to score first."); return; }
    setDescribing(true); setDescribeError(null);
    try {
      const criteria = await generateRubricFromDescription(description.trim(), apiKey);
      if (window.confirm(`Replace the current rubric with ${criteria.length} criteria generated from your description?`)) {
        setRubric(criteria);
      }
    } catch (err) {
      setDescribeError(err.message || "Could not generate a rubric from that description.");
    } finally {
      setDescribing(false);
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
        <SectionLabel n="02" title="Import from a file" action={<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: muted, letterSpacing: "0.1em" }}>PDF, photo, or text</span>}/>
        {!apiKey && <div style={{ marginBottom: 16 }}><KeyBanner onNav={onNav}/></div>}
        <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 20, borderRadius: 2 }}>
          <p style={{ fontSize: 13, color: inkSoft, margin: "0 0 14px", lineHeight: 1.6 }}>
            Have a rubric document from your organization? Upload it — a PDF, a photo of a printed page, or a plain text file — and it'll be read and converted into criteria below, replacing the current rubric.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ ...ghostBtn, display: "inline-block", cursor: apiKey && !importing ? "pointer" : "not-allowed", opacity: apiKey && !importing ? 1 : 0.5 }}>
              <input type="file" accept={FILE_ACCEPT} disabled={!apiKey || importing}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleImportFile(f); }}
                style={{ display: "none" }}/>
              {importing ? "Reading…" : "Choose a rubric file"}
            </label>
            {importError && <span style={{ color: warn, fontSize: 13 }}>{importError}</span>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 48 }}>
        <SectionLabel n="03" title="Describe it" action={<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: muted, letterSpacing: "0.1em" }}>Plain language</span>}/>
        {!apiKey && <div style={{ marginBottom: 16 }}><KeyBanner onNav={onNav}/></div>}
        <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 20, borderRadius: 2 }}>
          <p style={{ fontSize: 13, color: inkSoft, margin: "0 0 14px", lineHeight: 1.6 }}>
            Not ready to build criteria by hand? Describe what you want the rubric to reward — in your own words — and it'll be turned into scored criteria below, replacing the current rubric.
          </p>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Weight financial need heavily, give real credit for community service, and a smaller amount for grades — this is a need-based scholarship, not a merit one."
            disabled={describing}
            style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${rule}`, outline: "none",
              padding: 14, minHeight: 90, resize: "vertical", background: paperDeep,
              fontFamily: "'Inter', sans-serif", fontSize: 14, color: ink, lineHeight: 1.6, borderRadius: 2 }}/>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <button onClick={handleDescribe} disabled={!apiKey || describing} style={{ ...ghostBtn, cursor: apiKey && !describing ? "pointer" : "not-allowed", opacity: apiKey && !describing ? 1 : 0.5 }}>
              {describing ? "Generating…" : "Generate rubric"}
            </button>
            {describeError && <span style={{ color: warn, fontSize: 13 }}>{describeError}</span>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 48 }}>
        <SectionLabel n="04" title="Current rubric" action={
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
          Changes are saved in this browser. Your rubric is used automatically by Review and Compare.
        </p>
      </div>
    </div>
  );
}

// ============ RECORDS ============
function ApplicationPreview({ application }) {
  if (!application) return <div style={{ fontSize: 13, color: muted }}>Not stored.</div>;
  const { text, fileBlock, fileName, note } = application;
  if (fileBlock?.type === "image") {
    return <img src={`data:${fileBlock.source.media_type};base64,${fileBlock.source.data}`} alt={fileName || "application photo"} style={{ maxWidth: "100%", border: `1px solid ${rule}`, borderRadius: 2, display: "block" }}/>;
  }
  if (fileBlock?.type === "document") {
    return (
      <div>
        <div style={{ fontSize: 13, color: inkSoft, marginBottom: 8 }}>{fileName}</div>
        <iframe title={fileName || "application PDF"} src={`data:application/pdf;base64,${fileBlock.source.data}`} style={{ width: "100%", height: 500, border: `1px solid ${rule}` }}/>
      </div>
    );
  }
  if (text) {
    return <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: inkSoft, maxHeight: 420, overflow: "auto", border: `1px solid ${rule}`, padding: 16, borderRadius: 2, background: paper }}>{text}</div>;
  }
  if (note) return <div style={{ fontSize: 13, color: muted, fontStyle: "italic" }}>{note}</div>;
  return <div style={{ fontSize: 13, color: muted }}>No original text or file was stored for this record.</div>;
}

function RecordCard({ record, open, onToggle, onUpdateStatus, onUpdateNote, onDelete }) {
  const pct = record.totalMax > 0 ? Math.round(((record.totalPoints || 0) / record.totalMax) * 100) : 0;
  const meta = statusMeta(record.status || "pending");
  return (
    <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2, marginBottom: 12 }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", cursor: "pointer" }} onClick={onToggle}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: ink }}>{record.label}</div>
          <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
            {new Date(record.timestamp).toLocaleString()} · via {record.source === "compare" ? "Compare" : "Review"}
          </div>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: ink, whiteSpace: "nowrap" }}>
          {record.totalPoints ?? 0}/{record.totalMax ?? 0} <span style={{ color: muted }}>({pct}%)</span>
        </div>
        <select value={record.status || "pending"} onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateStatus(record.id, e.target.value)}
          style={{ ...editInput, width: 150, color: meta.color, fontWeight: 600 }}>
          {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this record? This can't be undone.")) onDelete(record.id); }}
          style={{ ...ghostBtn, color: warn }}>Delete</button>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${rule}`, padding: 20 }}>
          <SubHeading>Original application</SubHeading>
          <ApplicationPreview application={record.application}/>
          <div style={{ marginTop: 24 }}>
            <ReviewOutput result={record}/>
          </div>
          <div style={{ marginTop: 24 }}>
            <SubHeading>Activity</SubHeading>
            {record.history && record.history.length > 0 ? (
              <div style={{ fontSize: 13, color: inkSoft, lineHeight: 1.8 }}>
                {record.history.slice().reverse().map((h, i) => (
                  <div key={i}>
                    Marked <strong style={{ color: statusMeta(h.status).color }}>{statusMeta(h.status).label}</strong> — {new Date(h.changedAt).toLocaleString()}{h.changedBy ? ` by ${h.changedBy}` : ""}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: muted }}>Still at its default status — no changes logged yet.</div>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <SubHeading>Letters sent</SubHeading>
            {record.letters && record.letters.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {record.letters.slice().reverse().map((l, i) => (
                  <div key={l.id || i} style={{ border: `1px solid ${rule}`, borderRadius: 2, padding: 16, background: paperDeep }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 11, color: muted, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                      <span>{DECISION_LABELS[l.decision] || l.decision} · {TONE_LABELS[l.tone] || l.tone}</span>
                      <span>{new Date(l.generatedAt).toLocaleString()}{l.generatedBy ? ` · by ${l.generatedBy}` : ""}</span>
                    </div>
                    {(l.scholarshipName || l.signerName) && (
                      <div style={{ fontSize: 12, color: inkSoft, marginBottom: 10 }}>
                        {l.scholarshipName}{l.scholarshipName && l.signerName ? " — " : ""}{l.signerName ? `Signed by ${l.signerName}` : ""}
                      </div>
                    )}
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: ink, fontFamily: "'Fraunces', serif" }}>{l.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: muted }}>No letters drafted for this application yet — use Feedback to write one.</div>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <SubHeading>Reviewer note</SubHeading>
            <textarea key={record.id} defaultValue={record.reviewerNote || ""} onBlur={(e) => onUpdateNote(record.id, e.target.value)}
              placeholder="Private notes for your committee — not shared with the applicant…"
              style={{ ...editInput, minHeight: 80, width: "100%", boxSizing: "border-box", resize: "vertical" }}/>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordsPage({ records, onUpdateStatus, onUpdateNote, onDelete, hasKey, onNav }) {
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState(null);
  const filtered = filter === "all" ? records : records.filter((r) => (r.status || "pending") === filter);
  const sorted = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  async function handleDownloadZip() {
    setZipping(true); setZipError(null);
    try {
      await downloadApplicationsZip(sorted);
    } catch (err) {
      setZipError(err.message || "Could not build the zip file.");
    } finally {
      setZipping(false);
    }
  }

  // Applicant essays, scores, and decisions are sensitive — never render them
  // once signed out, even though the browser still holds them locally.
  if (!hasKey) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px 80px" }}>
        <PageHeader eyebrow="Records" title="Application records" desc="Sign in to view the applications your organization has reviewed."/>
        <div style={{ marginTop: 32, border: `1px dashed ${rule}`, padding: "60px 24px", textAlign: "center", color: muted, borderRadius: 2 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: inkSoft, marginBottom: 8 }}>Signed out</div>
          Records are only visible while signed in.{" "}
          <button onClick={() => onNav("settings")} style={{ background: "none", border: "none", color: bronze, borderBottom: `1px solid ${bronze}`, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit" }}>
            Open Settings
          </button>{" "}
          to sign back in.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Records" title="Application records" desc="Every application you've reviewed, with its score and decision status — kept in this browser."/>

      <div style={{ marginTop: 32, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setFilter("all")} style={{ ...ghostBtn, background: filter === "all" ? paperDeep : "transparent", fontWeight: filter === "all" ? 600 : 400 }}>All ({records.length})</button>
          {STATUS_OPTIONS.map((s) => {
            const count = records.filter((r) => (r.status || "pending") === s.id).length;
            return (
              <button key={s.id} onClick={() => setFilter(s.id)} style={{ ...ghostBtn, background: filter === s.id ? paperDeep : "transparent", fontWeight: filter === s.id ? 600 : 400, color: s.color }}>
                {s.label} ({count})
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => exportRecordsCSV(sorted)} disabled={sorted.length === 0}
            style={{ ...ghostBtn, opacity: sorted.length ? 1 : 0.5, cursor: sorted.length ? "pointer" : "not-allowed" }}>
            Export CSV
          </button>
          <button onClick={handleDownloadZip} disabled={zipping || sorted.length === 0}
            style={{ ...ghostBtn, opacity: sorted.length && !zipping ? 1 : 0.5, cursor: sorted.length && !zipping ? "pointer" : "not-allowed" }}>
            {zipping ? "Zipping…" : "Download applications"}
          </button>
          {zipError && <span style={{ color: warn, fontSize: 13 }}>{zipError}</span>}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: muted }}>Both actions apply to the current filter ({sorted.length} record{sorted.length === 1 ? "" : "s"}).</div>

      <div style={{ marginTop: 24 }}>
        {sorted.length === 0 && (
          <div style={{ border: `1px dashed ${rule}`, padding: "60px 24px", textAlign: "center", color: muted, borderRadius: 2 }}>
            {records.length === 0
              ? "No records yet. Run a review from the Review or Compare tool — every scored application lands here automatically."
              : "No records match this filter."}
          </div>
        )}
        {sorted.map((r) => (
          <RecordCard key={r.id} record={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)}
            onUpdateStatus={onUpdateStatus} onUpdateNote={onUpdateNote} onDelete={onDelete}/>
        ))}
      </div>
    </div>
  );
}

// ============ TOOL IV: FEEDBACK ============
function FeedbackComposer({ apiKey, savedReviews, orgName, onSaveLetter, onNav }) {
  const [selectedIdx, setSelectedIdx] = useState(savedReviews.length > 0 ? 0 : -1);
  const [decision, setDecision] = useState("awarded");
  const [tone, setTone] = useState("warm");
  const [scholarshipName, setScholarshipName] = useState("");
  const [signerName, setSignerName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [letter, setLetter] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const selected = selectedIdx >= 0 && selectedIdx < savedReviews.length ? savedReviews[selectedIdx] : null;

  async function generate() {
    if (!apiKey) return setError("You're not signed in. Open Settings first.");
    if (!selected) return setError("Select a reviewed application first.");
    setGenerating(true); setError(null); setLetter(""); setSaved(false);

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
      const text = await callClaude(apiKey, DEFAULT_MODEL, system, userMsg, 1500);
      const cleanText = text.trim();
      setLetter(cleanText);
      if (selected?.id && onSaveLetter) {
        onSaveLetter(selected.id, {
          id: newRecordId(),
          text: cleanText,
          decision, tone,
          scholarshipName: scholarshipName || "",
          signerName: signerName || "",
          generatedAt: new Date().toISOString(),
          generatedBy: orgName || "Unknown organization",
        });
        setSaved(true);
      }
    } catch (err) { setError(err.message); }
    finally { setGenerating(false); }
  }

  const decisions = [
    { id: "awarded", label: "Awarded", color: good },
    { id: "waitlist", label: "Waitlist", color: bronze },
    { id: "declined", label: "Not selected", color: bad },
  ];
  const tones = [{ id: "warm", label: "Warm" }, { id: "neutral", label: "Neutral" }, { id: "formal", label: "Formal" }];

  // The applicant list below includes names, scores, and statuses — never
  // show it while signed out.
  if (!apiKey) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px" }}>
        <PageHeader eyebrow="Tool IV" title="Feedback" desc="Draft the letter that goes to the applicant."/>
        <div style={{ marginTop: 24 }}><KeyBanner onNav={onNav}/></div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 80px" }}>
      <PageHeader eyebrow="Tool IV" title="Feedback" desc="Draft the letter that goes to the applicant."/>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 40, marginTop: 40 }}>
        <section>
          <SectionLabel n="01" title="Setup"/>
          <SubHeading>Reviewed application</SubHeading>
          {savedReviews.length === 0 ? (
            <div style={{ border: `1px dashed ${rule}`, padding: 20, borderRadius: 2, color: muted, fontSize: 14, marginBottom: 20 }}>
              No reviews yet. Head to <strong style={{ color: ink }}>Review</strong> or <strong style={{ color: ink }}>Compare</strong> first — the results will show up here.
            </div>
          ) : (
            <div style={{ border: `1px solid ${rule}`, background: "#fff", borderRadius: 2, marginBottom: 20, maxHeight: 200, overflowY: "auto" }}>
              {savedReviews.map((r, i) => {
                const meta = statusMeta(r.status || "pending");
                return (
                  <button key={r.id || i} onClick={() => setSelectedIdx(i)} style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "12px 16px", background: selectedIdx === i ? paperDeep : "transparent",
                    border: "none", borderTop: i === 0 ? "none" : `1px solid ${rule}`,
                    cursor: "pointer", fontFamily: "'Inter', sans-serif",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                      <span style={{ fontFamily: "'Fraunces', serif", fontSize: 15, color: ink }}>{r.label}</span>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: meta.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{meta.label}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: bronze }}>{r.totalPoints}/{r.totalMax}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
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
            <>
              <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: "32px 36px", borderRadius: 2, whiteSpace: "pre-wrap", fontFamily: "'Fraunces', serif", fontSize: 16, lineHeight: 1.7, color: ink }}>
                {letter}
              </div>
              {saved && (
                <div style={{ marginTop: 12, fontSize: 12, color: muted, fontFamily: "'JetBrains Mono', monospace" }}>
                  Saved to {selected?.label || "this applicant"}'s record — see Records for the full history.
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ============ SETTINGS ============
function Settings({ apiKey, setApiKey, orgName, setOrgName }) {
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
      <PageHeader eyebrow="Settings" title="Sign in" desc="Sign in with the access code and password your administrator gave you."/>

      <div style={{ marginTop: 40 }}>
        <SubHeading>Organization access</SubHeading>
        {apiKey ? (
          <div style={{ border: `1px solid ${rule}`, background: "#fff", padding: 20, borderRadius: 2 }}>
            <div style={{ fontSize: 14, color: inkSoft }}>Signed in as <strong style={{ color: ink }}>{orgName || "your organization"}</strong>.</div>
            <div style={{ marginTop: 6, fontSize: 12, color: muted }}>Records sync automatically to every reviewer and browser signed in with this same access code — even at the same time — usually within {RECORDS_POLL_MS / 1000} seconds, and clear from this one when you sign out.</div>
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
        <strong style={{ color: ink }}>Note.</strong> Marksmith is a first-pass reader. It doesn't replace a human review; it gets the boring parts out of the way. Every review is saved to Records in this browser, along with the original application — so you can track decisions over time. Your sign-in session is also stored locally in this browser.
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
  const [page, setPage] = useState(pageFromHash());
  const [rubric, setRubricState] = useState(loadRubric());
  const [savedReviews, setSavedReviews] = useState(loadRecords());
  const [apiKey, setApiKeyState] = useState(loadApiKey());
  const [orgName, setOrgNameState] = useState(loadOrgName());

  // Keep the page in sync with the URL hash — this is what makes nav links
  // real pages: back/forward, refresh, and opening a link in a new tab all
  // land on the right screen instead of always resetting to Home.
  useEffect(() => {
    function onHashChange() { setPage(pageFromHash()); }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  function goTo(id) {
    if (typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "") !== id) {
      window.location.hash = id;
    } else {
      setPage(id);
    }
  }

  function setApiKey(v) {
    if (!v && apiKey) {
      // Signing out — wipe this browser's local copy so applicant data
      // doesn't linger once no one's signed in. Nothing is lost: every edit
      // was already pushed to the organization's server copy the moment it
      // happened, not batched up for sign-out.
      setSavedReviews([]);
      saveRecords([]);
    }
    setApiKeyState(v); saveApiKey(v);
  }
  function setOrgName(v) { setOrgNameState(v); saveOrgName(v); }

  // While signed in, pull this organization's records from the server and
  // merge them with whatever's local — once immediately (so a different
  // browser, or a fresh sign-in, sees the same records instead of an empty
  // list), then on a short interval, so several reviewers signed in with the
  // same access code at once converge on the same list without anyone
  // needing to sign out and back in.
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    let firstSync = true;
    async function sync() {
      try {
        const remote = await fetchRemoteRecords(apiKey);
        if (cancelled) return;
        const remoteIds = new Set(remote.map((r) => r.id));
        setSavedReviews((local) => {
          const merged = mergeRecords(local, remote);
          saveRecords(merged);
          if (firstSync) {
            // Push up anything that only exists on this browser — e.g.
            // records made before cross-browser sync existed, or while
            // offline — so every other reviewer's browser picks them up too.
            local.filter((r) => !remoteIds.has(r.id)).forEach((r) => pushRemoteRecord(apiKey, r));
          }
          return merged;
        });
      } catch {
        // Offline or the Worker is unreachable — keep what's local; the
        // next tick (or the next sign-in) retries.
      }
      firstSync = false;
    }
    sync();
    const interval = setInterval(sync, RECORDS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [apiKey]);
  function setRubric(updater) {
    setRubricState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveRubric(next);
      return next;
    });
  }
  function handleSaveReview(r) {
    setSavedReviews((all) => {
      const next = [r, ...all];
      saveRecords(next);
      if (apiKey) pushRemoteRecord(apiKey, r);
      return next;
    });
  }
  function updateRecordStatus(id, status) {
    setSavedReviews((all) => {
      let updated = null;
      const next = all.map((r) => {
        if (r.id !== id) return r;
        const entry = { status, changedAt: new Date().toISOString(), changedBy: orgName || "Unknown organization" };
        updated = { ...r, status, history: [...(r.history || []), entry], updatedAt: new Date().toISOString() };
        return updated;
      });
      saveRecords(next);
      if (apiKey && updated) pushRemoteRecord(apiKey, updated);
      return next;
    });
  }
  function updateRecordNote(id, note) {
    setSavedReviews((all) => {
      let updated = null;
      const next = all.map((r) => {
        if (r.id !== id) return r;
        updated = { ...r, reviewerNote: note, updatedAt: new Date().toISOString() };
        return updated;
      });
      saveRecords(next);
      if (apiKey && updated) pushRemoteRecord(apiKey, updated);
      return next;
    });
  }
  function deleteRecord(id) {
    setSavedReviews((all) => {
      const next = all.filter((r) => r.id !== id);
      saveRecords(next);
      if (apiKey) deleteRemoteRecord(apiKey, id);
      return next;
    });
  }
  function addLetterToRecord(id, letter) {
    setSavedReviews((all) => {
      let updated = null;
      const next = all.map((r) => {
        if (r.id !== id) return r;
        updated = { ...r, letters: [...(r.letters || []), letter], updatedAt: new Date().toISOString() };
        return updated;
      });
      saveRecords(next);
      if (apiKey && updated) pushRemoteRecord(apiKey, updated);
      return next;
    });
  }

  const hasKey = !!apiKey;

  return (
    <div style={{ background: paper, minHeight: "100vh", color: ink, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{fontsCSS}</style>
      <Nav current={page} onNav={goTo} hasKey={hasKey}/>
      {page === "home" && <Home onNav={goTo} reviewCount={savedReviews.length} rubric={rubric} hasKey={hasKey}/>}
      {page === "review" && <ReviewTool apiKey={apiKey} rubric={rubric} onSaveReview={handleSaveReview} onNav={goTo}/>}
      {page === "compare" && <CompareTool apiKey={apiKey} rubric={rubric} onSaveReview={handleSaveReview} onNav={goTo}/>}
      {page === "rubric" && <RubricBuilder rubric={rubric} setRubric={setRubric} apiKey={apiKey} onNav={goTo}/>}
      {page === "feedback" && <FeedbackComposer apiKey={apiKey} savedReviews={savedReviews} orgName={orgName} onSaveLetter={addLetterToRecord} onNav={goTo}/>}
      {page === "records" && <RecordsPage records={savedReviews} onUpdateStatus={updateRecordStatus} onUpdateNote={updateRecordNote} onDelete={deleteRecord} hasKey={hasKey} onNav={goTo}/>}
      {page === "settings" && <Settings apiKey={apiKey} setApiKey={setApiKey} orgName={orgName} setOrgName={setOrgName}/>}
      {page === "about" && <About/>}
      <Footer/>
    </div>
  );
}
