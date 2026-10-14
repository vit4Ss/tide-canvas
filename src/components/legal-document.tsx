import Link from "next/link";
import { PublicPage } from "./shell";
import { ModelDisclosure } from "./model-disclosure";
import { getPublicConsumer, getPublicModels, getPublicSafety } from "@/lib/public-info.server";
import { getServerConfig } from "@/lib/server-config";
import { supportLink, type ConsumerInfo } from "@/lib/consumer";
import styles from "./legal-document.module.css";

export const WAFFO_BUYER_TERMS = "https://www.waffo.ai/en/buyer-terms";
type Kind = "terms" | "privacy" | "refunds" | "aup";
function Contact({ email, reference, children }: { email: string; reference?: string; children?: React.ReactNode }) {
  return <a href={supportLink(email,reference)}>{children || email}</a>;
}

function RefundPolicy({ email }: { email: string }) {
  return <section id="refunds">
    <h2>Payments, cancellations and refunds</h2>
    <p>Credit packs are one-time purchases. They do not renew automatically; the larger pack is not an annual subscription. Pack prices are in USD. Applicable taxes are shown at checkout before payment. Credits are added after payment is confirmed.</p>
    <h3>Purchases processed by Waffo Pancake</h3>
    <p>Waffo.com Limited acts as the merchant of record for Waffo-processed purchases. Refunds follow its <a href={WAFFO_BUYER_TERMS}>Buyer Terms and Conditions</a>, including sections 9 and 13 and the defined Refund Request Period. Those transaction terms and any mandatory consumer rights apply.</p>
    <ul>
      <li><strong>Request window:</strong> Waffo&apos;s published terms allow a request within 120 days of product delivery. This is an application window, not an unconditional money-back guarantee.</li>
      <li><strong>Eligibility:</strong> Waffo reviews requests, including defective or misdescribed services, unauthorized or erroneous transactions, access failures attributable to the service, and refunds required by law.</li>
      <li><strong>Unused or consumed credits:</strong> usage and delivery records may inform the review. An unused balance does not itself guarantee a refund; using credits does not remove rights that cannot legally be waived.</li>
      <li><strong>Processing:</strong> Waffo&apos;s terms provide for returning approved refunds to the original payment method within 14 business days of approval. Framelyn does not add a separate guaranteed approval or bank-arrival deadline.</li>
    </ul>
    <h3>How to request a refund</h3>
    <p>Use the Buyer Portal link in your Waffo receipt, or contact Waffo through the support details in its Buyer Terms. For help locating your order or explaining a service issue, email <Contact email={email} reference="Payment refund request" /> with your account email, order number, purchase date and reason. Do not send card details, passwords or API keys.</p>
    <p>The request may require additional information and a decision before any refund is issued. Full and partial refunds are possible when approved. The corresponding credit allowance is adjusted after a confirmed refund; refunded credits cannot be spent again. If your receipt names another payment processor, contact us for the process applicable to that order.</p>
    <h3>Unpaid orders and generation credits</h3>
    <p>Closing checkout is not a cash refund. If a payment is already processing or its result is uncertain, check the existing order or contact support before paying again. There is no recurring subscription to cancel.</p>
    <p>Generation credit returns are separate from payment refunds. Confirmed generation failures are eligible for credit-refund processing. Queued task cancellations may return credits; cancellation after provider processing begins is charged. A network timeout does not establish failure. Review charged and refunded credits in <Link href="/usage">Usage &amp; credits</Link> and report any discrepancy with its task reference.</p>
  </section>;
}

