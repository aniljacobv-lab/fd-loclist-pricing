import { useState } from 'react';
import { api, auth, ROLE_LABEL, type PriceChange, type Role, type ApprovalEvent } from '../lib/api';

interface Props { pc: PriceChange; onUpdate: (pc: PriceChange) => void; }

const TIER_LABEL: Record<number, string> = { 1: 'Buyer', 2: 'Category Manager', 3: 'Director', 4: 'VP' };
const ROLE_TIER: Record<Role, number> = { BUYER: 1, CATEGORY_MGR: 2, DIRECTOR: 3, VP: 4 };

function tierStatus(pc: PriceChange, tier: number): 'approved' | 'pending' | 'inactive' {
  if (pc.approvedTiers.includes(tier)) return 'approved';
  if (tier <= pc.requiredTier) return 'pending';
  return 'inactive';
}

export function ApprovalPanel({ pc, onUpdate }: Props) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const role = auth.role();
  const myTier = ROLE_TIER[role];
  const nextTier = (() => { for (let t = 1; t <= pc.requiredTier; t++) if (!pc.approvedTiers.includes(t)) return t; return null; })();
  const canApproveNow = pc.status === 'SUBMITTED' && nextTier != null && myTier >= nextTier;
  const canReject = pc.status === 'SUBMITTED';
  const isOpen = pc.status === 'SUBMITTED' || pc.status === 'APPROVED' || pc.status === 'REJECTED' || pc.status === 'PROMOTED';

  async function call(fn: () => Promise<PriceChange>, clearComment = true) {
    setBusy(true); setErr(null);
    try { const out = await fn(); onUpdate(out); if (clearComment) setComment(''); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  const tiers = [1, 2, 3, 4].filter((t) => t <= pc.requiredTier || pc.approvedTiers.includes(t));

  return (
    <section className="fd-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="fd-section-title">Approval workflow</h3>
        <span className="text-xs text-slate-500">
          Risk-routed to tier {pc.requiredTier} <span className="text-slate-400">·</span> {pc.approvedTiers.length} of {pc.requiredTier} approved
        </span>
      </div>

      {/* tier ladder */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tiers.map((t) => {
          const st = tierStatus(pc, t);
          const cls = st === 'approved' ? 'bg-green-50 text-green-700 border-green-200'
            : st === 'pending' && t === nextTier ? 'bg-amber-50 text-amber-700 border-amber-200'
            : st === 'pending' ? 'bg-slate-50 text-slate-500 border-slate-200'
            : 'bg-slate-50 text-slate-400 border-slate-200';
          const mark = st === 'approved' ? '✓' : st === 'pending' && t === nextTier ? '•' : '·';
          return (
            <span key={t} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${cls}`}>
              <span className="font-semibold">{mark}</span>
              <span>Tier {t} <span className="opacity-70">— {TIER_LABEL[t]}</span></span>
            </span>
          );
        })}
        {pc.status === 'REJECTED' && <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700">Rejected</span>}
        {pc.status === 'APPROVED' && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">Fully approved · ready to promote</span>}
        {pc.status === 'PROMOTED' && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">Promoted to RMS</span>}
      </div>

      {!isOpen && pc.status === 'WORKSHEET' && (
        <p className="mt-3 text-xs text-slate-500">Required tier is computed from projected impact when you submit. Submit the draft to start approvals.</p>
      )}

      {/* audit log */}
      {pc.approvalLog.length > 0 && (
        <div className="mt-4">
          <div className="fd-label mb-1">Audit trail</div>
          <ol className="space-y-1.5">
            {pc.approvalLog.map((e: ApprovalEvent, i) => (
              <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
                <div className="flex items-center justify-between text-slate-500">
                  <span><span className={`font-medium ${e.action === 'APPROVED' ? 'text-green-700' : e.action === 'REJECTED' ? 'text-red-700' : 'text-slate-700'}`}>{e.action}</span>{e.tier > 0 ? <> · tier {e.tier}</> : null} · {ROLE_LABEL[e.role] ?? e.role}</span>
                  <span className="text-[11px]">{new Date(e.at).toLocaleString()}</span>
                </div>
                <div className="text-slate-700">{e.actor}{e.comment ? <> — <span className="italic text-slate-600">"{e.comment}"</span></> : null}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* actions */}
      {(canApproveNow || canReject || pc.status !== 'WORKSHEET') && (
        <div className="mt-4 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={canApproveNow ? `Add an approval comment (signing as ${ROLE_LABEL[role]})…` : 'Add a comment…'}
            className="fd-input min-h-[60px] w-full text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            {canApproveNow && (
              <button disabled={busy} onClick={() => call(() => api.approvePc(pc.pcId, comment || null))} className="fd-btn fd-btn-primary">
                Approve as {ROLE_LABEL[role]} (tier {myTier})
              </button>
            )}
            {canReject && (
              <button disabled={busy} onClick={() => call(() => api.rejectPc(pc.pcId, comment || null))} className="fd-btn fd-btn-ghost text-red-700">Reject</button>
            )}
            <button disabled={busy || !comment.trim()} onClick={() => call(() => api.commentPc(pc.pcId, comment))} className="fd-btn fd-btn-ghost">Comment</button>
            {pc.status === 'SUBMITTED' && nextTier != null && myTier < nextTier && (
              <span className="text-xs text-slate-500">Next signoff requires tier {nextTier} ({TIER_LABEL[nextTier]}). Switch role in the sidebar to approve.</span>
            )}
          </div>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
        </div>
      )}
    </section>
  );
}
