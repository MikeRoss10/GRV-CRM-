"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { addCostEvent, saveSource, type CostState } from "../actions";

function Msg({ s }: { s: CostState }) {
  return s.error ? <span className="text-sm text-crit-700" role="alert">{s.error}</span> : s.ok ? <span className="text-sm text-teal-700" role="status">{s.ok}</span> : null;
}

export function AddCostForm({ sources, currency }: { sources: Array<{ id: string; display_name: string }>; currency: string }) {
  const [state, action, pending] = useActionState(addCostEvent, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="label" htmlFor="c-src">Source</label>
        <select id="c-src" name="source_account_id" className="input" required>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="c-type">Cost type</label>
        <select id="c-type" name="cost_type" className="input" defaultValue="package">
          <option value="package">Package</option>
          <option value="subscription">Subscription</option>
          <option value="prepaid_topup">Prepaid top-up</option>
          <option value="per_lead">Per-lead charge</option>
          <option value="click">Ad spend (clicks)</option>
          <option value="impression">Ad spend (impressions)</option>
          <option value="agency_fee">Agency fee</option>
          <option value="adjustment">Adjustment / refund</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="c-amt">Amount ({currency})</label>
        <input id="c-amt" name="amount" className="input" required placeholder="14000 or 1.2L" />
      </div>
      <div>
        <label className="label" htmlFor="c-ref">Invoice / reference</label>
        <input id="c-ref" name="provider_ref" className="input" placeholder="Optional" />
      </div>
      <div>
        <label className="label" htmlFor="c-ps">Period start</label>
        <input id="c-ps" name="period_start" type="date" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="c-pe">Period end</label>
        <input id="c-pe" name="period_end" type="date" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="c-at">Or single date</label>
        <input id="c-at" name="occurred_at" type="date" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="c-notes">Notes</label>
        <input id="c-notes" name="notes" className="input" placeholder="e.g. Gold listing, Mumbai" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}Add cost</button>
        <span className="text-xs text-muted">With a period, the amount is spread evenly per day. Without one, it counts on the single date.</span>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function SourceRowForm({ source }: { source?: { id: string; display_name: string; billing_model: string; account_identifier: string | null; zero_cost: boolean; status: string; source_type: string } }) {
  const [state, action, pending] = useActionState(saveSource, {});
  return (
    <form action={action} className="grid items-end gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto_auto_auto]">
      {source && <input type="hidden" name="id" value={source.id} />}
      <div>
        <label className="label">Name</label>
        <input name="display_name" defaultValue={source?.display_name} className="input !py-1.5" placeholder="Sulekha Mumbai Residential" />
      </div>
      {!source ? (
        <div>
          <label className="label">Source type</label>
          <select name="source_type" className="input !py-1.5" defaultValue="other">
            {["justdial", "sulekha", "91acres", "meta_ads", "google_ads", "website", "referral", "walk_in", "other"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="label">Billing model</label>
          <select name="billing_model" defaultValue={source.billing_model} className="input !py-1.5">
            {["subscription", "package", "prepaid", "per_lead", "cpc", "cpm", "cpa", "manual"].map((b) => <option key={b} value={b}>{b.replace("_", " ")}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label">Account / campaign ref</label>
        <input name="account_identifier" defaultValue={source?.account_identifier ?? ""} className="input !py-1.5" />
      </div>
      <label className="flex items-center gap-2 pb-2 text-xs text-muted" title="Explicit assumption: this source has no direct spend">
        <input type="checkbox" name="zero_cost" defaultChecked={source?.zero_cost} className="size-4 accent-teal-600" /> No direct cost
      </label>
      <select name="status" defaultValue={source?.status ?? "active"} className="input !w-auto !py-1.5">
        <option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
      </select>
      <div className="flex items-center gap-2">
        <button className="btn-secondary !py-1.5" disabled={pending}>{source ? "Save" : "Add source"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}
