"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Notice } from "@/components/ui";
import { createWorkspace } from "./actions";

const VERTICALS = [
  ["real_estate", "Real estate"],
  ["home_services", "Home services"],
  ["healthcare", "Healthcare / clinics"],
  ["education", "Education / coaching"],
  ["automotive", "Automotive"],
  ["other", "Other"],
];

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState(createWorkspace, {});
  return (
    <form action={action} className="card mt-6 space-y-5 p-5 sm:p-6">
      {state.error && <Notice tone="crit" title={state.error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Business name</label>
          <input id="name" name="name" className="input" required placeholder="Acme Realty" />
        </div>
        <div>
          <label className="label" htmlFor="member_name">Your name</label>
          <input id="member_name" name="member_name" className="input" defaultValue={defaultName} placeholder="Priya Nair" />
        </div>
        <div>
          <label className="label" htmlFor="vertical">Business category</label>
          <select id="vertical" name="vertical" className="input" defaultValue="real_estate">
            {VERTICALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="currency">Currency</label>
          <select id="currency" name="currency" className="input" defaultValue="INR">
            <option value="INR">INR — Indian rupee</option>
            <option value="USD">USD — US dollar</option>
            <option value="AED">AED — UAE dirham</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="timezone">Timezone</label>
          <select id="timezone" name="timezone" className="input" defaultValue="Asia/Kolkata">
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Asia/Dubai">Asia/Dubai</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="sla">First-response target (SLA)</label>
          <div className="flex items-center gap-2">
            <input id="sla" name="sla" type="number" min={1} max={1440} defaultValue={15} className="input w-28" />
            <span className="text-sm text-muted">minutes from enquiry to first response</span>
          </div>
        </div>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3 text-sm">
        <input type="checkbox" name="demo" defaultChecked className="mt-0.5 size-4 accent-teal-600" />
        <span>
          <span className="font-medium text-ink">Load 90 days of sample leads and costs</span>
          <span className="block text-muted">Explore the dashboards right away. Sample records are tagged and can be removed in one click from Settings.</span>
        </span>
      </label>
      <button className="btn-primary w-full py-2.5" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? "Setting up…" : "Create workspace"}
      </button>
    </form>
  );
}
