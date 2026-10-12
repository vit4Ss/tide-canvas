const messages: Array<[RegExp, string]> = [
  [/密码.*错误|账号或密码|invalid.*password|incorrect.*password/i, "The account or password is incorrect."],
  [/用户名.*存在|username.*exist/i, "This username is already taken."],
  [/邮箱.*存在|email.*exist/i, "This email address is already registered."],
  [/验证码.*(错误|失效|过期)|verification.*(invalid|expired)/i, "The verification code is invalid or has expired."],
  [/积分不足|余额不足|insufficient.*(quota|balance|credit)/i, "You do not have enough credits for this request."],
  [/并发|concurrent|排队较多/i, "You have reached your active-task limit. Wait for a task to finish and try again."],
  [/维护|maintenance/i, "This model is under maintenance. Please choose another model."],
  [/不支持.*模型|模型不支持|model.*not support/i, "This model does not support the selected settings."],
  [/不支持.*(分辨率|清晰度)|分辨率.*不受|unpriced|未配置.*积分/i, "The selected output setting is not available. Choose another setting or model."],
  [/上游拒绝|安全审核|敏感|copyright|内容未通过|版权/i, "This content could not be processed. Review your prompt and reference assets."],
  [/提交结果尚未确认|submission_outcome_unknown|code 5011/i, "Submission has not been confirmed. Check your task history before submitting again."],
  [/文件.*(超|过大)|体积.*(超|限制)|too large/i, "This file exceeds the upload limit. Choose a smaller file."],
  [/文件类型|格式不支持|file.*type/i, "This file type is not supported."],
  [/权限|无权|forbidden/i, "You do not have permission to access this item."],
  [/登录|会话.*失效|unauthorized/i, "Your session has expired. Please sign in again."],
  [/服务端无法确认.*时长|无法核验视频|duration.*probe/i, "The video duration could not be verified. Upload the source video again."],
  [/未定价|尚未配置|没有可用|不可用/i, "This option is currently unavailable. Please choose another."],
  [/系统异常|网络错误|连接失败|服务暂时|联系客服/i, "We could not complete the request. Please try again or visit Help."],
];
export function englishError(message: unknown, fallback = "We could not complete the request. Please try again."): string {
  if (typeof message !== "string" || !message.trim()) return fallback;
  for (const [pattern, replacement] of messages) if (pattern.test(message)) return replacement;
  return /[\p{Script=Han}]/u.test(message) ? fallback : message.slice(0, 700);
}
export function englishLabel(value: string, fallback: string): string {
  return value && !/[\p{Script=Han}]/u.test(value) ? value : fallback;
}
