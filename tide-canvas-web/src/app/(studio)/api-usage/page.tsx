import ChatUsagePanel from "@/components/shared/chat-usage-panel";
import styles from "./page.module.css";

export const metadata = { title: "API 调用记录 · FlowingLight" };
export default function Page() {
  return <main className={styles.page}><ChatUsagePanel /></main>;
}
