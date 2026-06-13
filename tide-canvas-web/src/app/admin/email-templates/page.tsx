"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Input, Switch, Button, Tag, Alert, Space, Empty, Skeleton } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { MailOutlined, SaveOutlined, SendOutlined, EyeOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { EmailTemplateVO } from "@/types/email-template";

function initialParams(template: EmailTemplateVO): Record<string, string> {
  const params: Record<string, string> = {};
  for (const v of template.variables) params[v.name] = v.sample ?? "";
  return params;
}

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplateVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<EmailTemplateVO | null>(null);

  const [templateName, setTemplateName] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [remark, setRemark] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [missingVars, setMissingVars] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const contentRef = useRef<TextAreaRef>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await adminApi.emailTemplates.list();
      if (res.success && res.data) { setTemplates(res.data); return res.data; }
      toast.error(res.message || "加载模板失败");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
    return [];
  }, []);

  const selectTemplate = useCallback((t: EmailTemplateVO) => {
    setCurrent(t);
    setTemplateName(t.templateName);
    setSubject(t.subject);
    setContent(t.content);
    setEnabled(t.enabled === 1);
    setRemark(t.remark ?? "");
    setParams(initialParams(t));
    setDirty(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTemplates().then((list) => { if (list.length > 0) selectTemplate(list[0]); });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadTemplates, selectTemplate]);

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
        // 静默
      } finally {
        setPreviewing(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [current, subject, content, params]);

  const handleSwitch = (t: EmailTemplateVO) => {
    if (t.id === current?.id) return;
    if (dirty && !window.confirm("当前模板有未保存的修改，切换后将丢失，确定切换？")) return;
    selectTemplate(t);
  };

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const el = contentRef.current?.resizableTextArea?.textArea;
    if (!el) { setContent((p) => p + token); setDirty(true); return; }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    setContent(content.slice(0, start) + token + content.slice(end));
    setDirty(true);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; });
  };

  const handleSave = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      const res = await adminApi.emailTemplates.update(current.id, { templateName, subject, content, enabled: enabled ? 1 : 0, remark: remark || undefined });
      if (res.success) {
        toast.success("模板已保存");
        setDirty(false);
        const list = await loadTemplates();
        const fresh = list.find((t) => t.id === current.id);
        if (fresh) setCurrent(fresh);
      } else toast.error(res.message || "保存失败");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!current || sendingTest) return;
    const to = testEmail.trim();
    if (!to) { toast.error("请输入测试收件邮箱"); return; }
    if (dirty) { toast.info("测试邮件使用已保存的内容发送，请先保存修改"); return; }
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="邮件模板"
        desc="编辑系统邮件的主题与正文，支持 {{变量}} 占位符，右侧实时预览"
        extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty || !current} onClick={handleSave}>保存模板</Button>}
      />

      {loading ? (
        <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
      ) : templates.length === 0 ? (
        <Card><Empty description="暂无邮件模板，请先执行数据库初始化脚本" /></Card>
      ) : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {/* 模板列表 */}
          <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {templates.map((t) => {
              const active = current?.id === t.id;
              return (
                <button key={t.id} onClick={() => handleSwitch(t)}
                  style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8, border: "1px solid", cursor: "pointer",
                    borderColor: active ? "#1677ff" : "var(--ant-color-border-secondary, #f0f0f0)", background: active ? "#e6f0ff" : "#fff", display: "flex", gap: 8, alignItems: "center" }}>
                  <MailOutlined style={{ color: active ? "#1677ff" : "#bfbfbf" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500, color: active ? "#1677ff" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.templateName}</span>
                    <span style={{ display: "block", fontFamily: "monospace", fontSize: 11, color: "#bfbfbf", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.templateCode}</span>
                  </span>
                  {t.enabled !== 1 && <Tag style={{ marginInlineEnd: 0, fontSize: 10 }}>停用</Tag>}
                </button>
              );
            })}
          </div>

          {current && (
            <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
              {/* 编辑 */}
              <Card title="编辑" extra={<Space>启用 <Switch checked={enabled} onChange={(c) => { setEnabled(c); setDirty(true); }} /></Space>}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {!enabled && <Alert type="warning" showIcon message="模板停用后，相关邮件将使用系统内置纯文本文案发送" />}
                  <div><div style={{ marginBottom: 6 }}>模板名称</div><Input value={templateName} onChange={(e) => { setTemplateName(e.target.value); setDirty(true); }} /></div>
                  <div><div style={{ marginBottom: 6 }}>邮件主题</div><Input value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} /></div>
                  {current.variables.length > 0 && (
                    <div>
                      <div style={{ marginBottom: 6 }}>可用变量（点击插入到正文光标处）</div>
                      <Space wrap size={[6, 6]}>
                        {current.variables.map((v) => (
                          <Tag key={v.name} style={{ cursor: "pointer", fontFamily: "monospace" }} onClick={() => insertVariable(v.name)} title={v.description}>
                            {`{{${v.name}}}`}<span style={{ marginLeft: 4, color: "#bfbfbf", fontFamily: "sans-serif" }}>{v.description}</span>
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                  <div><div style={{ marginBottom: 6 }}>正文 HTML</div><Input.TextArea ref={contentRef} rows={14} spellCheck={false} style={{ fontFamily: "monospace", fontSize: 12 }} value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); }} /></div>
                  <div><div style={{ marginBottom: 6 }}>备注</div><Input value={remark} onChange={(e) => { setRemark(e.target.value); setDirty(true); }} /></div>
                </div>
              </Card>

              {/* 预览 */}
              <Card title={<Space><EyeOutlined /> 实时预览 {previewing && <Skeleton.Button active size="small" style={{ width: 20, minWidth: 20 }} />}</Space>}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {current.variables.length > 0 && (
                    <div>
                      <div style={{ marginBottom: 6 }}>变量测试值</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                        {current.variables.map((v) => (
                          <Input key={v.name} addonBefore={<span style={{ fontFamily: "monospace", fontSize: 12 }}>{v.name}</span>} placeholder={v.sample}
                            value={params[v.name] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [v.name]: e.target.value }))} />
                        ))}
                      </div>
                    </div>
                  )}
                  {missingVars.length > 0 && <Alert type="warning" showIcon message={`以下变量未提供测试值（渲染时保留原样）：${missingVars.join("、")}`} />}
                  <div><div style={{ marginBottom: 6 }}>主题预览</div><div style={{ background: "var(--ant-color-fill-quaternary, #fafafa)", padding: "8px 12px", borderRadius: 8, fontWeight: 500 }}>{previewSubject || "（空）"}</div></div>
                  <div>
                    <div style={{ marginBottom: 6 }}>正文预览</div>
                    <iframe title="邮件预览" sandbox="" srcDoc={previewHtml} style={{ width: "100%", height: 360, border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, background: "#fff" }} />
                  </div>
                  <div>
                    <div style={{ marginBottom: 6 }}>发送测试邮件（使用已保存内容与上方测试值）</div>
                    <Space.Compact style={{ width: "100%" }}>
                      <Input placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                      <Button icon={<SendOutlined />} loading={sendingTest} disabled={!testEmail.trim()} onClick={handleSendTest}>发送</Button>
                    </Space.Compact>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
