import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Dawn — Studio" },
};

export default function StudioLayout({ children }: LayoutProps<"/app">) {
  return children;
}
