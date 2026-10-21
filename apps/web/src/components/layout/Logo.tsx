import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M9 10.5 16 7l7 3.5v5.2c0 4.3-2.9 8.1-7 9.3-4.1-1.2-7-5-7-9.3z"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m12.6 16 2.4 2.4 4.4-4.6" fill="none" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">VaultLedger</span>
          <span className="mt-0.5 text-[11px] font-medium opacity-70">Item &amp; Price Manager</span>
        </span>
      )}
    </span>
  );
}
