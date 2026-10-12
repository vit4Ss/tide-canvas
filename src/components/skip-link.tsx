"use client";

export function SkipLink() {
  return <a className="skip-link" href="#main-content" onClick={(event) => {
    // Auth screens use the root container; other pages have a real main region.
    const content = document.querySelector("main") || document.getElementById("main-content");
    if (!content) return;
    event.preventDefault();
    content.tabIndex = -1;
    content.focus();
  }}>Skip to content</a>;
}
