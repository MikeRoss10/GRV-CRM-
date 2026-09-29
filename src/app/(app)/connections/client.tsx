"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Check, ClipboardCopy, FlaskConical, Loader2, Upload } from "lucide-react";
import { ConfidenceMeter, Notice } from "@/components/ui";
import { formatPhone, money } from "@/lib/format";
import { parseLeadMessage, SOURCE_LABELS, type SourceType } from "@/lib/parsers";
import { importCsv, saveParsedLead, type CsvMapping, type CsvRow } from "./actions";

export function CopyField({ value, label, mono = true, secret }: { value: string; label: string; mono?: boolean; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(!secret);
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex gap-2">
        <input readOnly value={show ? value : "•".repeat(Math.min(32, value.length))} className={`input ${mono ? "font-mono text-xs" : ""}`} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        {secret && <button type="button" className="btn-secondary" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>}
        <button type="button" className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check className="size-4 text-teal-600" /> : <ClipboardCopy className="size-4" />}<span className="sr-only">Copy</span>
        </button>
      </div>
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-xl bg-navy-950 p-4 text-xs leading-relaxed text-white/85"><code>{code}</code></pre>
      <button type="button" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="absolute top-2 right-2 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const SAMPLES: Record<string, string> = {
  sulekha: "Sulekha: New lead\nCustomer: Anjali Sharma\nPhone: 98765 43321\nRequirement: 2 BHK apartment\nLocation: Andheri West\nBudget: 1.2 Cr\nLead price: Rs 1050\nThis enquiry has also been sent to 3 other providers.",
  justdial: "Justdial: Rahul Mehta enquired for Office space in Powai. Call 98200 11223. JD Lead ID: JD4471902",
  "91acres": "91acres enquiry\nName: Kavita Rao\nMobile: +91 91234 56789\nEmail: kavita.rao@example.com\nProperty type: Villa\nProject location: Thane\nEnquiry ID: 91A-88213",
};

const FIELD_LABELS: Array<[keyof ReturnType<typeof parseLeadMessage>["fields"], string]> = [
  ["full_name", "Name"], ["phone_e164", "Phone"], ["email", "Email"], ["service", "Service / property"], ["location", "Locality"],
  ["budget_minor", "Budget"], ["cost_minor", "Source cost"], ["provider_lead_id", "Source lead ID"],
];

