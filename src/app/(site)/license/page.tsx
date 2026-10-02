import type { Metadata } from "next";
import { LicenseTabBody } from "@/components/AboutWindow";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "License",
  description: "The music you make with The Dawn Project is yours to share and sell. The app itself is all rights reserved.",
};

export default function LicensePage() {
  return (
    <LegalPage eyebrow="License" title="Your music is yours.">
      <LicenseTabBody />
    </LegalPage>
  );
}
