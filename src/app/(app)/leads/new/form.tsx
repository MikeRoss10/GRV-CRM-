"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Notice } from "@/components/ui";
import { createManualLead } from "../actions";

export function NewLeadForm({ sources }: { sources: Array<[string, string]> }) {
  const [state, action, pending] = useActionState(createManualLead, {});
  return (
    <form action={action} className="card grid gap-4 p-5 sm:grid-cols-2">
      {state.error && <div className="sm:col-span-2"><Notice tone="crit" title={state.error} /></div>}
      <div><label className="label" htmlFor="full_name">Name</label><input id="full_name" name="full_name" className="input" required /></div>
      <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="input" placeholder="98765 43210" inputMode="tel" /></div>
      <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
      <div>
        <label className="label" htmlFor="source_type">Source</label>
        <select id="source_type" name="source_type" className="input" defaultValue="walk_in">
          {sources.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor="service">Service / requirement</label><input id="service" name="service" className="input" placeholder="2 BHK apartment" /></div>
      <div><label className="label" htmlFor="location">Location</label><input id="location" name="location" className="input" placeholder="Andheri" /></div>
      <div><label className="label" htmlFor="budget">Budget</label><input id="budget" name="budget" className="input" placeholder="1.2 Cr, 45 lakh, 50000" /></div>
      <div><label className="label" htmlFor="cost">Lead cost (if charged per lead)</label><input id="cost" name="cost" className="input" placeholder="Leave blank if unknown" /></div>
      <div><label className="label" htmlFor="provider_lead_id">Source lead ID</label><input id="provider_lead_id" name="provider_lead_id" className="input" /></div>
      <div><label className="label" htmlFor="received_at">Received at</label><input id="received_at" name="received_at" type="datetime-local" className="input" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} className="input" /></div>
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}Create lead</button>
      </div>
    </form>
  );
}
