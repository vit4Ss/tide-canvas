import LegalDoc from "@/components/site/legal-doc";

export const metadata = {
  title: "隐私政策 · 流光 FlowingLight",
  description: "流光 FlowingLight 隐私政策",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow="隐私政策 · PRIVACY"
      title="隐私政策"
      updated="2026 年 6 月"
      intro="流光 FlowingLight 尊重并保护你的隐私。本政策说明我们在你使用本服务时会收集哪些信息、如何使用这些信息，以及你对个人信息享有的权利。"
      sections={[
        {
          heading: "我们收集的信息",
          paragraphs: [
            "账户信息：你注册时提供的邮箱、昵称等基本资料。",
            "使用信息：你在使用过程中产生的生成记录、上传素材、作品、积分与消费流水等。",
            "技术信息：为保障安全与优化体验而收集的设备、浏览器、IP 及日志信息。",
          ],
        },
        {
          heading: "信息的使用",
          paragraphs: [
            "我们使用上述信息以提供并改进服务、进行身份验证与安全防护、处理积分与订单，以及在你同意的前提下向你发送必要的服务通知。",
            "我们不会将你的个人信息用于未经你同意的用途。",
          ],
        },
        {
          heading: "信息的存储与安全",
          paragraphs: [
            "我们采取合理的技术与管理措施保护你的信息安全，防止未经授权的访问、泄露或篡改。",
            "生成结果与上传素材可能存储于对象存储服务，我们会尽力保障其访问受控。",
          ],
        },
        {
          heading: "信息的共享",
          paragraphs: [
            "除以下情形外，我们不会向第三方共享你的个人信息：获得你的明确同意；为完成生成而必需地调用上游模型服务；法律法规要求或监管机构依法要求。",
          ],
        },
        {
          heading: "你的权利",
          paragraphs: [
            "你有权访问、更正或删除你的个人信息，也可以注销账户。你可以在“个人中心”管理部分资料，或通过下方邮箱联系我们行使相关权利。",
          ],
        },
        {
          heading: "政策更新",
          paragraphs: [
            "我们可能不时更新本隐私政策。重大变更将通过站内通知或其它合理方式告知。",
          ],
        },
      ]}
    />
  );
}
