import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/shell";
export default function NotFound() { return <PublicPage><section className="wrap error-page"><span>404</span><h1>This idea took<br />a different turn.</h1><p>The page you&apos;re looking for is no longer here.</p><Link className="button primary" href="/">Find your way home <ArrowRight size={16} /></Link></section></PublicPage>; }
