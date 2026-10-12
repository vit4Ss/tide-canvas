import { AccountScope } from "@/components/auth-provider";
import Activity from "@/components/activity";
export default function HistoryPage() { return <AccountScope><Activity /></AccountScope>; }

export const metadata = { title: "Activity" };
