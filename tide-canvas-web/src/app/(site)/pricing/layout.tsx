import { notFound } from "next/navigation";

export default function HiddenPricingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  void children;
  notFound();
}
