"use client";

/* ============================================================================
   LegalDoc — shared layout for static legal pages (服务条款 / 隐私政策) rendered
   inside the (site) route group (nav + footer + flux backdrop already provided).
   Renders a page hero + a prose card built from a section list, using the
   liuguang class names (.page-hero / .wrap / .block / .eyebrow) so the shared
   flux.css + pages.css apply unchanged.
   ========================================================================== */

export interface LegalSection {
  heading: string;
  /** Each string is one paragraph. */
  paragraphs: string[];
}

export default function LegalDoc({
  eyebrow,
  title,
  updated,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <div className="legal-page">
      <header className="page-hero" style={{ minHeight: 240 }}>
        <div className="ph-scrim" />
        <div className="wrap">
          <div className="page-head">
            <span className="eyebrow reveal in">
              <span className="d" />
              {eyebrow}
            </span>
            <h1 style={{ margin: "10px 0 6px", fontSize: "clamp(28px, 4vw, 44px)" }}>
              {title}
            </h1>
            <p style={{ color: "var(--text-faint)", fontSize: 13 }}>最后更新：{updated}</p>
          </div>
        </div>
      </header>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 860 }}>
          <div
            style={{
              padding: "clamp(20px, 3vw, 36px)",
              borderRadius: 18,
              background: "var(--surface, rgba(255,255,255,0.03))",
              border: "1px solid var(--border, rgba(255,255,255,0.08))",
              lineHeight: 1.85,
            }}
          >
            <p style={{ color: "var(--text-dim, #c3c8d6)", marginBottom: 28 }}>{intro}</p>

            {sections.map((s, i) => (
              <section key={i} style={{ marginBottom: 26 }}>
                <h2
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    margin: "0 0 10px",
                    color: "var(--text)",
                  }}
                >
                  {i + 1}. {s.heading}
                </h2>
                {s.paragraphs.map((p, j) => (
                  <p
                    key={j}
                    style={{
                      color: "var(--text-dim, #c3c8d6)",
                      fontSize: 14.5,
                      margin: "0 0 10px",
                    }}
                  >
                    {p}
                  </p>
                ))}
              </section>
            ))}

            <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 28 }}>
              如对本文档有任何疑问，请通过 ad@tcmzhan.com 与我们联系。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
