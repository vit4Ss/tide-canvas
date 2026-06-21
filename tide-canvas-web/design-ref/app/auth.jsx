/* global React, Icon, Logo */
// SCARECROWAI — Auth modal: login + register
const { createElement: a, useState: aS, useEffect: aE, useRef: aR } = React;

const T = {
  cn: {
    login: '登录', register: '注册', or: '或',
    email: '邮箱地址', pw: '密码', pw2: '确认密码', name: '用户名',
    forgot: '忘记密码？', loginBtn: '登录', registerBtn: '创建账号',
    toRegister: '没有账号？立即注册', toLogin: '已有账号？直接登录',
    google: '使用 Google 继续', github: '使用 GitHub 继续',
    agree: '创建账号即表示你同意',
    terms: '服务条款', and: '和', privacy: '隐私政策',
    namePh: '你的昵称', emailPh: 'name@example.com', pwPh: '至少 8 位密码',
    pw2Ph: '再次输入密码',
    errEmail: '请输入有效的邮箱地址', errPw: '密码至少 8 位', errPw2: '两次密码不一致', errName: '用户名不能为空',
    success: '注册成功，正在跳转…', loginSuccess: '登录成功！',
    free: '注册即赠 500 积分',
    welcome: '欢迎回来',
    welcomeSub: '登录后享受全部 AI 创作功能',
    joinTitle: '加入 SCARECROWAI',
    joinSub: '开启你的 AI 创作之旅',
  },
  en: {
    login: 'Sign in', register: 'Sign up', or: 'or',
    email: 'Email address', pw: 'Password', pw2: 'Confirm password', name: 'Username',
    forgot: 'Forgot password?', loginBtn: 'Sign in', registerBtn: 'Create account',
    toRegister: "Don't have an account? Sign up", toLogin: 'Already have an account? Sign in',
    google: 'Continue with Google', github: 'Continue with GitHub',
    agree: 'By creating an account you agree to the',
    terms: 'Terms of Service', and: 'and', privacy: 'Privacy Policy',
    namePh: 'Your username', emailPh: 'name@example.com', pwPh: 'At least 8 characters', pw2Ph: 'Re-enter password',
    errEmail: 'Please enter a valid email', errPw: 'Password must be at least 8 characters', errPw2: 'Passwords do not match', errName: 'Username is required',
    success: 'Account created! Redirecting…', loginSuccess: 'Signed in!',
    free: 'Get 500 free credits on sign up',
    welcome: 'Welcome back',
    welcomeSub: 'Sign in to access all AI creation features',
    joinTitle: 'Join SCARECROWAI',
    joinSub: 'Start your AI creation journey today',
  },
};

