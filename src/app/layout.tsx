import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { cookies } from "next/headers";
import { PreferencesProvider } from "@/components/preferences/preferences-provider";
import { Toaster } from "@/components/ui/toast";
import { parsePreferences, preferenceAttributes, PREFERENCES_COOKIE } from "@/lib/preferences";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-plex-serif",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

/** The easy-read font (Display & accessibility); downloaded only when someone turns it on. */
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Code Patch STEM — Member Documentation",
    template: "%s · Code Patch STEM",
  },
  description: "Member documentation and volunteer-hours records for the Code Patch STEM SB Chapter.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#16171a",
  // Light and dark (follows the device); see "Dark mode" in globals.css.
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Each person's display choices, applied before the page draws (no flash of the wrong theme or size).
  const preferences = parsePreferences((await cookies()).get(PREFERENCES_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable} ${atkinson.variable} h-full`}
      {...preferenceAttributes(preferences)}
    >
      <body className="min-h-full">
        <PreferencesProvider initial={preferences}>
          {children}
          <Toaster />
        </PreferencesProvider>
      </body>
    </html>
  );
}
