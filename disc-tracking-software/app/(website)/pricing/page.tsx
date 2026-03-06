
import Link from 'next/link';

export default function Pricing() {
return (
    <div className="pt-20 md:pt-24 min-h-screen bg-[#190f2A] text-white">
      {/* Page Title – centered on all screens */}
      <div className="text-center px-6 md:px-12 lg:px-20 py-10 md:py-16">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[#54c4c3]">
          Pricing
        </h1>
      </div>

      {/* Two-column layout on md+ • Stacks vertically on mobile */}
      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-20 py-8 md:py-12">
        <div className="items-center">
          {/* Left column: Text */}
          <div className="space-y-6 text-lg md:text-xl leading-relaxed">
            <p>
             Pricing to be determined based on future market research. We aim to provide affordable options for disc golf players of all levels.
            </p>

          </div>
        </div>
      </div>

      {/* Updated CTA area – two tethered buttons */}
      <div className="text-center py-12 border-t border-[#223066]/50 mt-12">
        <p className="text-lg text-white/70 mb-8">
          Ready to improve your game or have questions?
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 md:gap-6">
          {/* Button 1: Back to Homepage */}
          <Link
            href="/"  // or "/dashboard" if you prefer logged-in users go there
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
            href="/contact"  // ← change to your actual contact page route
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
      </div>
    </div>
  );
}
