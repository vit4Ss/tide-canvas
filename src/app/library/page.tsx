import { AccountScope } from "@/components/auth-provider";
import Library from "@/components/library";
export default function LibraryPage() { return <AccountScope><Library /></AccountScope>; }

export const metadata = { title: "Library" };
