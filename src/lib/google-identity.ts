export interface GoogleIdentityService {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean; ux_mode: "popup" }): void;
  renderButton(element: HTMLElement, options: { theme: "outline"; size: "large"; text: "continue_with"; shape: "rectangular"; width: number; locale: "en" }): void;
  cancel(): void;
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentityService } } } }

let pending: Promise<GoogleIdentityService> | null = null;
export function loadGoogleIdentity(): Promise<GoogleIdentityService> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (pending) return pending;
  pending = new Promise<GoogleIdentityService>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client?hl=en";
    script.async = true;
    const timeout = window.setTimeout(() => fail(), 15_000);
    const fail = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Google could not load. Check your connection, or sign in with your password.")); };
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.google?.accounts.id) resolve(window.google.accounts.id);
      else fail();
    };
    document.head.appendChild(script);
  }).catch((error) => { pending = null; throw error; });
  return pending;
}
