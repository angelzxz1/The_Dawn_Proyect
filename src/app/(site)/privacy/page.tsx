import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/PrivacyPolicy";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What The Dawn Project stores, what it counts, and what it never collects.",
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Privacy" title="Your music stays on your computer.">
      <PrivacyPolicy settingsHint="in the studio, under About → Privacy" />
    </LegalPage>
  );
}
