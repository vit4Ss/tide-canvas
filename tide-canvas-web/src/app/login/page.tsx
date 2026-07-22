"use client";

/* ============================================================================
   /login — standalone full-screen auth page (login / register).

   Ported from design-ref/登录注册.html: 登录/注册 tabs; email-only; login
   submodes 密码登录 / 邮箱验证码; register = email + code + password + 同意条款;
   inline validation, 60s code countdown, password show/hide, 记住我.

   This page has its OWN chrome (it is NOT under (site)/(studio)/(canvas)). It
   imports the liuguang flux tokens and layers its design-specific styles
   from ./login.css.

   Submit wiring goes through the auth store:
     · 密码登录       → login({ account: email, password })
     · 邮箱验证码登录 → loginCode({ email, code })
     · 注册           → register(...) then auto login(...) to get a session
     · 获取验证码     → authApi.emailCode({ email }) + start 60s countdown
   On success: redirect to ?redirect= if present, else /studio.
   ========================================================================== */

import "@/styles/liuguang/flux.css";
import "@/styles/liuguang/imini-theme.css"; // 正式主题（body.imini 由根布局直出）
import "./login.css";

import { Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/flux/atoms";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api";
import { communityApi } from "@/lib/community-api";
import { useAuthStore } from "@/stores/use-auth-store";

type Mode = "login" | "register" | "reset";
type SubMode = "pwd" | "code";
/** 注册子模式：用户名注册(免邮箱) / 邮箱注册 */
type RegMode = "user" | "email";
type FieldKey = "email" | "code" | "pwd" | "account" | "username" | "pwd2";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// 用码点计数([...v])而非 UTF-16 长度(v.length)，与后端 rune 计数一致，避免星芒面字符(如 emoji)前端放行、后端 400。
const isPwd = (v: string) => [...v].length >= 8 && /[a-zA-Z]/.test(v) && /\d/.test(v);

/* ── 用户名注册的规范校验:与服务端 auth/local.go 逐条镜像(服务端权威) ── */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,19}$/;
const RESERVED_USERNAMES = new Set([
  "root", "system", "api", "support", "service", "operator", "moderator",
  "superuser", "guest", "test", "user", "users", "null", "undefined",
  "anonymous", "flowinglight", "liuguang", "kefu", "customer",
]);
/** 用户名不合规时返回提示文案，合规返回 null */
const usernameIssue = (v: string): string | null => {
  if (!USERNAME_RE.test(v)) return "用户名需 4-20 位，以字母开头，仅可包含字母、数字和下划线";
  const lower = v.toLowerCase();
  if (RESERVED_USERNAMES.has(lower) || lower.startsWith("admin") || lower.startsWith("official")) {
    return "该用户名为系统保留，请更换";
  }
  return null;
};

const COMMON_PWDS = new Set([
  "password", "password1", "password123", "passw0rd", "p@ssw0rd", "p@ssword1",
  "12345678", "123456789", "1234567890", "87654321",
  "qwerty123", "qwertyuiop", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "qazwsxedc",
  "q1w2e3r4", "1234qwer", "qwer1234", "123qweasd", "asd123456",
  "abc12345", "abcd1234", "asdf1234", "zxcvbnm123", "a1b2c3d4",
  "admin123", "admin@123", "root1234", "root@123", "letmein123",
  "iloveyou", "iloveyou1", "welcome123", "monkey123", "dragon123",
  "woaini520", "woaini1314", "wang123456", "aa123456", "abc123456",
  "a12345678", "12345678a", "123456aa", "5201314520", "1314520520",
  "11111111", "00000000", "66666666", "88888888", "aaaa1111",
]);