function AcceptableUse({ email, screening }: { email: string; screening: boolean }) {
  return <section id="acceptable-use">
    <h2>Acceptable use and content standards</h2>
    <p>This policy covers prompts, uploaded references, generated outputs, API requests and any content you share through the service. You must have the rights and permissions needed for your inputs and intended use of outputs. Changing models or using the API does not exempt you from these rules.</p>
    <h3>Prohibited content</h3>
    <ul>
      <li><strong>Pornography and NSFW content:</strong> sexually explicit material, sexualized nudity, fetish content and pornographic services.</li>
      <li><strong>Violence and gore:</strong> graphic injury, dismemberment, torture, or material that encourages or glorifies violence or physical harm.</li>
      <li><strong>Hate speech:</strong> content that promotes hatred, dehumanization, discrimination or violence against people based on protected characteristics.</li>
      <li><strong>Child-unsafe content and CSAM:</strong> sexualization, exploitation or abuse of minors, grooming, or attempts to create or distribute child sexual abuse material, including synthetic content.</li>
      <li><strong>Deepfakes and impersonation:</strong> face swaps, voice cloning, deceptive impersonation, or synthetic material falsely presenting an identifiable person as having said or done something.</li>
      <li><strong>Copyright and trademark infringement:</strong> unauthorized use of protected work or branding, counterfeit material, or content that falsely suggests endorsement or affiliation.</li>
    </ul>
    <p>Fraud, harassment, privacy violations, bypassing safety restrictions, unauthorized access and abuse of trial or credit systems are also prohibited. Provider-specific restrictions continue to apply to the model you choose.</p>
    <h3 id="moderation">How content is reviewed</h3>
    <p>Model providers may reject prompts, reference files or results under their safety rules. Framelyn records task outcomes and surfaces those rejections to the user. Reports of misuse can be reviewed against the relevant request and account records.</p>
    {screening ? <p>Server-side prompt screening is enabled for media generation through Studio and the API. User-written prompts and supported text instructions are sent to Waffo Pancake Prompt Sift before generation credits are charged. Only an allow decision proceeds; blocked, review-required or unavailable checks stop the request without starting generation. Decision receipts retain a keyed text digest and a check reference, not a separate copy of the prompt. This checks text only: independent review of uploaded images, videos and every generated result before delivery is not yet implemented.</p> : <p>At present, the service relies on provider-side safety responses and review of reported issues. Independent platform screening of every prompt and every generated image or video before delivery is not yet implemented. This policy does not represent a guarantee that every output has been pre-approved.</p>}
    <h3 id="report">Report content or appeal an action</h3>
    <p>Send a report to <Contact email={email} reference="Content safety report" />. Include the content URL or task ID, the concern, and relevant context or rights information. Use links or identifiers instead of attaching illegal material. Never include passwords, API keys or unnecessary sensitive information.</p>
    <p>Reports are routed to customer support for human review. We may request clarification, examine relevant records and take action based on the findings. For an appeal, email <Contact email={email} reference="Appeal of account or content action" /> with the affected account or task reference and the reason you believe the action was incorrect.</p>
    <h3 id="enforcement">Violations, restrictions and termination</h3>
    <p>Depending on the severity and available evidence, we may reject or stop a request, remove or restrict access to content, limit features or API access, suspend an account, or terminate service. Urgent protective action may precede a full review.</p>
    <p>Fraudulent credits, duplicate grants and credits associated with an approved refund may be reversed. Restrictions do not create an automatic right to confiscate all legitimately purchased unused credits. Payment disputes and any required refunds remain subject to the applicable payment terms and mandatory law.</p>
    <p>We may retain relevant records where needed to investigate abuse, resolve disputes or meet legal obligations, and respond to lawful requests. You remain responsible for your activity and for reviewing AI-generated work before publishing it.</p>
  </section>;
}

function PublishedConditions({ info }: { info: ConsumerInfo }) {
  const fields = [["commercialUse", "Commercial use"], ["creditValidity", "Credit validity"], ["membershipTerms", "Account benefits"]] as const;
  const published = fields.filter(([key]) => info[key]);
  return published.length ? <section><h2>Additional published conditions</h2>{published.map(([key,title]) => <div key={key}><h3>{title}</h3><p>{info[key]}</p></div>)}</section> : null;
}

