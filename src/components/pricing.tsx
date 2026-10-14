"use client";
import { ConsumerPolicies, SupportLink, useConsumer } from "./consumer-info";
import Link from "next/link";
import { useBrand } from "./runtime-config";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, ArrowUpRight, Coins } from "lucide-react";
import { PublicPage } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, Modal } from "./ui";
import { useResource } from "@/lib/use-resource";
import { orderApi } from "@/lib/api";
import { date, number } from "@/lib/brand";
import { englishLabel } from "@/lib/english";
import { directCheckoutUrl, purchaseChanged, isEnglishPlan, planPurchase } from "@/lib/billing";
import type { BillCycle, PayChannelVO, PlanVO, FaqVO, CompareVO, PromoVO } from "@/types/billing";
import { publicPricingPlans, type PricingExample } from "@/lib/public-pricing";
import { modelName } from "@/lib/brand";
import type { ConsumerInfo } from "@/lib/consumer";

const questions = [
  ["How do credits work?", "Credits are used when you create through the studio or API. Each model and output setting has its own cost. The studio shows an estimate before you submit, and the service confirms the actual cost."],
  ["Do the studio and API share a balance?", "Yes. Your account uses one credit balance for both the creative studio and your API requests. Media usage and refunds are available in your account."],
  ["What happens if a generation fails?", "Confirmed generation failures are eligible for the service’s credit-refund processing. Queued cancellations can be refunded; cancellations after provider processing has started are charged. A connection timeout does not confirm failure. Check Usage & credits for the posted refund and contact support with the task reference if it is missing. Payment refunds are a separate support request."],
  ["How does the 12× option work?", "It is one larger credit purchase, not an annual subscription. The pack price is shown on the card. Any applicable taxes are displayed at checkout before you pay. All credits arrive after payment confirmation."],
  ["Will my plan renew automatically?", "No. Every pack is a single payment. You can buy the same pack again, and the credits are added to your remaining balance. There are no recurring charges."],
  ["Which payment methods can I use?", "Plans are priced in US dollars. The secure checkout page shows available payment methods and any applicable taxes before you pay."],
  ["Can I use every model with a plan?", "The live model catalog and your account permissions determine availability. Some models may be temporarily under maintenance. Check the studio for current settings and pricing."],
];
interface PricingProps { initialPlans: PlanVO[] | null; examples: PricingExample[]; initialInfo: ConsumerInfo }
export default function Pricing(props: PricingProps) {
  const { user } = useAuth();
  return <PricingContent key={user?.id || "signed-out"} {...props} />;
}
function PricingContent({ initialPlans, examples, initialInfo }: PricingProps) {
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const { money: formatMoney } = useBrand();
  const money = (amount: number) => formatMoney(amount, "USD");
  const { user, sessionVersion } = useAuth(); const router = useRouter(); const [requestedCycle, setCycle] = useState<BillCycle>("monthly"); const [selected, setSelected] = useState<PlanVO | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const leavingOrder = useRef<string | null>(null);
  const [readyOrder, setReadyOrder] = useState<string | null>(null);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted || !leavingOrder.current) return;
      const id = leavingOrder.current; leavingOrder.current = null; pending.current = null;
      setBusy(false); setSelected(null); setReadyOrder(null);
      router.replace(`/billing?order=${encodeURIComponent(id)}`);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [router]);
  const { plans: livePlans } = useConsumer();
  const planData = livePlans.loading ? initialPlans : publicPricingPlans(livePlans.data);
  const plans = { data: planData, loading: false, error: livePlans.error || (planData === null ? "Credit prices could not be loaded. Please try again." : ""), refresh: livePlans.refresh };
  const channels = useResource<PayChannelVO[]>("/api/billing/en/channels");
  const faq = useResource<FaqVO>("/api/billing/en/faq");
  const compare = useResource<CompareVO>("/api/billing/en/compare");
  const promo = useResource<PromoVO>("/api/billing/en/promo");
  const englishPlans = (plans.data || []).filter(isEnglishPlan);
  const hasLargePack = englishPlans.some(plan => plan.monthly > 0 && planPurchase(plan, "yearly").available);
  const cycle = hasLargePack ? requestedCycle : "monthly";
  const paymentMethods = (channels.data || []).filter((item) => item.currency === "USD" && ["pancake", "stripe"].includes(item.key));
  const providerName = paymentMethods[0]?.key === "pancake" ? "Waffo Pancake" : "Stripe";
  const pancake = paymentMethods[0]?.key === "pancake";
  const faqItems = faq.data?.items.length ? faq.data.items.map((item) => [item.q, item.a]) : questions.filter(([question]) => hasLargePack || question !== "How does the 12× option work?");
  const amount = (plan: PlanVO) => planPurchase(plan, cycle).total;
  const choose = (plan: PlanVO) => { setError(""); if (!user) { router.push("/login?redirect=/pricing"); return; } if (!amount(plan)) { router.push("/studio"); return; } setSelected(plan); };
  const checkout = async () => {
    if (leavingOrder.current) { router.push(`/billing?order=${encodeURIComponent(leavingOrder.current)}&existing=1`); return; }
    if (!selected || !isEnglishPlan(selected) || !paymentMethods.length || pending.current || busy) return; setBusy(true); setError("");
    const controller = new AbortController(); pending.current = controller; const version = sessionVersion();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await orderApi.create({ type: "plan", planId: selected.id, cycle, payChannel: paymentMethods[0].key }, controller.signal);
    clearTimeout(timer); pending.current = null;
    if (!alive.current) return;
    setBusy(false);
    if (sessionVersion() !== version) { setError("Your sign-in was updated. Check your order history before trying checkout again."); return; }
    if (response.success && (typeof response.data?.id !== "string" || !response.data.id)) { setError("The checkout response was incomplete. Check your order history before trying again."); return; }
    if (response.success && !controller.signal.aborted) {
      const order = response.data;
      try { localStorage.setItem("framelyn.pending-order", order.id); } catch { /* The owned order remains accessible from order history. */ }
      const paymentURL = directCheckoutUrl(order, selected, cycle);
      if (paymentURL) {
        leavingOrder.current = order.id;
        try {
          window.location.assign(paymentURL);
          // Order creation has finished. A stopped/blocked browser navigation
          // must not leave the site trapped in a permanently busy dialog.
          setReadyOrder(order.id); setSelected(null); return;
        } catch { leavingOrder.current = null; }
      }
      router.push(`/billing?order=${encodeURIComponent(order.id)}${order.existingCheckout ? "&existing=1" : purchaseChanged(order, selected, cycle) ? "&review=1" : ""}`);
    }
    else setError(response.code === 0 || controller.signal.aborted ? "Checkout was not confirmed. Check your order history before creating another order." : response.message);
  };
  return <PublicPage><div className="wrap"><header className="public-title pricing-title"><p className="page-overline">More room for your imagination</p><h1>Credits for your<br />next creative chapter.</h1><p>Buy credits when you need them. Pay once, receive the full allowance, and buy again whenever you need more. No subscription or automatic renewal.</p></header>{readyOrder && <p className="pricing-footnote" role="status">Your order is ready. If Stripe did not open, <Link className="text-link" href={`/billing?order=${encodeURIComponent(readyOrder)}`}>review your order</Link> to continue without creating another purchase.</p>}{promo.data?.enabled && <aside className="pricing-promo"><div><strong>{promo.data.title}</strong>{promo.data.subtitle && <p>{promo.data.subtitle}</p>}</div><span>Offer ends {date(promo.data.endsAt)}</span></aside>}{hasLargePack && <div className="pricing-cycle" aria-label="Credit pack size"><button className={cycle === "monthly" ? "on" : ""} onClick={() => setCycle("monthly")}>Standard pack</button><button className={cycle === "yearly" ? "on" : ""} onClick={() => setCycle("yearly")}>12× credits</button></div>}{plans.loading && <Loading label="Finding your plans…" />}{plans.error && <Alert>{plans.error}<button onClick={plans.refresh}> Retry</button></Alert>}{!plans.loading && !plans.error && !englishPlans.length && <EmptyState title="Credit packs are not on sale yet." description="USD prices have not been published. You can browse the models; contact us to ask about purchasing access." action={<SupportLink className="button">Ask about availability</SupportLink>} />}<div className="pricing-grid">{englishPlans.map((plan, index) => { const label = englishLabel(plan.name, ["Essential", "Creator", "Professional", "Studio"][index] || `Plan ${index + 1}`); const totalPrice = amount(plan); const creditCount = planPurchase(plan, cycle).credits; const features = plan.items?.filter((item) => item && !/[\p{Script=Han}]/u.test(item)); return <article className={`pricing-card ${plan.featured ? "featured" : ""}`} key={plan.id}>{plan.featured && <span>Featured plan</span>}<h2>{label}</h2><p>{englishLabel(plan.desc, "A credit plan for the way you create.")}</p><div className="plan-price">{planPurchase(plan, cycle).available ? money(totalPrice) : "—"}<small> / purchase</small></div><div className="plan-billed">{!planPurchase(plan, cycle).available ? "Larger pack not available" : amount(plan) === 0 ? "Free plan" : cycle === "yearly" ? `${money(amount(plan))} ${pancake ? "before tax" : "paid once"}` : "One-time credit purchase"}</div><div className="plan-credit"><Coins size={16} /><strong>{number(planPurchase(plan, cycle).credits)}</strong> credits included</div>{cycle === "monthly" && totalPrice > 0 && planPurchase(plan, "yearly").available && <p className="pack-rate">Larger pack: {money(planPurchase(plan, "yearly").total)} for {number(planPurchase(plan, "yearly").credits)} credits, paid once.</p>}{creditCount > 0 && totalPrice > 0 && <p className="pack-rate">{money(totalPrice / creditCount * 100)} per 100 credits. Actual request costs depend on model settings; see examples below.</p>}<ul>{(features?.length ? features : ["Create with available AI models", "Keep your results in your library", "Use your credits in the studio and API", "Track costs and request history"]).map((item) => <li key={item}><Check size={14} />{item}</li>)}</ul>{!plan.hideCta && <button className={`button ${plan.featured ? "primary" : ""}`} disabled={livePlans.loading || !planPurchase(plan, cycle).available || (amount(plan) > 0 && !paymentMethods.length)} onClick={() => choose(plan)}>{!planPurchase(plan, cycle).available ? "Larger pack unavailable" : amount(plan) ? paymentMethods.length ? (user && plan.vipLevel > 0 && (user.vipLevel || 0) >= plan.vipLevel ? "Buy more credits" : "Choose this plan") : "Checkout unavailable" : "Start creating"}<ArrowUpRight size={15} /></button>}</article>; })}</div><p className="pricing-footnote">All plan prices are in USD. Any applicable taxes and the final total are shown at checkout before payment.  Every purchase is a one-time payment with no automatic renewal. {hasLargePack && "The 12× option adds twelve times the standard paid pack’s credits in a single purchase. "} Existing account benefits are not downgraded when you buy a smaller pack.</p>{!channels.loading && paymentMethods.length === 0 && <p className="pricing-footnote">Online checkout is currently unavailable. Existing credits can still be used. For purchasing help, <SupportLink />.</p>}<section className="pricing-examples" aria-labelledby="credit-examples-title"><h2 id="credit-examples-title">What can you create with your credits?</h2><p>These examples use current model prices and the settings shown. They are estimates, not a promise of how many outputs every pack will produce. Review your request estimate in Studio before generating.</p>{examples.length ? <div className="table-wrap"><table><caption className="sr-only">Example credit costs for current models</caption><thead><tr><th scope="col">Model</th><th scope="col">Example settings</th><th scope="col">Estimated credits</th></tr></thead><tbody>{examples.map(example => <tr key={example.id}><th scope="row"><Link className="text-link" href={`/studio?type=${example.type}&model=${encodeURIComponent(example.modelKey)}`}>{modelName(example)}</Link></th><td>{example.settings}</td><td>{number(example.credits)} {example.credits === 1 ? "credit" : "credits"}</td></tr>)}</tbody></table></div> : <p>Model credit estimates could not be loaded. <Link className="text-link" href="/models">Browse the model catalogue</Link> and check the estimate in Studio.</p>}<p>Higher resolution, longer videos, multiple images and reference inputs can change the cost. Video enhancement is quoted from your source video&apos;s duration and selected settings in Studio.</p></section>{!!compare.data?.rows.length && englishPlans.length > 0 && <section className="pricing-comparison"><h2 id="plan-comparison-title">Compare plans</h2><div className="table-wrap"><table aria-labelledby="plan-comparison-title"><thead><tr><th>Included</th>{englishPlans.map((plan) => <th key={plan.id}>{englishLabel(plan.name, "Plan")}</th>)}</tr></thead><tbody>{compare.data.rows.map((row, index) => <tr key={`${row.label}-${index}`}><th scope="row">{row.label}</th>{englishPlans.map((plan) => <td key={plan.id}>{row.values[plan.id] || "—"}</td>)}</tr>)}</tbody></table></div></section>}<p className="pricing-footnote">Before purchasing, read our <Link className="text-link" href="/refunds">refund policy</Link> and <Link className="text-link" href="/aup">acceptable use policy</Link>.</p><ConsumerPolicies initialInfo={initialInfo} fields={["creditValidity", "membershipTerms", "refundTiming", "commercialUse"]} /><section className="faq"><h2>A few things you might be wondering.</h2>{faqItems.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={17} /></summary><p>{answer}</p></details>)}</section></div>{selected && <Modal title="Confirm your purchase" size="form" busy={busy} busyLabel="Preparing secure checkout. Please wait for confirmation before closing." description="Review the amount and included credits. This is a single payment with no automatic renewal." onClose={() => setSelected(null)} footer={<><button className="button" data-modal-autofocus disabled={busy} onClick={() => setSelected(null)}>Not now</button><button className="button primary" disabled={busy || !paymentMethods.length} onClick={() => void checkout()}>{busy ? "Preparing checkout…" : "Continue to checkout"}<ArrowUpRight size={15} /></button></>}>
      <div className="invoice-rows"><div><span>Plan</span><strong>{englishLabel(selected.name, "Credit plan")}</strong></div><div><span>Payment</span><strong>One-time · No automatic renewal</strong></div><div><span>Purchase option</span><strong>{cycle === "yearly" ? "Large credit pack (12×)" : "Standard credit pack"}</strong></div><div><span>Credits included</span><strong>{number(planPurchase(selected, cycle).credits)}</strong></div><div><span>{pancake ? "Subtotal before tax" : "Total due"}</span><strong>{money(amount(selected))}</strong></div></div>
      {channels.loading ? <Loading label="Checking payment options…" /> : channels.error ? <Alert>{channels.error}</Alert> : paymentMethods.length ? <p className="secure-checkout-note">Secure payment through {providerName}. You will choose an available payment method on its checkout page. {pancake && "Applicable taxes are added at checkout. You will see the final total before paying. Checkout opens in a new tab from your order page."}</p> : <Alert>Online checkout is currently unavailable. <SupportLink /></Alert>}
      {error && <Alert>{error} <Link className="text-link" href="/account?tab=orders">Check order history</Link></Alert>}
    </Modal>}</PublicPage>;
}