function Input({ label, type = 'text', value, onChange, onBlur, placeholder, error, icon }) {
  const [show, setShow] = aS(false);
  const isPassword = type === 'password';
  return a('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    a('label', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' } }, label),
    a('div', { style: { position: 'relative' } },
      icon && a('span', { style: { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' } },
        a(Icon, { name: icon, size: 16 })),
      a('input', {
        type: isPassword && !show ? 'password' : 'text', value, onChange, onBlur, placeholder,
        style: { width: '100%', height: 46, padding: `0 ${isPassword ? 44 : 14}px 0 ${icon ? 40 : 14}px`, borderRadius: 'var(--radius-sm)',
          background: 'var(--panel)', border: `1.5px solid ${error ? '#ef4444' : 'var(--border)'}`, color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit', outline: 'none', transition: 'border-color .16s',
          boxSizing: 'border-box' },
        onFocus: e => e.target.style.borderColor = error ? '#ef4444' : 'var(--accent)',
        onBlur: e => e.target.style.borderColor = error ? '#ef4444' : 'var(--border)',
      }),
      isPassword && a('button', { type: 'button', onClick: () => setShow(!show),
        style: { position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', background: 'none', lineHeight: 1 } },
        a(Icon, { name: show ? 'sun' : 'moon', size: 16 }))),
    error && a('span', { style: { fontSize: 12, color: '#ef4444', marginTop: 2 } }, error));
}

function SocialBtn({ label, iconPath }) {
  return a('button', {
    style: { width: '100%', height: 44, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      background: 'var(--panel)', border: '1.5px solid var(--border)', fontSize: 14, fontWeight: 600, color: 'var(--text)', transition: 'all .15s' },
    onMouseEnter: e => { e.currentTarget.style.background = 'var(--panel-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; },
    onMouseLeave: e => { e.currentTarget.style.background = 'var(--panel)'; e.currentTarget.style.borderColor = 'var(--border)'; },
  },
    a('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' }, a('path', { d: iconPath, fill: 'currentColor' })),
    label);
}

const GOOGLE_PATH = 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z';
const GITHUB_PATH = 'M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z';

function AuthModal({ lang, onClose, onSuccess }) {
  const [tab, setTab] = aS('login'); // login | register
  const [form, setForm] = aS({ name: '', email: '', pw: '', pw2: '' });
  const [errors, setErrors] = aS({});
  const [loading, setLoading] = aS(false);
  const [done, setDone] = aS(false);
  const t = T[lang] || T.cn;
  const ref = aR(null);

  aE(() => {
    document.body.style.overflow = 'hidden';
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', esc); };
  }, []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function validateField(k, v, all) {
    if (k === 'name' && tab === 'register' && !v.trim()) return t.errName;
    if (k === 'email' && !v.includes('@')) return t.errEmail;
    if (k === 'pw' && v.length < 8) return t.errPw;
    if (k === 'pw2' && tab === 'register' && v !== (all?.pw ?? form.pw)) return t.errPw2;
    return '';
  }

  function handleBlur(k) {
    const err = validateField(k, form[k]);
    if (err) setErrors(e => ({ ...e, [k]: err }));
    else setErrors(e => { const n = { ...e }; delete n[k]; return n; });
  }

  function pwStrength(pw) {
    if (!pw) return 0;
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  }
  const strength = tab === 'register' ? pwStrength(form.pw) : 0;
  const strengthColor = ['#ef4444','#f97316','#eab308','#22c55e'][strength - 1] || '#ef4444';
  const strengthLabel = lang === 'cn' ? ['','弱','一般','强','极强'][strength] : ['','Weak','Fair','Strong','Very strong'][strength];

  function validate() {
    const e = {};
    if (tab === 'register' && !form.name.trim()) e.name = t.errName;
    if (!form.email.includes('@')) e.email = t.errEmail;
    if (form.pw.length < 8) e.pw = t.errPw;
    if (tab === 'register' && form.pw !== form.pw2) e.pw2 = t.errPw2;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit(ev) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setTimeout(() => { setLoading(false); setDone(true); setTimeout(() => { onSuccess && onSuccess(); onClose(); }, 1200); }, 1400);
  }

  const stop = e => e.stopPropagation();

  return a('div', {
    onClick: onClose,
    style: { position: 'fixed', inset: 0, zIndex: 200, display: 'grid', placeItems: 'center', padding: 20,
      background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', animation: 'fadeUp .22s var(--ease)' },
  },
    a('div', { ref, onClick: stop,
      style: { width: 'min(460px, 96vw)', background: 'var(--panel-solid)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden', animation: 'modalIn .3s var(--ease)' } },

      // top gradient strip — shimmer
      a('div', { style: { height: 5, background: 'var(--grad)', backgroundSize: '200% 100%', animation: 'shimmer 2.5s linear infinite' } }),

      a('div', { style: { padding: '28px 30px 30px' } },

        // close + logo
        a('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 } },
          a('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
            a(Logo, { size: 26 }),
            a('span', { className: 'font-display', style: { fontWeight: 800, fontSize: 17 } }, 'SCARECROW', a('span', { style: { color: 'var(--accent)' } }, 'AI'))),
          a('button', { onClick: onClose,
            style: { width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-dim)' } },
            a(Icon, { name: 'close', size: 15 }))),

        // heading
        a('div', { style: { marginBottom: 22 } },
          a('h2', { className: 'font-display', style: { fontSize: 24, fontWeight: 800, margin: '0 0 5px', letterSpacing: '-0.01em' } },
            tab === 'login' ? t.welcome : t.joinTitle),
          a('p', { style: { fontSize: 14, color: 'var(--text-dim)', margin: 0 } },
            tab === 'login' ? t.welcomeSub : t.joinSub),
          tab === 'register' && a('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, height: 26, padding: '0 10px', borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600 } },
            a(Icon, { name: 'sparkle', size: 13 }), t.free)),

        // social buttons
        a('div', { style: { display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 } },
          a(SocialBtn, { label: t.google, iconPath: GOOGLE_PATH }),
          a(SocialBtn, { label: t.github, iconPath: GITHUB_PATH })),

        // divider
        a('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 } },
          a('div', { style: { flex: 1, height: 1, background: 'var(--border)' } }),
          a('span', { style: { fontSize: 12.5, color: 'var(--text-faint)', fontWeight: 600 } }, t.or),
          a('div', { style: { flex: 1, height: 1, background: 'var(--border)' } })),

        // form
        done
          ? a('div', { style: { textAlign: 'center', padding: '20px 0', color: 'var(--accent)', fontWeight: 700, fontSize: 16 } },
              a(Icon, { name: 'check', size: 24, style: { margin: '0 auto 10px' } }),
              a('div', null, tab === 'register' ? t.success : t.loginSuccess))
          : a('form', { onSubmit: submit, style: { display: 'flex', flexDirection: 'column', gap: 14 } },
              tab === 'register' && a(Input, { label: t.name, value: form.name, onChange: set('name'), onBlur: () => handleBlur('name'), placeholder: t.namePh, error: errors.name, icon: 'user' }),
              a(Input, { label: t.email, type: 'email', value: form.email, onChange: set('email'), onBlur: () => handleBlur('email'), placeholder: t.emailPh, error: errors.email, icon: 'search' }),
              a(Input, { label: t.pw, type: 'password', value: form.pw, onChange: set('pw'), onBlur: () => handleBlur('pw'), placeholder: t.pwPh, error: errors.pw }),
              tab === 'register' && form.pw.length > 0 && a('div', { style: { marginTop: -8 } },
                a('div', { style: { display: 'flex', gap: 4, marginBottom: 4 } },
                  [1,2,3,4].map(i => a('div', { key: i, style: { flex: 1, height: 3, borderRadius: 2, background: i <= strength ? strengthColor : 'var(--border)', transition: 'background .2s' } }))),
                a('span', { style: { fontSize: 11, color: strengthColor, fontWeight: 600 } }, strengthLabel)),
              tab === 'register' && a(Input, { label: t.pw2, type: 'password', value: form.pw2, onChange: set('pw2'), onBlur: () => handleBlur('pw2'), placeholder: t.pw2Ph, error: errors.pw2 }),

              tab === 'login' && a('div', { style: { textAlign: 'right', marginTop: -6 } },
                a('button', { type: 'button', style: { fontSize: 13, color: 'var(--accent)', fontWeight: 600 } }, t.forgot)),

              a('button', { type: 'submit', disabled: loading,
                style: { width: '100%', height: 48, borderRadius: 'var(--radius-sm)', fontWeight: 800, fontSize: 15,
                  background: 'var(--grad)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  opacity: loading ? .7 : 1, boxShadow: '0 6px 20px var(--accent-soft)', marginTop: 4 } },
                loading ? a('div', { style: { width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,.3)', borderTopColor: '#fff', animation: 'spin .8s linear infinite' } }) : a(Icon, { name: 'sparkle', size: 17 }),
                loading ? '' : (tab === 'login' ? t.loginBtn : t.registerBtn)),

              tab === 'register' && a('p', { style: { fontSize: 11.5, color: 'var(--text-faint)', textAlign: 'center', margin: 0, lineHeight: 1.6 } },
                t.agree, ' ',
                a('a', { href: '#', style: { color: 'var(--accent)' } }, t.terms), ' ', t.and, ' ',
                a('a', { href: '#', style: { color: 'var(--accent)' } }, t.privacy)),

              a('div', { style: { textAlign: 'center', marginTop: 4 } },
                a('button', { type: 'button', onClick: () => { setTab(tab === 'login' ? 'register' : 'login'); setErrors({}); },
                  style: { fontSize: 13.5, color: 'var(--text-dim)', fontWeight: 500 } },
                  a('span', { style: { color: 'var(--accent)', fontWeight: 700 } }, tab === 'login' ? t.toRegister : t.toLogin)))),
      ),
    ),
  );
}

window.AuthModal = AuthModal;