export function ParserTester({ canSave }: { canSave: boolean }) {
  const [text, setText] = useState(SAMPLES.sulekha);
  const [hint, setHint] = useState<SourceType | "">("");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState<null | { id?: string; msg: string; error?: boolean }>(null);
  const r = useMemo(() => parseLeadMessage(text, { sourceHint: hint || undefined }), [text, hint]);
  const found = FIELD_LABELS.filter(([k]) => r.fields[k].value !== null).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label !mb-0">Sample message</span>
          {Object.keys(SAMPLES).map((k) => (
            <button key={k} type="button" onClick={() => { setText(SAMPLES[k]); setSaved(null); }} className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-muted hover:text-ink">{SOURCE_LABELS[k as SourceType]}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="sample">Sample message</label>
        <textarea id="sample" value={text} onChange={(e) => { setText(e.target.value); setSaved(null); }} rows={10} className="input font-mono text-xs" />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Source</span>
          <select value={hint} onChange={(e) => setHint(e.target.value as SourceType | "")} className="input !w-auto !py-1">
            <option value="">Auto-detect</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{SOURCE_LABELS[r.source.value]} parser <span className="font-normal text-muted">· {r.source.reason}</span></span>
          <span className="text-xs text-muted tnum">{found} / {FIELD_LABELS.length} fields found</span>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {FIELD_LABELS.map(([k, label]) => {
              const f = r.fields[k];
              const v = f.value === null ? null : k === "phone_e164" ? formatPhone(String(f.value)) : k === "budget_minor" || k === "cost_minor" ? money(Number(f.value), "INR") : String(f.value);
              return (
                <tr key={k} className="border-b border-line/70">
                  <td className="py-1.5 pr-3 text-muted">{label}</td>
                  <td className="py-1.5 pr-3">{v ?? <span className="text-faint">Missing</span>}</td>
                  <td className="py-1.5 text-right">{v !== null && <ConfidenceMeter value={f.confidence} />}</td>
                </tr>
              );
            })}
            <tr><td className="py-1.5 pr-3 text-muted">Shared lead</td><td colSpan={2} className="py-1.5">{r.shared_evidence === "source_stated" ? "Stated by the source" : "No evidence"}</td></tr>
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm">Overall: <ConfidenceMeter value={r.confidence} /></span>
          {canSave && (
            <button
              type="button"
              className="btn-primary ml-auto"
              disabled={pending || !text.trim()}
              onClick={() => start(async () => {
                const res = await saveParsedLead(text, hint);
                setSaved("error" in res && res.error ? { msg: res.error, error: true } : { id: res.result?.opportunity_id, msg: res.result?.result === "created" ? "Lead created" : "Already ingested — matched existing lead" });
              })}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}Save as lead
            </button>
          )}
        </div>
        {saved && (
          <p className={`mt-2 text-sm ${saved.error ? "text-crit-700" : "text-teal-700"}`} role="status">
            {saved.msg}{saved.id && <> · <Link className="underline" href={`/leads/${saved.id}`}>Open lead</Link></>}
          </p>
        )}
      </div>
    </div>
  );
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const CANON: Array<[string, string, RegExp]> = [
  ["full_name", "Name", /name|customer|buyer|person/i],
  ["phone", "Phone", /phone|mobile|contact|number|cell/i],
  ["email", "Email", /e-?mail/i],
  ["source", "Source", /source|platform|channel/i],
  ["service", "Service / requirement", /service|requirement|category|looking|property|product/i],
  ["location", "Location", /location|area|city|locality/i],
  ["received_at", "Received date", /date|time|received|created/i],
  ["status", "Status / outcome", /status|stage|outcome/i],
  ["revenue", "Revenue", /revenue|deal|value|amount/i],
  ["cost", "Lead cost", /cost|price|charge/i],
  ["budget", "Budget", /budget/i],
  ["provider_lead_id", "Source lead ID", /lead.?id|enquiry.?id|request.?id|ref/i],
];

export function CsvImport() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [defaultSource, setDefaultSource] = useState<SourceType>("other");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<null | { created?: number; duplicates?: number; skipped?: number; errors?: string[]; error?: string }>(null);

  function onFile(file: File) {
    file.text().then((t) => {
      const grid = parseCsv(t.replace(/^﻿/, ""));
      const [h, ...body] = grid;
      if (!h) return;
      setHeaders(h.map((x) => x.trim()));
      setRows(body.map((r) => Object.fromEntries(h.map((col, i) => [col.trim(), r[i] ?? ""]))));
      const used = new Set<string>();
      const m: CsvMapping = {};
      for (const [k, , re] of CANON) {
        const col = h.map((x) => x.trim()).find((x) => re.test(x) && !used.has(x));
        if (col) { m[k] = col; used.add(col); }
      }
      setMapping(m);
      setResult(null);
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-stone-50 px-4 py-8 text-center text-sm text-muted hover:border-teal-500">
        <Upload className="size-5" aria-hidden />
        <span><span className="font-medium text-ink">Choose a CSV file</span> — leads, outcomes or a spreadsheet export</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {rows.length > 0 && (
        <>
          <p className="text-sm">{rows.length} rows found. Check the column mapping:</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CANON.map(([k, label]) => (
              <label key={k} className="text-sm">
                <span className="label">{label}</span>
                <select className="input !py-1.5" value={mapping[k] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value }))}>
                  <option value="">— not in file —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <label className="text-sm">
              <span className="label">Source when the column is empty</span>
              <select className="input !py-1.5" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value as SourceType)}>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-stone-50"><tr>{CANON.filter(([k]) => mapping[k]).map(([k, l]) => <th key={k} className="table-head">{l}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-line">{CANON.filter(([k]) => mapping[k]).map(([k]) => <td key={k} className="px-3 py-1.5">{r[mapping[k]]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {!mapping.phone && !mapping.email && <Notice title="Map a phone or email column so leads can be de-duplicated." />}
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() => start(async () => setResult(await importCsv(rows, mapping, defaultSource)))}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}Import {rows.length} rows
          </button>
          <p className="text-xs text-muted">Re-importing the same file is safe: rows with the same lead ID and phone are skipped. Imported outcomes are dated to the enquiry date and carry no response time.</p>
        </>
      )}
      {result && (
        result.error ? <Notice tone="crit" title={result.error} /> : (
          <Notice tone="teal" title={`Imported ${result.created} leads`}>
            {result.duplicates} already existed · {result.skipped} rows skipped (no name, phone or email)
            {result.errors?.length ? <ul className="mt-1 list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
          </Notice>
        )
      )}
    </div>
  );
}
