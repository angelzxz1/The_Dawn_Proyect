import type { Metadata } from "next";
import { CreditsTabBody } from "@/studio/dialogs/AboutWindow";
import { LegalPage } from "@/site/LegalPage";

export const metadata: Metadata = {
  title: "Credits",
  description: "The libraries, sounds and fonts The Dawn Project is built on, and their licenses.",
};

export default function CreditsPage() {
  return (
    <LegalPage eyebrow="Credits" title="Built on the work of others.">
      <CreditsTabBody />
    </LegalPage>
  );
}
