import { redirect } from "next/navigation";

// Directories and people look for /contact; the contact details live on the privacy page.
export default function ContactPage() {
  redirect("/privacy#contact");
}
