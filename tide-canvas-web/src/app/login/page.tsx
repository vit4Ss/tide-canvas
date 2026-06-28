"use client";

/* ============================================================================
   /login — standalone full-screen auth page (login / register).

   Ported from design-ref/登录注册.html: 登录/注册 tabs; email-only; login
   submodes 密码登录 / 邮箱验证码; register = email + code + password + 同意条款;
   inline validation, 60s code countdown, password show/hide, 记住我.

   This page has its OWN chrome (it is NOT under (site)/(studio)/(canvas)). It
   imports the liuguang flux tokens + paints the WebGL backdrop via <FluxField/>,
   and layers its design-specific styles from ./login.css.

   Submit wiring goes through the auth store:
     · 密码登录       → login({ account: email, password })
     · 邮箱验证码登录 → loginCode({ email, code })
     · 注册           → register(...) then auto login(...) to get a session
     · 获取验证码     → authApi.emailCode({ email }) + start 60s countdown
   On success: redirect to ?redirect= if present, else /studio.
   ========================================================================== */

import "@/styles/liuguang/flux.css";
import "./login.css";

import { Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/flux/atoms";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import FluxField from "@/components/flux/flux-field";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";

type Mode = "login" | "register";
type SubMode = "pwd" | "code";
type FieldKey = "email" | "code" | "pwd";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPwd = (v: string) => v.length >= 8 && /[a-zA-Z]/.test(v) && /\d/.test(v);

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/studio";

  const login = useAuthStore((s) => s.login);
  const loginCode = useAuthStore((s) => s.loginCode);
  const register = useAuthStore((s) => s.register);

  const [mode, setMode] = useState<Mode>("login");
  const [subMode, setSubMode] = useState<SubMode>("pwd");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [agree, setAgree] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);

  // toast (matches the design's standalone toast, scoped to this page)
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  };

  // reveal-scale entrance (parity with the design's setTimeout add('in'))
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 60);
    return () => clearTimeout(t);
  }, []);

  // 60s code countdown tick
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const setErr = (f: FieldKey, msg: string) => setErrors((e) => ({ ...e, [f]: msg }));
  const clearErr = (f: FieldKey) =>
    setErrors((e) => {
      if (!(f in e)) return e;
      const next = { ...e };
      delete next[f];
      return next;
    });
  const clearErrors = () => setErrors({});

  const switchMode = (next: Mode) => {
    setMode(next);
    clearErrors();
  };

  const switchSub = (next: SubMode) => {
    setSubMode(next);
    clearErrors();
  };

  // field visibility (mirrors syncFields)
  const showCodeField = mode === "register" || (mode === "login" && subMode === "code");
  const showPwdField = mode === "register" || (mode === "login" && subMode === "pwd");

  // ── 获取验证码 ──────────────────────────────────────────────
  const sendCode = async () => {
    if (countdown > 0) return;
    const e = email.trim();
    if (!isEmail(e)) {
      setErr("email", "请先输入有效的邮箱地址");
      return;
    }
    clearErr("email");
    try {
      const res = await authApi.emailCode({ email: e });
      if (res.success) {
        setCodeSent(true);
        setCountdown(60);
        toast("验证码已发送至 " + e);
      } else {
        toast(res.message || "验证码发送失败，请稍后重试");
      }
    } catch {
      toast("验证码发送失败，请稍后重试");
    }
  };

  // ── submit ──────────────────────────────────────────────────
  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (loading) return;

    const e = email.trim();
    const needCode = mode === "register" || (mode === "login" && subMode === "code");
    const needPwd = mode === "register" || (mode === "login" && subMode === "pwd");

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!isEmail(e)) nextErrors.email = "请输入有效的邮箱地址";
    if (needCode && code.trim().length !== 6) nextErrors.code = "请输入收到的 6 位验证码";
    if (needPwd && !isPwd(pwd)) nextErrors.pwd = "密码至少 8 位，包含字母与数字";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    if (mode === "register" && !agree) {
      toast("请先同意服务条款与隐私政策");
      return;
    }

    setLoading(true);
    try {
      if (mode === "register") {
        await register({ email: e, code: code.trim(), password: pwd });
        // 注册成功后自动登录拿会话
        await login({ account: e, password: pwd, rememberMe: remember });
        toast("账户已创建 · 正在进入创作台");
      } else if (subMode === "code") {
        await loginCode({ email: e, code: code.trim() });
        toast("登录成功 · 正在进入创作台");
      } else {
        await login({ account: e, password: pwd, rememberMe: remember });
        toast("登录成功 · 正在进入创作台");
      }
      // success → honor ?redirect= (else /studio)
      router.replace(redirect);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "操作失败，请稍后重试";
      // map backend message onto the most relevant inline error, plus a toast
      if (mode === "register") {
        setErr("email", msg);
      } else if (subMode === "code") {
        setErr("code", msg);
      } else {
        setErr("pwd", msg);
      }
      toast(msg);
    } finally {
      setLoading(false);
    }
  };

  const codeBtnLabel = countdown > 0 ? `${countdown} s` : codeSent ? "重新获取" : "获取验证码";

  const title = mode === "login" ? "欢迎回来" : "创建账户";
  const sub =
    mode === "login"
      ? "登录你的 流光 FlowingLight 账户，继续创作。"
      : "注册即送新手体验积分，无需绑定信用卡。";
  const submitLabel = mode === "login" ? "登 录" : "创建账户";

  return (
    <div className="auth-page" data-mode={mode}>
      <FluxField hue={0.2} speed={0.55} scale={0.9} intensity={1} flow={[0.02, -0.03]} variant={0} res={0.6} />

      <header className="auth-top">
        <Link className="brand" href="/">
          <Logo size={26} />
          FLOWING<b>LIGHT</b>
        </Link>
        <Link className="back" href="/">
          ← 返回首页
        </Link>
      </header>

      <div className="auth-stage">
        <div className={`auth-card reveal-scale${revealed ? " in" : ""}`}>
          {/* left showcase */}
          <aside className="auth-aside">
            <div className="glow" />
            <div className="glow b" />
            <div className="auth-aside-top">
              <Logo size={26} />
              FLOWING<b>LIGHT</b>
            </div>
            <div className="auth-aside-head">
              <span className="eyebrow">
                <span className="d" />智绘社区 · FLUX
              </span>
              <h2>
                一句话，
                <br />
                生成万象。
              </h2>
              <p>登录即可保存作品、调用海量模型，并领取新手体验积分。</p>
            </div>
            <div className="auth-tiles">
              <span className="t" />
              <span className="t" />
              <span className="t" />
            </div>
            <div className="auth-stats">
              <div className="s">
                <b>1.2M+</b>
                <span>每日生成</span>
              </div>
              <div className="s">
                <b>320+</b>
                <span>顶级模型</span>
              </div>
              <div className="s">
                <b>80K+</b>
                <span>创作者</span>
              </div>
            </div>
          </aside>

          {/* right form */}
          <main className="auth-main">
            <div className="auth-tabs" role="tablist">
              <button
                className={mode === "login" ? "on" : ""}
                type="button"
                onClick={() => switchMode("login")}
              >
                登录
              </button>
              <button
                className={mode === "register" ? "on" : ""}
                type="button"
                onClick={() => switchMode("register")}
              >
                注册
              </button>
            </div>

            <h1 className="auth-h">{title}</h1>
            <p className="auth-sub">{sub}</p>

            <div className="email-note">
              <span className="ic">✉</span>
              <span>
                目前仅支持<b style={{ color: "var(--text)" }}> 邮箱 </b>登录，其它登录方式即将开放。
              </span>
            </div>

            {/* login: password / code segmented */}
            <div className={`submode${mode === "login" ? " show" : ""}`} data-only="login">
              <button
                className={subMode === "pwd" ? "on" : ""}
                type="button"
                onClick={() => switchSub("pwd")}
              >
                密码登录
              </button>
              <button
                className={subMode === "code" ? "on" : ""}
                type="button"
                onClick={() => switchSub("code")}
              >
                邮箱验证码
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate>
              {/* email */}
              <div className="field">
                <label htmlFor="email">邮箱地址</label>
                <div className={`inp${errors.email ? " bad" : isEmail(email) ? " ok" : ""}`}>
                  <span className="lic">
                    <svg viewBox="0 0 24 24">
                      <rect x="3" y="5" width="18" height="14" rx="2.5" />
                      <path d="M3.5 7l8.5 6 8.5-6" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setEmail(v);
                      if (isEmail(v.trim())) clearErr("email");
                    }}
                  />
                </div>
                <div className={`err${errors.email ? " show" : ""}`}>
                  {errors.email || "请输入有效的邮箱地址"}
                </div>
              </div>

              {/* verification code */}
              {showCodeField && (
                <div className="field">
                  <label htmlFor="code">邮箱验证码</label>
                  <div className={`inp${errors.code ? " bad" : ""}`}>
                    <span className="lic">
                      <svg viewBox="0 0 24 24">
                        <path d="M9 12l2 2 4-4" />
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    </span>
                    <input
                      id="code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                      placeholder="6 位验证码"
                      value={code}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setCode(v);
                        if (v.trim().length === 6) clearErr("code");
                      }}
                    />
                    <button
                      className="code-btn"
                      type="button"
                      disabled={countdown > 0}
                      onClick={sendCode}
                    >
                      {codeBtnLabel}
                    </button>
                  </div>
                  <div className={`err${errors.code ? " show" : ""}`}>
                    {errors.code || "请输入收到的 6 位验证码"}
                  </div>
                </div>
              )}

              {/* password */}
              {showPwdField && (
                <div className="field">
                  <label htmlFor="pwd">密码</label>
                  <div className={`inp${errors.pwd ? " bad" : ""}`}>
                    <span className="lic">
                      <svg viewBox="0 0 24 24">
                        <rect x="4" y="10" width="16" height="11" rx="2.5" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                      </svg>
                    </span>
                    <input
                      id="pwd"
                      type={showPwd ? "text" : "password"}
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                      placeholder={mode === "register" ? "设置密码（至少 8 位）" : "请输入密码"}
                      value={pwd}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setPwd(v);
                        if (isPwd(v)) clearErr("pwd");
                      }}
                    />
                    <button
                      className="eye"
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPwd((s) => !s)}
                    >
                      {showPwd ? "隐藏" : "显示"}
                    </button>
                  </div>
                  <div className={`err${errors.pwd ? " show" : ""}`}>
                    {errors.pwd || "密码至少 8 位，包含字母与数字"}
                  </div>
                </div>
              )}

              {/* login row */}
              {mode === "login" && (
                <div className="row-between" data-only="login">
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(ev) => setRemember(ev.target.checked)}
                    />
                    <span className="box" />
                    记住我
                  </label>
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => toast("重置链接已发送至邮箱（原型）")}
                  >
                    忘记密码？
                  </button>
                </div>
              )}

              {/* register agree */}
              {mode === "register" && (
                <div className="row-between" data-only="register">
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={agree}
                      onChange={(ev) => setAgree(ev.target.checked)}
                    />
                    <span className="box" />
                    我已阅读并同意服务条款
                  </label>
                </div>
              )}

              <button className={`submit${loading ? " loading" : ""}`} type="submit">
                <span className="spin" />
                <span className="lbl">{submitLabel}</span>
              </button>
            </form>

            <div className="divider">其它方式</div>
            <div className="socials">
              <button className="soc" type="button" disabled>
                <svg viewBox="0 0 24 24" fill="#7aa6b8">
                  <path d="M8.7 7.4C5.3 7.4 2.5 9.7 2.5 12.6c0 1.6.9 3 2.4 4l-.6 1.8 2.1-1.1c.8.2 1.5.3 2.3.3h.6a3.9 3.9 0 0 1-.2-1.2c0-2.5 2.4-4.5 5.4-4.5h.5C14.8 9.2 12 7.4 8.7 7.4z" />
                  <circle cx="6.6" cy="11" r=".8" fill="#0a0c1c" />
                  <circle cx="10.8" cy="11" r=".8" fill="#0a0c1c" />
                  <path d="M21.5 16c0-2.3-2.2-4.1-4.9-4.1s-4.9 1.8-4.9 4.1 2.2 4.1 4.9 4.1c.6 0 1.1-.1 1.6-.2l1.7.9-.5-1.5c1.3-.8 2.1-2 2.1-3.3z" />
                </svg>
                微信<span className="soon">即将开放</span>
              </button>
              <button className="soc" type="button" disabled>
                <svg viewBox="0 0 24 24">
                  <path fill="#9aa3c2" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2z" />
                  <path fill="#9aa3c2" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
                  <path fill="#9aa3c2" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.6L6.4 14z" />
                  <path fill="#9aa3c2" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 12 2a10 10 0 0 0-8.9 5.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" />
                </svg>
                Google<span className="soon">即将开放</span>
              </button>
            </div>

            <p className="auth-foot">
              {mode === "login" ? "还没有账户？" : "已有账户？"}
              <button
                type="button"
                className="auth-link"
                onClick={() => switchMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login" ? "免费注册" : "直接登录"}
              </button>
            </p>
            {mode === "register" && (
              <p className="terms" data-only="register">
                注册即代表你同意我们的{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); toast("服务条款（原型）"); }}>
                  服务条款
                </a>{" "}
                与{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); toast("隐私政策（原型）"); }}>
                  隐私政策
                </a>
                。
              </p>
            )}
          </main>
        </div>
      </div>

      {/* toast */}
      <div className={`toast${toastMsg ? " show" : ""}`} role="status">
        <span className="ic">✦</span>
        {toastMsg}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
