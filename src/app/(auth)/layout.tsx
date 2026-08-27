export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Left Panel — the "Innings" brand gradient, defined once in globals.css */}
      <div className="brand-hero-panel hidden flex-col justify-between p-12 text-white lg:flex lg:w-1/2">
        <div className="animate-in fade-in slide-in-from-left-4 duration-500">
          <div className="flex items-center gap-3">
            <div className="flex h-15 w-15 items-center justify-center rounded-full bg-brand-green/20 ring-1 ring-brand-green/30">
              <img
                src="/Just_logo.svg"
                alt="Straight Drive Sports & Leisure Pvt. Ltd."
                className="h-12 w-12"
              />
            </div>
            <div>
              <h1 className="text-h2 font-extrabold tracking-[0.04em]">
                STRAIGHT DRIVE SPORTS & LEISURE PVT. LTD.
              </h1>
              <p className="mt-2 text-caption font-bold tracking-[0.12em] text-brand-green uppercase">
                STOCK INVENTORY MANAGEMENT (SIM)
              </p>
            </div>
          </div>
        </div>

        <div className="animate-in fade-in slide-in-from-left-4 space-y-6 delay-150 duration-700 fill-mode-both">
          <blockquote className="text-xl leading-relaxed font-light text-white/85">
            &ldquo;A quote is to be mentioned (optional) &rdquo;
          </blockquote>
          {/* <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green/20 ring-1 ring-brand-green/30">
              <img
                src="/Just_logo.svg"
                alt="Straight Drive Sports & Leisure Pvt. Ltd."
                className="h-8 w-8"
              />
            </div>
            <div>
              <p className="text-body font-semibold">
                STOCK INVENTORY MANAGEMENT (SIM)
              </p>
              <p className="text-caption text-white/60">SIM</p>
            </div>
          </div> */}
        </div>

        <p className="text-caption text-white/55">
          &copy; {new Date().getFullYear()} Straight Drive Sports & Leisure Pvt. Ltd. <br/> 
          All rights reserved.
        </p>
      </div>

      {/* Right Panel — Form area */}
      <div className="flex w-full items-center justify-center p-6 sm:p-8 lg:w-1/2">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
