"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { authApi } from "@/lib/api";
import { User, Lock, Bell } from "lucide-react";

export default function UserSettingsPage() {
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const [activeTab, setActiveTab] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const [profileForm, setProfileForm] = useState({ nickname: "", phone: "" });
  const [profileLoaded, setProfileLoaded] = useState(false);

  // 初始化 profile 表单
  if (user && !profileLoaded) {
    setProfileForm({ nickname: user.nickname || "", phone: user.phone || "" });
    setProfileLoaded(true);
  }

  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleProfileSubmit = async () => {
    setMessage({ type: "", text: "" });
    setSaving(true);
    try {
      const res = await authApi.updateProfile({ nickname: profileForm.nickname, phone: profileForm.phone });
      if (res.success && res.data) {
        setUser(res.data);
        setMessage({ type: "success", text: "个人信息已更新" });
      } else {
        setMessage({ type: "error", text: res.message || "更新失败" });
      }
    } catch {
      setMessage({ type: "error", text: "操作失败，请稍后重试" });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ type: "", text: "" });
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ type: "error", text: "两次输入的密码不一致" });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setMessage({ type: "error", text: "密码至少6个字符" });
      return;
    }
    setSaving(true);
    try {
      const res = await authApi.updatePassword({
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword,
      });
      if (res.success) {
        setMessage({ type: "success", text: "密码修改成功" });
        setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        setMessage({ type: "error", text: res.message });
      }
    } catch {
      setMessage({ type: "error", text: "操作失败" });
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: "profile", label: "个人信息", icon: User },
    { id: "password", label: "修改密码", icon: Lock },
    { id: "notifications", label: "通知偏好", icon: Bell },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">账户设置</h1>

      <div className="mt-6 flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {message.text && (
          <div
            className={`mb-6 rounded-lg px-4 py-3 text-sm ${
              message.type === "success"
                ? "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"
                : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
              <h3 className="font-semibold">基本信息</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">用户名</label>
                  <input
                    type="text"
                    value={user?.username || ""}
                    disabled
                    className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">邮箱</label>
                  <input
                    type="text"
                    value={user?.email || ""}
                    disabled
                    className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">昵称</label>
                  <input
                    type="text"
                    value={profileForm.nickname}
                    onChange={(e) => setProfileForm((f) => ({ ...f, nickname: e.target.value }))}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">手机号</label>
                  <input
                    type="text"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="绑定手机号"
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleProfileSubmit}
                disabled={saving}
                className="mt-6 rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "password" && (
          <form onSubmit={handlePasswordSubmit} className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <h3 className="font-semibold">修改密码</h3>
            <div className="mt-4 max-w-md space-y-4">
              <div>
                <label className="block text-sm font-medium">原密码</label>
                <input
                  type="password"
                  required
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm((f) => ({ ...f, oldPassword: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">新密码</label>
                <input
                  type="password"
                  required
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">确认新密码</label>
                <input
                  type="password"
                  required
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {saving ? "保存中..." : "修改密码"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "notifications" && (
          <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <h3 className="font-semibold">通知偏好</h3>
            <p className="mt-2 text-sm text-neutral-500">功能开发中...</p>
          </div>
        )}
      </div>
    </div>
  );
}
