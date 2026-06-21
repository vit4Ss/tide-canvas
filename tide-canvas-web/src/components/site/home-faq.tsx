"use client";

/* ============================================================================
   HomeFaq — React port of renderFaq() from design-ref/liuguang/home-render.js.
   Single-open accordion over FAQS. Uses the liuguang .faq / .faq-item[.open] /
   .faq-q / .faq-ic / .faq-a / .faq-a-in classes; the open item's answer is
   height-animated via inline maxHeight (matching the design's setH()).
   First item starts open.
   ========================================================================== */

import { useState } from "react";
import { FAQS } from "@/mock";

export default function HomeFaq() {
  const [open, setOpen] = useState(0); // -1 = none

  return (
    <div className="faq" id="faq">
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div
            key={f.q}
            className={`faq-item reveal${isOpen ? " open" : ""}`}
            style={{ ["--rd" as string]: `${(i % 4) * 0.04}s` }}
          >
            <button
              type="button"
              className="faq-q"
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <span>{f.q}</span>
              <span className="faq-ic">+</span>
            </button>
            <div
              className="faq-a"
              style={{ maxHeight: isOpen ? "400px" : "0px" }}
            >
              <div className="faq-a-in">{f.a}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
