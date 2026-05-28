import { useEffect, useState } from 'react';
import {
  api, type ChangeType, type RoundingRule, type PriceChange, type Vendor,
  type ItemSelector as ItemSel, type LocationSelector as LocSel,
} from '../lib/api';
import { ItemSelector } from '../components/ItemSelector';
import { LocationSelector } from '../components/LocationSelector';
import { MarginGuardrail } from '../components/MarginGuardrail';
import { ImpactPanel } from '../components/ImpactPanel';
import { AIAssistPanel } from '../components/AIAssistPanel';
import { ApprovalPanel } from '../components/ApprovalPanel';

interface Props { pcId?: number; onClose: () => void; }

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10);
}
const ROUNDING: { key: RoundingRule; label: string }[] = [
  { key: 'NONE', label: 'None' }, { key: 'ENDS_IN', label: 'Ends in' }, { key: 'PRICE_POINT', label: 'Price point' },
  { key: 'ROUND', label: 'Round' }, { key: 'CLEARANCE_ROUNDING_7S', label: 'Clearance rounding 7s' }, { key: 'GOOD_ROUNDING_RULES', label: 'Good rounding rules' },
];

export function PriceChangeEditor({ pcId, onClose }: Props) {
  const [pcName, setPcName] = useState('New Price Change');
  const [itemSel, setItemSel] = useState<ItemSel>({ mode: 'SINGLE_SKU', sku: null, exceptSkus: [] });
  const [locSel, setLocSel] = useState<LocSel>({ mode: 'LOCATION_LIST', locListId: null, exceptStoreIds: [] });
  const [changeType, setChangeType] = useState<ChangeType>('MARKDOWN_PCT');
  const [amount, setAmount] = useState(20);
  const [roundingRule, setRoundingRule] = useState<RoundingRule>('ENDS_IN');
  const [endsIn, setEndsIn] = useState<number | null>(0.99);
  const [multiUnits, setMultiUnits] = useState<number | null>(null);
  const [multiRetail, setMultiRetail] = useState<number | null>(null);
  const [fundedByVendor, setFundedByVendor] = useState(false);
  const [dealId, setDealId] = useState('');
  const [fundingVendorId, setFundingVendorId] = useState<number | null>(null);
  const [fundingPct, setFundingPct] = useState<number | null>(50);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [effectiveDate, setEffectiveDate] = useState(new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10));
  const [sendDate, setSendDate] = useState(isoMinusDays(new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10), 5));
  const [sendAuto, setSendAuto] = useState(true);
  const [reasonCode, setReasonCode] = useState<number | null>(9);
  const [existing, setExisting] = useState<PriceChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exec, setExec] = useState<string | null>(null);

  useEffect(() => { api.listVendors().then(setVendors); }, []);
  useEffect(() => { if (sendAuto) setSendDate(isoMinusDays(effectiveDate, 5)); }, [effectiveDate, sendAuto]);

  useEffect(() => {
    if (pcId) api.listPriceChanges().then((all) => {
      const pc = all.find((x) => x.pcId === pcId); if (!pc) return;
      setExisting(pc); setPcName(pc.pcName); setItemSel(pc.itemSelector); setLocSel(pc.locationSelector);
      setChangeType(pc.changeType); setAmount(pc.amount); setRoundingRule(pc.roundingRule); setEndsIn(pc.endsIn);
      setMultiUnits(pc.multiUnits); setMultiRetail(pc.multiRetail);
      setFundedByVendor(pc.fundedByVendor); setDealId(pc.dealId ?? ''); setFundingVendorId(pc.fundingVendorId); setFundingPct(pc.fundingPct);
      setEffectiveDate(pc.effectiveDate); setSendDate(pc.sendDate); setSendAuto(false); setReasonCode(pc.reasonCode);
    });
  }, [pcId]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const out = await api.createPriceChange({
        pcName, itemSelector: itemSel, locationSelector: locSel, changeType, amount, roundingRule, endsIn,
        multiUnits, multiRetail, fundedByVendor, dealId: dealId || null, fundingVendorId, fundingPct,
        sendDate, effectiveDate, reasonCode,
      });
      setExisting(out);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/0 stores|empty_selection.*stores/i.test(msg)) {
        setError('No stores selected. Under “Target stores”, pick one or more location lists, one or more zones, or specific stores.');
      } else if (/0 SKUs|empty_selection.*SKU/i.test(msg)) {
        setError('No items selected. Under “Items”, choose a SKU, SKU list, merchandise hierarchy, price point, or vendor.');
      } else if (/bad_request/i.test(msg)) {
        setError('Some fields are missing or invalid — please review the form and try again.');
      } else {
        setError(msg);
      }
    } finally { setSaving(false); }
  }
  async function setStatus(status: 'SUBMITTED' | 'APPROVED') { if (!existing) return; setExisting(await api.setStatus(existing.pcId, status)); }
  async function submit() {
    if (!existing) return; setExec('Submitting for approval…'); setError(null);
    try { const out = await api.submitPc(existing.pcId); setExisting(out.priceChange); setExec(`Submitted · required tier ${out.requiredTier}`); }
    catch (e: any) { setError(String(e?.message ?? e)); setExec(null); }
  }
  async function promote() {
    if (!existing) return; setExec('Promoting…');
    try { setExisting(await api.promotePc(existing.pcId)); setExec('Promoted to RMS.'); }
    catch (e: any) { setExec(e?.message ?? String(e)); }
  }
  async function reResolve() {
    if (!existing) return; setExec('Resolving…');
    const r = await api.resolvePc(existing.pcId);
    const all = await api.listPriceChanges(); const pc = all.find((x) => x.pcId === existing.pcId);
    if (pc) setExisting(pc);
    setExec(`Resolved: ${r.skuCount} SKUs × ${r.storeCount} stores.`);
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
          <div className="min-w-0">
            <button onClick={onClose} className="mb-1 text-xs font-medium text-slate-400 hover:text-slate-700">&larr; Back to Price Changes</button>
            <input className="block w-[36rem] max-w-full rounded-md border border-transparent bg-transparent text-xl font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-fd-red focus:px-2" value={pcName} onChange={(e) => setPcName(e.target.value)} />
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span className={`fd-pill ${existing ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>{existing?.status ?? 'NEW'}</span>
              {existing && <span>PC #{existing.pcId} · {existing.resolvedSkus.length} SKUs × {existing.resolvedStoreIds.length} stores</span>}
              {exec && <span className="text-slate-400">· {exec}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="fd-btn fd-btn-ghost">{existing ? 'Save new version' : 'Save draft'}</button>
            {existing && <button onClick={reResolve} className="fd-btn fd-btn-ghost">Resolve</button>}
            {existing?.status === 'WORKSHEET' && <button onClick={submit} className="fd-btn fd-btn-primary">Submit for approval</button>}
            
            {existing?.status === 'APPROVED' && <button onClick={promote} className="fd-btn fd-btn-primary">Promote to RMS</button>}
            {!existing && <button disabled className="fd-btn fd-btn-primary opacity-50">Submit</button>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-3xl space-y-5">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {existing && <ApprovalPanel pc={existing} onUpdate={setExisting} />}

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Items</h3>
              <ItemSelector value={itemSel} onChange={setItemSel} />
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-4">Pricing</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="fd-label">Change type</label>
                  <select className="fd-input" value={changeType} onChange={(e) => setChangeType(e.target.value as ChangeType)}>
                    <option value="MARKDOWN_PCT">% off (markdown)</option><option value="MARKDOWN_AMT">$ off (markdown)</option><option value="SET_PRICE">Set price to a set amount</option><option value="ZONE_INHERIT">Inherit zone prices (rezone)</option>
                  </select>
                </div>
                <div>
                  <label className="fd-label">Amount {changeType === 'MARKDOWN_PCT' ? '(%)' : '($)'}</label>
                  <input type="number" step={changeType === 'MARKDOWN_PCT' ? 1 : 0.01} className="fd-input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                </div>
                <div>
                  <label className="fd-label">Rounding / price ending</label>
                  <select className="fd-input" value={roundingRule} onChange={(e) => setRoundingRule(e.target.value as RoundingRule)}>
                    {ROUNDING.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="fd-label">Ends in</label>
                  <select className="fd-input" value={endsIn ?? ''} disabled={roundingRule === 'NONE' || roundingRule === 'ROUND'} onChange={(e) => setEndsIn(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">—</option><option value="0.99">.99</option><option value="0.97">.97</option><option value="0.95">.95</option><option value="0.49">.49</option><option value="0.00">.00</option>
                  </select>
                </div>
                <div>
                  <label className="fd-label">Reason code</label>
                  <input type="number" className="fd-input" value={reasonCode ?? ''} onChange={(e) => setReasonCode(e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>
              <div className="mt-4">
                <MarginGuardrail itemSelector={itemSel} changeType={changeType} amount={amount} endsIn={endsIn} />
              </div>
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-4">Multi-unit pricing <span className="font-normal text-slate-400">(optional)</span></h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="fd-label">Multi-units</label>
                  <input type="number" min={0} placeholder="e.g. 2" className="fd-input" value={multiUnits ?? ''} onChange={(e) => setMultiUnits(e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div>
                  <label className="fd-label">Multi-retail ($)</label>
                  <input type="number" step={0.01} placeholder="e.g. 3.00" className="fd-input" value={multiRetail ?? ''} onChange={(e) => setMultiRetail(e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>
              {multiUnits && multiRetail ? <p className="mt-2 text-xs text-slate-500">Shelf tag: <span className="font-medium text-slate-700">{multiUnits} for ${multiRetail.toFixed(2)}</span></p> : null}
            </section>

            <section className="fd-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="fd-section-title">Vendor-funded markdown</h3>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={fundedByVendor} onChange={(e) => setFundedByVendor(e.target.checked)} /> Vendor funded
                </label>
              </div>
              {fundedByVendor && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="fd-label">Deal ID</label>
                    <input className="fd-input" placeholder="FL-2026-0612" value={dealId} onChange={(e) => setDealId(e.target.value)} />
                  </div>
                  <div>
                    <label className="fd-label">Funding vendor</label>
                    <select className="fd-input" value={fundingVendorId ?? ''} onChange={(e) => setFundingVendorId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">—</option>
                      {vendors.map((v) => <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="fd-label">Funding %</label>
                    <input type="number" min={0} max={100} className="fd-input" value={fundingPct ?? ''} onChange={(e) => setFundingPct(e.target.value ? Number(e.target.value) : null)} />
                  </div>
                </div>
              )}
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-4">Dates</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="fd-label">Effective date · price at register</label>
                  <input type="date" className="fd-input" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="fd-label mb-0">Send date · extract / print</label>
                    <label className="flex items-center gap-1 text-[11px] font-normal text-slate-500"><input type="checkbox" checked={sendAuto} onChange={(e) => setSendAuto(e.target.checked)} /> auto −5d</label>
                  </div>
                  <input type="date" disabled={sendAuto} className="fd-input disabled:bg-slate-50 disabled:text-slate-400" value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Target stores</h3>
              <LocationSelector value={locSel} onChange={setLocSel} />
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Projected impact <span className="font-normal text-slate-400">(estimated)</span></h3>
              <ImpactPanel itemSelector={itemSel} locationSelector={locSel} changeType={changeType} amount={amount} endsIn={endsIn} />
            </section>
          </div>
        </div>
      </div>

      <aside className="w-80 shrink-0 border-l border-slate-200 bg-white p-5">
        <AIAssistPanel
          sku={itemSel.sku ?? null}
          onApplyDraft={(d) => {
            if (d.pcName !== undefined) setPcName(d.pcName);
            if (d.sku !== undefined && d.sku !== null) setItemSel({ mode: 'SINGLE_SKU', sku: d.sku, exceptSkus: [] });
            if (d.changeType !== undefined) setChangeType(d.changeType);
            if (d.amount !== undefined) setAmount(d.amount);
            if (d.effectiveDate) setEffectiveDate(d.effectiveDate);
            if (d.storeIds !== undefined) setLocSel({ mode: 'STORES', storeIds: d.storeIds, exceptStoreIds: [] });
          }}
        />
      </aside>
    </div>
  );
}