function PrivacyContent({ screening, info }: { screening: boolean; info: ConsumerInfo }) {
  return <>
    <h2>Information used by the service</h2><p>Account information is used to authenticate you and associate your balance, files, tasks, API keys and orders with your account. Prompts, reference files and generation settings are sent to the service and its configured model providers to process the requests you submit.</p>
    <h2>Browser storage</h2><p>The website uses browser storage for your sign-in credentials, unresolved generation references, pending checkout references, saved inspiration and account-scoped studio drafts. Drafts remain in this browser tab for up to seven days and are not shared with other accounts. Generation recovery references help reconnect to the same request after a connection drops. API keys entered in the playground are held in memory for that page and are not saved to browser storage.</p>
    <section id="data-storage">
      <h2>Where your data is stored</h2>
      <p>Files uploaded to Framelyn and generation results that we save are stored in Alibaba Cloud Object Storage Service (OSS). File delivery may use a content delivery network (CDN). Our application servers process media for tasks such as validation, conversion and delivery; account, task, credit and order records are kept in the service database.</p>
      <p>The model providers selected for your requests receive the prompts, settings and reference files needed to generate results. Some results may initially be delivered through a provider-hosted link, which can expire under that provider&apos;s rules. Storage, content delivery and model processing can involve infrastructure outside your country of residence.</p>
      <h3>File links and sharing</h3>
      <p>Signing in protects account and file-management actions, but a media URL can be accessed by anyone who obtains it. Treat upload and output links as shareable links. Do not use them to distribute confidential material or assume that a link is restricted to your account.</p>
    </section>
    <section id="data-retention">
      <h2>File retention and deletion</h2>
      <p>{info.retention}</p>
      <p>Delete an uploaded file from <Link href="/library">Library → Uploaded files</Link> to remove its library record and request removal of the stored object. Removing a file does not automatically erase related task, billing or security records, or copies already downloaded or cached elsewhere. Removing the library entry does not guarantee that a previously shared URL stops working immediately.</p>
      <p>For deletion of generated results, account data or a link that remains accessible after removal, email <Contact email={info.supportEmail} reference="Privacy and deletion request" /> with the relevant account email and file or task reference. We may need to verify ownership before acting. Relevant transaction and security records may be retained to account for payments, resolve disputes or investigate misuse.</p>
    </section>
    <section id="data-security">
      <h2>How your information is protected</h2>
      <ul>
        <li><strong>Website connection:</strong> the production website uses HTTPS to protect traffic between your browser and the website.</li>
        <li><strong>Account credentials:</strong> passwords are stored as hashes, rather than readable passwords. Account API keys are encrypted in the service database and checked using a verification digest.</li>
        <li><strong>Access checks:</strong> account and file-management requests are authenticated and checked for ownership. Administrative operations require the applicable account permissions.</li>
      </ul>
      <p>Keep passwords, API keys and shared file links secure. To report suspected unauthorized access or a privacy concern, contact <Contact email={info.supportEmail} reference="Privacy or security concern" />. Do not include passwords or API keys in your message.</p>
    </section>
    {screening && <><h2>Prompt safety checks</h2><p>For media generation, prompts and supported text instructions are sent to Waffo Pancake to check content safety. Waffo describes the check as stateless and says it does not retain the prompt after returning a verdict. We retain decision receipts, a keyed prompt digest and request references for investigation and appeals. The original generation input remains subject to the task-record handling described above.</p></>}<h2>Payments</h2><p>Payment is completed through the payment methods offered at checkout. The service records the order, payment status and associated credit allowance. The frontend does not collect your payment account password.</p>
    <h2>Managing your information</h2><p>You can update your display name and password, disable or replace your API key, and remove uploaded files through the account and library interfaces. Visit <Link href="/help">Help</Link> for account requests that are not available through these controls.</p>
  </>;
}

export async function Legal({ kind }: { kind: Kind }) {
  const { publicConfig } = getServerConfig();
  const [info, models, screening] = await Promise.all([getPublicConsumer(), kind === "terms" ? getPublicModels() : Promise.resolve([]), getPublicSafety()]);
  const titles: Record<Kind,string> = {terms:"Terms of service.",privacy:"Your privacy.",refunds:"Refund policy.",aup:"Acceptable use."};
  const descriptions: Record<Kind,string> = { terms: `The terms, purchase rules and content standards for ${publicConfig.name}.`, privacy: "How information is used when you create and build with this service.", refunds: "Eligibility, request steps and payment refund processing.", aup: "What you may create, how to report concerns and how we respond." };
  return <PublicPage><div className={styles.headerWrap}><header className="public-title"><h1>{titles[kind]}</h1><p>{descriptions[kind]}</p></header></div>
    <article className={`article ${styles.document}`}>
      <nav className={styles.nav} aria-label="Policies"><Link href="/terms">Terms of service</Link><Link href="/refunds">Refunds</Link><Link href="/aup">Acceptable use</Link><Link href="/privacy">Privacy</Link><Link href="/models">Model catalogue</Link></nav>
      {kind === "privacy" ? <PrivacyContent screening={screening} info={info} /> : <>
        {kind === "terms" && <>
          <section id="account"><h2>Your account and the service</h2><p>These terms cover your use of {publicConfig.name}&apos;s creative tools, uploads, generated outputs and API access. Keep your credentials and API key secure. Account permissions, balances and limits apply to both Studio and API requests. You are responsible for activity authorized with your credentials.</p><p>Outputs are AI-generated, may contain errors and are not guaranteed to be unique or suitable for every use. Review them before publication. Rights to inputs and permitted uses of outputs depend on applicable law and the selected model&apos;s terms; a credit purchase does not grant rights to third-party material.</p></section>
          <section id="models"><h2>Underlying AI models</h2><ModelDisclosure models={models} /><Link href="/models">Browse the complete model catalogue</Link></section>
        </>}
        {(kind === "terms" || kind === "refunds") && <RefundPolicy email={info.supportEmail} />}
        {(kind === "terms" || kind === "aup") && <AcceptableUse email={info.supportEmail} screening={screening} />}
        {kind === "terms" && <PublishedConditions info={info} />}
      </>}
      <section id="contact"><h2>Contact</h2><p>For an account request, data request, billing question or content report, contact <Contact email={info.supportEmail} />. Include the relevant account, order or task reference. Download important work promptly, and review the published handling terms before uploading confidential material.</p></section>
      <p className={styles.updated}>Last updated October 14, 2026. For payment-specific rights, the payment terms accepted for your order and applicable law continue to apply.</p>
    </article>
  </PublicPage>;
}
