// app/docs/page.tsx

import Link from 'next/link';

export default function UserDocs() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white/90">
      {/* Optional: Add your DashboardHeader here if you want it on docs page */}
      {/* <DashboardHeader /> */}

      <main className="mx-auto px-5 sm:px-8 md:px-12 lg:px-16 xl:px-20 py-20 md:py-24 lg:py-28 mt-8 md:mt-12 lg:mt-16">
        {/* Page Title */}
        <h1 className="text-4xl md:text-5xl font-bold text-[#54c4c3] mb-12 tracking-tight text-center">
          User Documentation
        </h1>

        {/* Content wrapper – wider on desktop, narrower on mobile */}
        <div className="max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto space-y-16">
          {/* Section 1: Interface & Accessibility */}
          <section>
            <h2 className="text-3xl font-semibold text-white mb-6 border-b border-[#223066]/50 pb-3">
              Interface & Accessibility
            </h2>

            <div className="space-y-6 text-lg leading-relaxed">
              <p>
                The interface has been designed with <strong>WCAG AA</strong> compliance in mind to meet <strong>ADA</strong> standards for web accessibility.
              </p>

              <p>
                We improved readability compared to the original prototype by:
              </p>
              <ul className="list-disc pl-6 space-y-3">
                <li>Using the clean, modern <strong>Inter</strong> sans-serif typeface (loaded via Google Fonts - free for commercial use).</li>
                <li>Carefully selecting a dark color palette that ensures strong contrast.</li>
              </ul>

              <p>
                All color combinations have been tested and verified using the{' '}
                <a
                  href="https://webaim.org/resources/contrastchecker/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#54c4c3] hover:underline transition-colors"
                >
                  WebAIM Contrast Checker
                </a>.
              </p>
            </div>
          </section>

          {/* Section 2: Accessing & Using the App */}
          <section>
            <h2 className="text-3xl font-semibold text-white mb-6 border-b border-[#223066]/50 pb-3">
              Accessing & Using the App
            </h2>

            <div className="space-y-10">
              {/* Step 1 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  1. Visit the Website
                </h3>
                <p className="text-lg">
                  Go to:{' '}
                  <Link
                    href="https://disc-tracking-software.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#54c4c3] hover:underline font-medium transition-colors"
                  >
                    https://disc-tracking-software.vercel.app/
                  </Link>
                </p>
              </div>

              {/* Step 2 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  2. Sign In or Create an Account
                </h3>
                <p className="text-lg">
                  Use the navigation at the top of the page to either:
                </p>
                <ul className="list-disc pl-6 space-y-2 mt-3">
                  <li>Sign in with your existing account, or</li>
                  <li>Create a new account</li>
                </ul>
              </div>

              {/* Step 3 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  3. Add & Manage Tracked Discs
                </h3>
                <p className="text-lg">
                  Once logged in:
                </p>
                <ul className="list-disc pl-6 space-y-3 mt-3">
                  <li>Open the <strong>Disc Actions</strong> dropdown.</li>
                  <li>Add a new tracked disc by entering its credentials.</li>
                  <li>After adding, you can <strong>sync</strong> the tracker, <strong>switch</strong> between discs in your profile, or <strong>remove</strong> a disc if needed.</li>
                </ul>
              </div>

              {/* Step 4 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  4. Sync & Throw
                </h3>
                <p className="text-lg">
                  With a disc selected and synced:
                </p>
                <ul className="list-disc pl-6 space-y-3 mt-3">
                  <li>Use the live GPS distance preview to help locate your disc after a throw.</li>
                  <li>Record throws using the built-in accelerometer data <strong>or</strong> manually time the flight (stopwatch mode configured in settings).</li>
                </ul>
              </div>

              {/* Step 5 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  5. View Throw Analysis
                </h3>
                <p className="text-lg">
                  After a throw, you’ll see:
                </p>
                <ul className="list-disc pl-6 space-y-3 mt-3">
                  <li>A detailed flight path chart showing curvature, distance, and direction</li>
                  <li>Key metrics: flight time, distance, average velocity</li>
                </ul>
                <p className="text-lg mt-4">
                  This data helps you understand disc behavior — perfect for choosing the right disc for long shots, hard right hooks, or windy conditions.
                </p>
              </div>

              {/* Step 6 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  6. Save or Discard Throw Data
                </h3>
                <p className="text-lg">
                  Not every throw is perfect (trees happen!). After viewing results:
                </p>
                <ul className="list-disc pl-6 space-y-3 mt-3">
                  <li>Click <strong>"Add Throw to Records"</strong> to save the throw to your statistics.</li>
                  <li>Or reset the timer and try again if you don’t want to log it.</li>
                </ul>
              </div>

              {/* Step 7 */}
              <div>
                <h3 className="text-2xl font-medium text-[#54c4c3] mb-3">
                  7. View Your Throw Statistics
                </h3>
                <p className="text-lg">
                  Saved throws appear in the <strong>User Throw Statistics</strong> section, where you can:
                </p>
                <ul className="list-disc pl-6 space-y-3 mt-3">
                  <li>Analyze patterns over time</li>
                  <li>Compare different discs</li>
                  <li>Identify which disc performs best in specific situations</li>
                </ul>
                <p className="text-lg mt-4 italic">
                  Experiment freely — the more data you collect, the better your on-course decisions will become.
                </p>
              </div>
            </div>
          </section>

          {/* CTA – two tethered buttons */}
          <section className="text-center mt-20 pt-10 border-t border-[#223066]/50">
            <p className="text-lg text-white/70 mb-8">
              Questions or feedback? We're here to help.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 md:gap-6">
              {/* Button 1: Back to Homepage */}
              <Link
                href="/"
                className="
                  inline-flex items-center justify-center
                  px-8 py-4 text-base font-medium
                  bg-[#54c4c3] hover:bg-[#3daaa9]
                  text-black rounded-xl
                  transition-all duration-300 shadow-md
                  hover:shadow-lg hover:scale-105
                  focus:outline-none focus:ring-2 focus:ring-[#54c4c3]/40
                  min-w-50
                "
              >
                Back to Homepage
              </Link>

              {/* Button 2: Contact Us */}
              <Link
                href="/contact"
                className="
                  inline-flex items-center justify-center
                  px-8 py-4 text-base font-medium
                  bg-transparent hover:bg-white/10
                  border-2 border-[#54c4c3] hover:border-[#54c4c3]/80
                  text-[#54c4c3] hover:text-white
                  rounded-xl
                  transition-all duration-300
                  focus:outline-none focus:ring-2 focus:ring-[#54c4c3]/40
                  min-w-50
                "
              >
                Contact Us
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}