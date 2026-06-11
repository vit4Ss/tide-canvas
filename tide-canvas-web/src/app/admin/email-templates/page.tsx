"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Loader2, Mail, Save, Send, AlertTriangle } from "lucide-react";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import type { EmailTemplateVO } from "@/types/email-template";

/** 由模板变量定义生成预览参数初始值(取 sample) */
function initialParams(template: EmailTemplateVO): Record<string, string> {
  const params: Record<string, string> = {};
  for (const v of template.variables) params[v.name] = v.sample ?? "";
  return params;
}

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplateVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<EmailTemplateVO | null>(null);

  // 编辑中的字段
  const [templateName, setTemplateName] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [remark, setRemark] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // 预览
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [missingVars, setMissingVars] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const contentRef = useRef<HTMLTextAreaElement>(null);

  // loading 初始为 true,首次加载结束后关闭;保存后的列表刷新不再展示骨架屏
  const loadTemplates = useCallback(async () => {
    try {
      const res = await adminApi.emailTemplates.list();
      if (res.success && res.data) {
        setTemplates(res.data);
        return res.data;
      }
      toast.error(res.message || "加载模板失败");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
    return [];
  }, []);

  const selectTemplate = useCallback((template: EmailTemplateVO) => {
    setCurrent(template);
    setTemplateName(template.templateName);
    setSubject(template.subject);
    setContent(template.content);
    setEnabled(template.enabled === 1);
    setRemark(template.remark ?? "");
    setParams(initialParams(template));
    setDirty(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTemplates().then((list) => {
        if (list.length > 0) selectTemplate(list[0]);
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadTemplates, selectTemplate]);

  // 编辑内容/参数变化后防抖刷新预览
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await adminApi.emailTemplates.preview({ subject, content, params });
        if (res.success && res.data) {
          setPreviewSubject(res.data.subject);
          setPreviewHtml(res.data.html);
          setMissingVars(res.data.missingVariables);
        }
      } catch {
        // 预览失败静默,不打断编辑
      } finally {
        setPreviewing(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [current, subject, content, params]);

  const handleSwitch = (template: EmailTemplateVO) => {
    if (template.id === current?.id) return;
    if (dirty && !window.confirm("当前模板有未保存的修改，切换后将丢失，确定切换？")) return;
    selectTemplate(template);
  };

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const el = contentRef.current;
    if (!el) {
      setContent((prev) => prev + token);
      setDirty(true);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };

  const handleSave = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      const res = await adminApi.emailTemplates.update(current.id, {
        templateName,
        subject,
        content,
        enabled: enabled ? 1 : 0,
        remark: remark || undefined,
      });
      if (res.success) {
        toast.success("模板已保存");
        setDirty(false);
        const list = await loadTemplates();
        const fresh = list.find((t) => t.id === current.id);
        if (fresh) setCurrent(fresh);
      } else {
        toast.error(res.message || "保存失败");
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!current || sendingTest) return;
    const to = testEmail.trim();
    if (!to) {
      toast.error("请输入测试收件邮箱");
      return;
    }
    if (dirty) {
      toast.info("测试邮件使用已保存的内容发送，请先保存修改");
      return;
    }
    setSendingTest(true);
    try {
      const res = await adminApi.emailTemplates.sendTest(current.id, { to, params });
      if (res.success) toast.success(`测试邮件已发送至 ${to}`);
      else toast.error(res.message || "发送失败");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSendingTest(false);
    }
  };

  const markDirty = () => setDirty(true);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">邮件模板</h2>
          <p className="mt-1 text-sm text-neutral-500">
            编辑系统邮件的主题与正文，支持 {"{{变量}}"} 占位符，右侧实时预览渲染效果
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty || !current}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "保存中..." : "保存模板"}
        </button>
      </div>

      {loading ? (
        <div className="h-96 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white py-20 text-center text-sm text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950">
          暂无邮件模板，请先执行数据库初始化脚本（init.sql）
        </div>
      ) : (
        <div className="flex gap-6">
          {/* 模板列表 */}
          <div className="w-56 shrink-0 space-y-1">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSwitch(t)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  current?.id === t.id
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                <Mail className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.templateName}</span>
                  <span className={`block truncate font-mono text-xs ${current?.id === t.id ? "opacity-70" : "text-neutral-400"}`}>
                    {t.templateCode}
                  </span>
                </span>
                {t.enabled !== 1 && (
                  <span className="shrink-0 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300">
                    停用
                  </span>
                )}
              </button>
            ))}
          </div>

          {current && (
            <div className="grid min-w-0 flex-1 gap-6 xl:grid-cols-2">
              {/* 编辑区 */}
              <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-neutral-500">模板名称</label>
                    <input
                      value={templateName}
                      onChange={(e) => { setTemplateName(e.target.value); markDirty(); }}
                      className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </div>
                  <div className="shrink-0 pt-5">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <button
                        onClick={() => { setEnabled(!enabled); markDirty(); }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          enabled ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                      启用
                    </label>
                  </div>
                </div>
                {!enabled && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    模板停用后，相关邮件将使用系统内置的纯文本文案发送
                  </p>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">邮件主题</label>
                  <input
                    value={subject}
                    onChange={(e) => { setSubject(e.target.value); markDirty(); }}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>

                {current.variables.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-500">
                      可用变量（点击插入到正文光标处）
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {current.variables.map((v) => (
                        <button
                          key={v.name}
                          onClick={() => insertVariable(v.name)}
                          title={v.description}
                          className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          {`{{${v.name}}}`}
                          <span className="ml-1 font-sans text-neutral-400">{v.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">正文 HTML</label>
                  <textarea
                    ref={contentRef}
                    value={content}
                    onChange={(e) => { setContent(e.target.value); markDirty(); }}
                    rows={16}
                    spellCheck={false}
                    className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">备注</label>
                  <input
                    value={remark}
                    onChange={(e) => { setRemark(e.target.value); markDirty(); }}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>
              </div>

              {/* 预览区 */}
              <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="h-4 w-4 text-neutral-400" />
                  实时预览
                  {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                </div>

                {current.variables.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-500">变量测试值</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {current.variables.map((v) => (
                        <div key={v.name} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 truncate font-mono text-xs text-neutral-500" title={v.description}>
                            {v.name}
                          </span>
                          <input
                            value={params[v.name] ?? ""}
                            onChange={(e) => setParams((prev) => ({ ...prev, [v.name]: e.target.value }))}
                            placeholder={v.sample}
                            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {missingVars.length > 0 && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    以下变量未提供测试值（渲染时保留原样）：{missingVars.join("、")}
                  </p>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">主题预览</label>
                  <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm font-medium dark:bg-neutral-900">
                    {previewSubject || "（空）"}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">正文预览</label>
                  <iframe
                    title="邮件预览"
                    sandbox=""
                    srcDoc={previewHtml}
                    className="h-96 w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-700"
                  />
                </div>

                <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
                  <label className="mb-1 block text-xs font-medium text-neutral-500">
                    发送测试邮件（使用已保存的模板内容与上方测试值）
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="test@example.com"
                      className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                    />
                    <button
                      onClick={handleSendTest}
                      disabled={sendingTest || !testEmail.trim()}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      发送
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
