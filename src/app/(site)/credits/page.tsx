import type { Metadata } from "next";
import { CreditsTabBody } from "@/studio/dialogs/AboutWindow";
import { LegalPage } from "@/site/LegalPage";

export const metadata: Metadata = {
  title: "Credits",
  description: "The members who keep The Dawn Project going, and the libraries, sounds and fonts it's built on, with their licenses.",
};

export default function CreditsPage() {
  return (
    <LegalPage eyebrow="Credits" title="Built on the work of others.">
      <CreditsTabBody />
    </LegalPage>
  );
}