/** 严格密码策略的实时清单(用户名注册用)：每条 [文案, 是否通过] */
function pwdRuleChecks(pw: string, uname: string): { label: string; ok: boolean }[] {
  const runes = [...pw].length;
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) +
    (/\d/.test(pw) ? 1 : 0) + (/[^a-zA-Z0-9\s]/.test(pw) ? 1 : 0);
  const lower = pw.toLowerCase();
  return [
    { label: "长度 8-64 位", ok: runes >= 8 && runes <= 64 && new TextEncoder().encode(pw).length <= 72 },
    { label: "大写字母 / 小写字母 / 数字 / 符号，至少包含三类", ok: classes >= 3 },
    {
      label: "不含空格，不包含用户名",
      ok: pw !== "" && !/\s/.test(pw) && (uname === "" || !lower.includes(uname.toLowerCase())),
    },
    { label: "不是常见弱密码", ok: pw !== "" && !COMMON_PWDS.has(lower) },
  ];
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/studio";

  const login = useAuthStore((s) => s.login);
  const loginCode = useAuthStore((s) => s.loginCode);
  const register = useAuthStore((s) => s.register);
  const registerLocal = useAuthStore((s) => s.registerLocal);
  const resetPassword = authApi.resetPassword;

  const [mode, setMode] = useState<Mode>("login");
  const [subMode, setSubMode] = useState<SubMode>("pwd");
  const [regMode, setRegMode] = useState<RegMode>("user");

  const [email, setEmail] = useState("");
  // 密码登录的账号(用户名或邮箱)与邮箱字段分离,避免验证码/注册流程串味
  const [account, setAccount] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
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

  // 侧栏 =「美术馆入口」：正在展出的社区热门作品全幅铺底轮展 + 底部铭牌
  // （延续作品广场的展厅身份）。公开接口，未登录可取；无数据时回退品牌陈述版。
  const [feats, setFeats] = useState<
    { cover: string; title: string; author: string; model: string }[]
  >([]);
  const [fi, setFi] = useState(0);
  useEffect(() => {
    let alive = true;
    communityApi
      .list({ pageNum: 1, pageSize: 12, sort: "hot" })
      .then((res) => {
        if (!alive || !res.success || !res.data) return;
        const works = res.data.records
          .filter((p) => p.cover || p.thumbnail)
          .slice(0, 5)
          .map((p) => ({
            cover: p.cover || p.thumbnail || "",
            title: p.title || "未命名作品",
            author: p.author?.name || "创作者",
            model: p.model || "",
          }));
        if (works.length) setFeats(works);
      })
      .catch(() => {
        /* 拉取失败回退品牌陈述版 */
      });
    return () => {
      alive = false;
    };
  }, []);
  // 轮展：8s 一换，交叉淡入（与作品广场展厅同语言）
  useEffect(() => {
    if (feats.length < 2) return;
    const id = setInterval(() => setFi((i) => (i + 1) % feats.length), 8000);
    return () => clearInterval(id);
  }, [feats.length]);

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
    // 清空跨模式残留输入，避免登录/注册/重置之间的数据串味与误提交。
    setCode("");
    setPwd("");
    setPwd2("");
    setUsername("");
    setShowPwd(false);
    setAgree(false);
  };

  const switchSub = (next: SubMode) => {
    setSubMode(next);
    clearErrors();
  };

  const switchReg = (next: RegMode) => {
    setRegMode(next);
    clearErrors();
    setPwd("");
    setPwd2("");
  };

  // field visibility. 登录+密码 = 账号(用户名/邮箱);验证码登录/邮箱注册/重置 = 邮箱;
  // 用户名注册 = 用户名 + 密码 + 确认密码(无邮箱、无验证码)。
  const isLocalReg = mode === "register" && regMode === "user";
  const showAccountField = mode === "login" && subMode === "pwd";
  const showUsernameField = isLocalReg;
  const showEmailField =
    mode === "reset" || (mode === "login" && subMode === "code") || (mode === "register" && regMode === "email");
  const showCodeField =
    mode === "reset" || (mode === "login" && subMode === "code") || (mode === "register" && regMode === "email");
  const showPwdField =
    mode === "register" || mode === "reset" || (mode === "login" && subMode === "pwd");

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

    // ── 用户名注册(免邮箱)：独立校验与提交路径，规范与服务端逐条镜像 ──
    if (isLocalReg) {
      const u = username.trim();
      const nextErrors: Partial<Record<FieldKey, string>> = {};
      const uIssue = usernameIssue(u);
      if (uIssue) nextErrors.username = uIssue;
      if (pwdRuleChecks(pwd, u).some((r) => !r.ok))
        nextErrors.pwd = "密码不符合安全要求，请对照下方规则调整";
      if (pwd2 !== pwd) nextErrors.pwd2 = "两次输入的密码不一致";
      if (Object.keys(nextErrors).length) {
        setErrors(nextErrors);
        return;
      }
      if (!agree) {
        toast("请先同意服务条款与隐私政策");
        return;
      }
      setLoading(true);
      try {
        // 注册即登录：后端直接返回会话
        await registerLocal({ username: u, password: pwd });
        toast("账户已创建 · 正在进入创作台");
        router.replace(redirect);
      } catch (err) {
        const raw = err instanceof Error ? err.message : "注册失败，请稍后重试";
        // 注册限速(5 次/10 分钟/IP)触发时给可读的中文提示,而非透传英文错误
        const msg = /too many|429|频繁/i.test(raw) ? "尝试过于频繁，请 10 分钟后再试" : raw;
        if (/用户名|username/i.test(msg)) setErr("username", msg);
        else setErr("pwd", msg);
        toast(msg);
      } finally {
        setLoading(false);
      }
      return;
    }

    const e = email.trim();
    const acc = account.trim();
    const needCode = showCodeField;
    const needPwd = showPwdField;

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (showAccountField && !acc) nextErrors.account = "请输入用户名或邮箱";
    if (showEmailField && !isEmail(e)) nextErrors.email = "请输入有效的邮箱地址";
    // 验证码长度不写死 6：后端已改为由 verifyEmailCode 依配置(Email.CodeLength)权威校验，
    // 前端只要求「非空数字」即可，避免非默认长度时把合法验证码在客户端拦下。
    if (needCode && !/^\d+$/.test(code.trim())) nextErrors.code = "请输入收到的验证码";
    if (needPwd && !isPwd(pwd)) nextErrors.pwd = "密码至少 8 位，包含字母与数字";
    // bcrypt 上限 72 字节：多字节(如中文)口令可能字符数合规但字节超限，前端先拦并给准确提示。
    else if (needPwd && new TextEncoder().encode(pwd).length > 72)
      nextErrors.pwd = "密码过长，请控制在约 72 字节(约 24 个中文字符)以内";
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
      if (mode === "reset") {
        // 忘记密码：邮箱验证码 + 新密码 → 重置后自动登录进入创作台
        const res = await resetPassword({ email: e, code: code.trim(), newPassword: pwd });
        if (!res.success) throw new Error(res.message || "重置失败，请稍后重试");
        // 重置已成功；自动登录失败不应报成「重置失败」，改为引导手动登录。
        try {
          await login({ account: e, password: pwd, rememberMe: remember });
        } catch {
          toast("密码已重置，请使用新密码登录");
          setMode("login");
          setPwd("");
          return;
        }
        toast("密码已重置 · 正在进入创作台");
      } else if (mode === "register") {
        await register({ email: e, code: code.trim(), password: pwd });
        // 注册成功后自动登录拿会话
        await login({ account: e, password: pwd, rememberMe: remember });
        toast("账户已创建 · 正在进入创作台");
      } else if (subMode === "code") {
        await loginCode({ email: e, code: code.trim() });
        toast("登录成功 · 正在进入创作台");
      } else {
        // 密码登录：账号可为用户名或邮箱（服务端 findByAccount 两者皆认）
        await login({ account: acc, password: pwd, rememberMe: remember });
        toast("登录成功 · 正在进入创作台");
      }
      // success → honor ?redirect= (else /studio)
      router.replace(redirect);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "操作失败，请稍后重试";
      // 按内容而非仅按模式定向内联错误：密码类错误统一落到 pwd 字段(register/reset 都有该字段)，
      // 验证码类落到 code，否则按模式回退。避免把「密码过长/过弱」显示在邮箱/验证码下方误导用户。
      const isPwdErr = /password|密码/i.test(msg);
      const isCodeErr = /\bcode\b|验证码/i.test(msg);
      if (needPwd && isPwdErr) {
        setErr("pwd", msg);
      } else if (needCode && isCodeErr) {
        setErr("code", msg);
      } else if (mode === "register") {
        setErr("email", msg);
      } else if (mode === "reset") {
        setErr("code", msg);
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

  const title = mode === "login" ? "欢迎回来" : mode === "register" ? "创建账户" : "重置密码";
  const sub =
    mode === "login"
      ? "登录你的 流光 FlowingLight 账户，继续创作。"
      : mode === "register"
        ? "注册即送新手体验积分，无需绑定信用卡。"
        : "输入邮箱获取验证码，即可设置新密码。";
  const submitLabel = mode === "login" ? "登 录" : mode === "register" ? "创建账户" : "重置密码";

  return (
    <div className="auth-page" data-mode={mode}>
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
          {/* left =「美术馆入口」：正在展出的真实作品全幅铺底，底部作品铭牌 */}
          <aside className="auth-aside">
            <div className="auth-wall" aria-hidden>
              {feats.map((f, i) => (
                <div
                  key={f.cover}
                  className={`auth-wall-img${i === fi ? " on" : ""}`}
                  style={{ backgroundImage: `url("${f.cover}")` }}
                />
              ))}
              <div className="auth-scrim" />
            </div>
            <div className="auth-aside-top">
              <Logo size={26} />
              FLOWING<b>LIGHT</b>
            </div>
            {feats.length > 0 ? (
              <div className="auth-plaque">
                <span className="eyebrow">
                  <span className="d" />
                  正在展出 · {String(fi + 1).padStart(2, "0")} / {String(feats.length).padStart(2, "0")}
                </span>
                <h2>《{feats[fi].title}》</h2>
                <p className="by">
                  {feats[fi].author}
                  {feats[fi].model ? ` · ${feats[fi].model}` : ""}
                </p>
                <p className="note">来自作品广场的社区创作。登录后可收藏、生成同款，并领取新手体验积分。</p>
              </div>
            ) : (
              <div className="auth-aside-head">
                <span className="eyebrow">
                  <span className="d" />智绘社区 · FLOWINGLIGHT
                </span>
                <h2>
                  一句话，
                  <br />
                  生成万象。
                </h2>
                <p>登录即可保存作品、调用海量模型，并领取新手体验积分。</p>
              </div>
            )}
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
              <span className="ic">{isLocalReg ? "!" : "✉"}</span>
              {isLocalReg ? (
                <span>
                  用户名账号<b style={{ color: "var(--text)" }}>不绑定邮箱</b>
                  ，忘记密码将无法自助找回，请务必牢记密码。
                </span>
              ) : (
                <span>
                  支持<b style={{ color: "var(--text)" }}> 邮箱 </b>或
                  <b style={{ color: "var(--text)" }}> 用户名密码 </b>
                  登录注册，其它方式即将开放。
                </span>
              )}
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

            {/* register: username / email segmented */}
            <div className={`submode${mode === "register" ? " show" : ""}`} data-only="register">
              <button
                className={regMode === "user" ? "on" : ""}
                type="button"
                onClick={() => switchReg("user")}
              >
                用户名注册
              </button>
              <button
                className={regMode === "email" ? "on" : ""}
                type="button"
                onClick={() => switchReg("email")}
              >
                邮箱注册
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate>
              {/* account（密码登录：用户名或邮箱） */}
              {showAccountField && (
                <div className="field">
                  <label htmlFor="account">用户名 / 邮箱</label>
                  <div className={`inp${errors.account ? " bad" : ""}`}>
                    <span className="lic">
                      <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="8.2" r="3.6" />
                        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
                      </svg>
                    </span>
                    <input
                      id="account"
                      type="text"
                      autoComplete="username"
                      placeholder="用户名或邮箱"
                      value={account}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setAccount(v);
                        if (v.trim()) clearErr("account");
                      }}
                    />
                  </div>
                  <div className={`err${errors.account ? " show" : ""}`}>
                    {errors.account || "请输入用户名或邮箱"}
                  </div>
                </div>
              )}

              {/* username（用户名注册） */}
              {showUsernameField && (
                <div className="field">
                  <label htmlFor="username">用户名</label>
                  <div
                    className={`inp${
                      errors.username ? " bad" : username && !usernameIssue(username.trim()) ? " ok" : ""
                    }`}
                  >
                    <span className="lic">
                      <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="8.2" r="3.6" />
                        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
                      </svg>
                    </span>
                    <input
                      id="username"
                      type="text"
                      autoComplete="username"
                      maxLength={20}
                      placeholder="4-20 位，字母开头"
                      value={username}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setUsername(v);
                        if (!usernameIssue(v.trim())) clearErr("username");
                      }}
                    />
                  </div>
                  <div className={`err${errors.username ? " show" : ""}`}>
                    {errors.username || "4-20 位，以字母开头，仅可包含字母、数字和下划线"}
                  </div>
                </div>
              )}

              {/* email */}
              {showEmailField && (
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
              )}

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
                      maxLength={12}
                      autoComplete="one-time-code"
                      placeholder="验证码"
                      value={code}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setCode(v);
                        if (/^\d+$/.test(v.trim())) clearErr("code");
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
                    {errors.code || "请输入收到的验证码"}
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
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      placeholder={
                        isLocalReg
                          ? "设置密码（按下方规则）"
                          : mode === "register"
                            ? "设置密码（至少 8 位）"
                            : mode === "reset"
                              ? "设置新密码（至少 8 位）"
                              : "请输入密码"
                      }
                      value={pwd}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setPwd(v);
                        if (isLocalReg ? pwdRuleChecks(v, username.trim()).every((r) => r.ok) : isPwd(v))
                          clearErr("pwd");
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
                    {errors.pwd || (isLocalReg ? "请按下方规则设置密码" : "密码至少 8 位，包含字母与数字")}
                  </div>
                  {/* 用户名注册：安全规则实时清单（与服务端策略逐条镜像） */}
                  {isLocalReg && (
                    <ul className="pwd-rules">
                      {pwdRuleChecks(pwd, username.trim()).map((r) => (
                        <li key={r.label} className={r.ok ? "ok" : ""}>
                          <span className="dot">✓</span>
                          {r.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* confirm password（用户名注册：无邮箱可找回，双输防手滑锁死账号） */}
              {isLocalReg && (
                <div className="field">
                  <label htmlFor="pwd2">确认密码</label>
                  <div className={`inp${errors.pwd2 ? " bad" : pwd2 && pwd2 === pwd ? " ok" : ""}`}>
                    <span className="lic">
                      <svg viewBox="0 0 24 24">
                        <rect x="4" y="10" width="16" height="11" rx="2.5" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                      </svg>
                    </span>
                    <input
                      id="pwd2"
                      type={showPwd ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="再次输入密码"
                      value={pwd2}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setPwd2(v);
                        if (v === pwd) clearErr("pwd2");
                      }}
                    />
                  </div>
                  <div className={`err${errors.pwd2 ? " show" : ""}`}>
                    {errors.pwd2 || "两次输入需一致"}
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
                    onClick={() => switchMode("reset")}
                  >
                    忘记密码？
                  </button>
                </div>
              )}

              {/* reset: back to login */}
              {mode === "reset" && (
                <div className="row-between" data-only="reset">
                  <span style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>
                    通过邮箱验证码验证身份后设置新密码（用户名账号未绑定邮箱，无法自助找回）
                  </span>
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => switchMode("login")}
                  >
                    ← 返回登录
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
                <Link href="/terms" target="_blank">
                  服务条款
                </Link>{" "}
                与{" "}
                <Link href="/privacy" target="_blank">
                  隐私政策
                </Link>
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
