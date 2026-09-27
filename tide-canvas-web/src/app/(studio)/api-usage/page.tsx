import ChatUsagePanel from "@/components/shared/chat-usage-panel";
import styles from "./page.module.css";

export const metadata = { title: "Token 用量与账单 · FlowingLight" };
export default function Page() {
  return <main className={styles.page}><ChatUsagePanel /></main>;
}
