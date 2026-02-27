import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-[#1a234d] border-t border-white/10 pt-16 pb-8 px-6 md:px-10">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-12 text-center md:text-left">
        <div className="col-span-1 md:col-span-1">
          <Link href="/" className="inline-block flex-none mb-6">
            <img
              src="/flight-iq-logo.svg"
              alt="Flight IQ logo"
              className="h-12 md:h-10 w-auto transition-transform hover:scale-105 py-0.5"
            />
          </Link>
          <p className="text-white/60 text-sm leading-relaxed">
            Helping disc golfers track their collection and analyze their game.
          </p>
        </div>
        
        <div>
          <h4 className="font-semibold text-white mb-4">Product</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><Link href="/features" className="hover:text-[#54c4c3]">Features</Link></li>
            <li><Link href="/pricing" className="hover:text-[#54c4c3]">Pricing</Link></li>
            <li><Link href="/changelog" className="hover:text-[#54c4c3]">Changelog</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-white mb-4">Company</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><Link href="/about" className="hover:text-[#54c4c3]">About Us</Link></li>
            <li><Link href="/documentation" className="hover:text-[#54c4c3]">User Documentation</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-white mb-4">Legal</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li><Link href="/privacy" className="hover:text-[#54c4c3]">Privacy Policy</Link></li>
            <li><Link href="/terms" className="hover:text-[#54c4c3]">Terms & Conditions</Link></li>
          </ul>
        </div>
      </div>
      
      <div className="border-t border-white/10 pt-8 text-center text-sm text-white/40">
        © <span suppressHydrationWarning>{new Date().getFullYear()}</span> Flight IQ. All rights reserved.
      </div>
    </footer>
  )
}
